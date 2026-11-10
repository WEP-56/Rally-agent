// Task store: facts in, display state out (docs 01 section 2 / 3). No locks; write scope is only a signal.

import { existsSync, mkdirSync } from "node:fs";
import { basename, isAbsolute, resolve, sep } from "node:path";
import type {
	QueueReason,
	Quote,
	ReportState,
	Task,
	TaskAttention,
	TaskBoard,
	TaskInput,
	TaskInputKind,
	TaskMode,
	TaskOutcome,
	TaskRun,
	TaskAccess,
	TaskUsage,
} from "../../shared/task.ts";
import { questionViews, taskView } from "../../shared/task.ts";
import type { ToolCall } from "../../shared/tools.ts";
import type { AssistantMessageView } from "../../shared/conversation.ts";
import type { TaskGate } from "../../shared/gate.ts";
import type { JobRecord } from "../../shared/jobs.ts";
import type { ServiceRecord } from "../../shared/services.ts";
import type { EventKind, EventLog, LoggedEvent } from "./event-log.ts";
import type { AuditLog } from "./audit.ts";

export interface CreateTaskInput {
	title: string;
	quotes: Quote[];
	note?: string;
	cwd: string;
	scope: string[];
	mode: TaskMode;
	dependsOn: string[];
	autoApprove: boolean;
	dispatchKey?: string;
}

export interface ScopeWarning {
	withTaskId: string;
	paths: string[];
}

export class TaskStore {
	private readonly tasks = new Map<string, Task>();
	private readonly workspaceDir: string | (() => string);
	private readonly events: EventLog;
	private readonly audit?: AuditLog;
	private readonly onChange: (task: Task, kind: string) => void;
	private nextTask = 1045;
	private nextAttention = 1;
	private readonly activities = new Map<string, ToolCall[]>();
	private readonly conversations = new Map<string, AssistantMessageView[]>();
	private readonly accesses = new Map<string, TaskAccess[]>();

	constructor(events: EventLog, workspaceDir: string | (() => string), onChange: (task: Task, kind: string) => void, audit?: AuditLog, recovery?: readonly LoggedEvent[]) {
		this.events = events;
		this.audit = audit;
		this.workspaceDir = workspaceDir;
		this.onChange = onChange;
		this.replay(recovery ?? events.all());
	}

	/** Persisted tasks, newest first. */
	list(): Task[] {
		return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
	}

	get(id: string): Task | undefined {
		return this.tasks.get(id);
	}

	recordGate(taskId: string, gate: TaskGate, kind: "gate_requested" | "gate_escalated" | "gate_decided"): void {
		const task = this.require(taskId);
		const gates = task.gates ??= [];
		const index = gates.findIndex((item) => item.id === gate.id);
		if (index === -1) gates.push(structuredClone(gate));
		else gates[index] = structuredClone(gate);
		this.commit(task, kind, { gateId: gate.id });
	}

	recordExternalAction(taskId: string, tool: string): void {
		const task = this.require(taskId);
		task.lastExternalAction = { tool, at: Date.now() };
		this.commit(task, "external_action");
	}

	board(active: number, limit: number, now = Date.now()): TaskBoard {
		const open = this.list().filter((task) => !task.ended);
		const archived = this.list().filter(task => task.archivedAt !== undefined);
		const ended = this.list()
			.filter((task) => task.ended && task.archivedAt === undefined)
			.sort((a, b) => b.updatedAt - a.updatedAt || Number(b.id.slice(2)) - Number(a.id.slice(2)))
			.slice(0, 20);
		return { tasks: [...open, ...ended, ...archived].map((task) => this.view(task, now)), questions: this.list().flatMap(questionViews), active, limit, autoApprove: false };
	}

	archive(taskId: string, archived: boolean): void {
		this.events.assertWritable();
		const task = this.require(taskId);
		if (!task.ended) throw new TaskError("NOT_ENDED", "请先在主对话中结束任务，再归档");
		if ((task.archivedAt !== undefined) === archived) return;
		const updatedAt = Date.now();
		const archivedAt = archived ? updatedAt : undefined;
		this.events.append("task_archived", { task: { ...task, archivedAt, updatedAt }, archived, actor: "user" });
		task.archivedAt = archivedAt; task.updatedAt = updatedAt;
		this.onChange(task, "task_archived");
	}

	view(task: Task, now = Date.now()) {
		return { ...taskView(task, now), toolCalls: this.timeline(task.id).slice(-20), assistantMessages: this.assistantMessages(task.id) };
	}

	assistantMessages(taskId: string): AssistantMessageView[] {
		const calls = new Map(this.timeline(taskId).map((call) => [call.id, call]));
		const task = this.require(taskId);
		return (this.conversations.get(taskId) ?? []).map((message) => ({ ...message,
			blocks: message.blocks.map((block) => ({ ...block })),
			streaming: message.streaming && !task.ended && !task.runs.find((run) => run.id === message.runId)?.endedAt,
			toolCalls: message.blocks.flatMap((block) => { const call = block.type === "tool" ? calls.get(block.toolCallId) : undefined; return call ? [{ ...call }] : []; }),
		}));
	}

	recordAssistant(taskId: string, message: AssistantMessageView, persist: boolean): void {
		const task = this.require(taskId);
		this.applyAssistant(taskId, message);
		if (persist) this.events.append("assistant_message", { taskId, message });
		this.onChange(task, "assistant_message");
	}

	private applyAssistant(taskId: string, message: AssistantMessageView): void {
		const messages = this.conversations.get(taskId) ?? [];
		const index = messages.findIndex((item) => item.id === message.id);
		const copy = structuredClone(message);
		if (index === -1) messages.push(copy);
		else messages[index] = copy;
		this.conversations.set(taskId, messages);
	}

	timeline(taskId: string): ToolCall[] {
		const task = this.require(taskId);
		return (this.activities.get(taskId) ?? []).map((call) => ({ ...call, status: call.status === "running" && (task.ended || task.runs.find((run) => run.id === call.runId)?.endedAt || task.runs.every((run) => run.endedAt)) ? "interrupted" as const : call.status }));
	}

	recordTool(taskId: string, call: ToolCall): void {
		const task = this.require(taskId);
		this.applyTool(taskId, call);
		this.events.append("tool_activity", { taskId, call });
		this.onChange(task, "tool_activity");
	}

	private applyTool(taskId: string, call: ToolCall): void {
		const calls = this.activities.get(taskId) ?? [];
		const index = calls.findIndex((item) => item.id === call.id);
		if (index === -1) calls.push({ ...call });
		else calls[index] = { ...call };
		this.activities.set(taskId, calls);
	}

	access(taskId: string): TaskAccess[] {
		this.require(taskId);
		return structuredClone(this.accesses.get(taskId) ?? []);
	}

	recordAccess(taskId: string, access: TaskAccess): void {
		const task = this.require(taskId);
		const entries = this.accesses.get(taskId) ?? [];
		if (entries.some((item) => item.toolCallId === access.toolCallId && item.kind === access.kind && item.target === access.target && item.requestIndex === access.requestIndex)) return;
		this.events.append("access_recorded", { taskId, access });
		entries.push({ ...access });
		this.accesses.set(taskId, entries);
		if ((access.kind === "fs_write" || access.kind === "fs_delete") && access.coverage !== "command_scope") this.recordChangedFiles(taskId, [access.target]);
		else this.onChange(task, "access_recorded");
	}

	warnOverlaps(taskId: string, phase: "update" | "resume" | "start"): ScopeWarning[] {
		const warnings = this.overlapWarnings(this.require(taskId));
		for (const warning of warnings) this.events.append("task_scope_overlap", { taskId, ...warning, phase });
		return warnings;
	}

	create(input: CreateTaskInput): { task: Task; warnings: ScopeWarning[] } {
		const now = Date.now();
		const id = `T-${this.nextTask++}`;
		const outputDir = taskOutputDir(typeof this.workspaceDir === "function" ? this.workspaceDir() : this.workspaceDir, id, input.title);
		const task: Task = {
			id,
			dispatchKey: input.dispatchKey,
			title: input.title,
			quotes: input.quotes,
			note: input.note,
			cwd: input.cwd,
			scope: input.scope,
			mode: input.mode,
			outputDir,
			dependsOn: input.dependsOn,
			createdAt: now,
			updatedAt: now,
			approval: input.autoApprove
				? { state: "approved", by: "auto", at: now, basis: ["auto"] }
				: { state: "pending" },
			runs: [],
			inputs: [],
			usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0 },
		};
		this.tasks.set(id, task);
		this.events.append("task_created", { task, scope: input.scope });
		this.onChange(task, "task_created");
		if (input.autoApprove) this.events.append("task_approved", { task, by: "auto" });
		const warnings = this.overlapWarnings(task);
		for (const warning of warnings) {
			this.events.append("task_scope_overlap", { taskId: id, withTaskId: warning.withTaskId, paths: warning.paths });
		}
		return { task, warnings };
	}

	approve(taskId: string, by: "button" | "main", basis: string[]): Task {
		const task = this.require(taskId);
		if (task.ended) throw new TaskError("ALREADY_ENDED", "任务已结束");
		if (task.approval.state !== "pending") return this.snapshot(task);
		this.audit?.append("approve", { taskId, actor: by, basis });
		task.approval = { state: "approved", by, basis, at: Date.now() };
		this.commit(task, "task_approved", { by, basis });
		return this.snapshot(task);
	}

	cancel(taskId: string, by: "main" | "system", reason?: string): Task {
		const task = this.require(taskId);
		if (task.ended) return this.snapshot(task);
		this.audit?.append("cancel", { taskId, actor: by, basis: [], reason });
		task.approval = { ...task.approval, state: "cancelled" };
		this.end(task, "cancelled", by, reason);
		return this.snapshot(task);
	}

	update(taskId: string, patch: Partial<Pick<Task, "title" | "note" | "cwd" | "mode" | "scope" | "dependsOn">>): Task {
		const task = this.require(taskId);
		if (task.ended) throw new TaskError("ALREADY_ENDED", "任务已结束");
		if (task.runs.length > 0) throw new TaskError("ALREADY_STARTED", "任务已开始，请用 task_steer");
		Object.assign(task, patch);
		this.commit(task, "task_updated", { changed: Object.keys(patch) });
		return this.snapshot(task);
	}

	/** Resume an ended/interrupted task; the current global approval mode applies again. */
	resume(taskId: string, input: { note?: string; quotes?: Quote[]; mode?: TaskMode; scope?: string[]; autoApprove?: boolean }): Task {
		const task = this.require(taskId);
		const last = task.runs.at(-1);
		if (!task.ended && last?.endReason !== "interrupted" && last?.lastReport?.state !== "blocked") throw new TaskError("NOT_ENDED", "任务尚未结束，请用 task_steer");
		if (last && !last.endedAt) this.endRun(task, last, "blocked");
		task.ended = undefined;
		task.archivedAt = undefined;
		this.archiveAttention(task, "run_ended");
		if (input.mode) task.mode = input.mode;
		if (input.scope) task.scope = input.scope;
		task.approval = input.autoApprove
			? { state: "approved", by: "auto", basis: (input.quotes ?? []).map((quote) => quote.messageId), at: Date.now() }
			: { state: "pending" };
		this.addInput(task, "resume", { note: input.note, quotes: input.quotes });
		return this.snapshot(task);
	}

	steer(taskId: string, quotes: Quote[], body?: string, note?: string): Task {
		const task = this.require(taskId);
		if (task.ended) throw new TaskError("ALREADY_ENDED", "任务已结束，请用 task_resume");
		this.addInput(task, "steer", { quotes, body, note });
		return this.snapshot(task);
	}

	/** System nudge when a worker ends a turn without reporting (docs 01 §2.3). */
	nudge(taskId: string, body: string): TaskInput | null {
		const task = this.tasks.get(taskId);
		if (!task || task.ended) return null;
		return this.addInput(task, "nudge", { body });
	}

	recordService(service: ServiceRecord, kind: "service_started" | "service_updated" | "service_exited" | "service_stopped"): void {
		const task = this.require(service.taskId);
		const services = [...(task.services ?? [])];
		const index = services.findIndex(item => item.id === service.id);
		if (index < 0) services.push(structuredClone(service)); else services[index] = structuredClone(service);
		const updatedAt = Date.now();
		this.events.append(kind, { task: { ...task, services, updatedAt }, serviceId: service.id, runId: service.runId });
		task.services = services; task.updatedAt = updatedAt;
		this.onChange(task, kind);
	}

	recordJob(job: JobRecord, kind: "job_started" | "job_backgrounded" | "job_exited"): void {
		const task = this.require(job.taskId);
		const jobs = [...(task.jobs ?? [])];
		const index = jobs.findIndex(item => item.id === job.id);
		if (index < 0) jobs.push(structuredClone(job)); else jobs[index] = structuredClone(job);
		const updatedAt = Date.now();
		this.events.append(kind, { task: { ...task, jobs, updatedAt }, jobId: job.id, runId: job.runId });
		task.jobs = jobs; task.updatedAt = updatedAt;
		this.onChange(task, kind);
	}

	jobDone(job: JobRecord, body: string): TaskInput | null {
		const task = this.tasks.get(job.taskId);
		if (!task || task.ended || !task.runs.some(run => run.id === job.runId && !run.endedAt)) return null;
		if (task.inputs.some(input => input.kind === "job_done" && input.jobId === job.id)) return null;
		const input: TaskInput = { id: `I-${task.inputs.length + 1}`, kind: "job_done", jobId: job.id, body, at: Date.now() };
		const inputs = [...task.inputs, input];
		this.events.append("task_input", { task: { ...task, inputs, updatedAt: input.at }, inputId: input.id, kind: "job_done" });
		task.inputs = inputs; task.updatedAt = input.at;
		this.onChange(task, "task_input");
		return input;
	}

	recordRead(taskId: string, inputId: string): void {
		const task = this.tasks.get(taskId);
		const input = task?.inputs.find((item) => item.id === inputId);
		if (!task || !input || input.readAt) return;
		input.readAt = Date.now();
		this.commit(task, "input_read", { inputId });
	}

	markDelivered(taskId: string, inputId: string): void {
		const task = this.tasks.get(taskId);
		const input = task?.inputs.find((item) => item.id === inputId);
		if (!task || !input) return;
		input.deliveredAt = Date.now();
		this.commit(task, "input_delivered", { inputId });
	}

	escalateAttention(taskId: string, questionId: string): void {
		const task = this.require(taskId);
		const attention = this.pendingAttention(task, questionId);
		if (attention.escalatedAt !== undefined) return;
		attention.escalatedAt = Date.now();
		this.commit(task, "attention_escalated", { questionId });
	}

	/** Only questions actually delivered in the settled main turn are eligible. */
	fallbackQuestions(ids: string[]): void {
		for (const task of this.tasks.values()) {
			const attention = task.attention;
			if (!attention || !ids.includes(attention.id) || task.ended || attention.answer || attention.closed || attention.escalatedAt !== undefined) continue;
			if (!task.runs.some((run) => run.id === attention.runId && !run.endedAt)) continue;
			this.escalateAttention(task.id, attention.id);
		}
	}

	answerAttention(taskId: string, questionId: string, text: string, by: "main" | "user", basis: string[]): Task {
		const task = this.require(taskId);
		const attention = this.pendingAttention(task, questionId);
		if (by === "user" && (attention.escalatedAt === undefined || !attention.options?.includes(text)))
			throw new TaskError("ANSWER_INVALID", "只能选择已上升问题中的原始选项；自由回答请使用主对话输入框");
		if (by === "main" && basis.length === 0) throw new TaskError("QUOTES_REQUIRED", "代答必须引用用户原话");
		this.audit?.append("answer", { taskId, questionId, actor: by, basis, text });
		attention.answer = { by, basis: [...basis], text, at: Date.now() };
		this.archiveAttention(task);
		this.addInput(task, "answer", { body: text, questionId });
		this.commit(task, "attention_answered", { questionId });
		return this.snapshot(task);
	}

	private pendingAttention(task: Task, questionId: string): TaskAttention {
		const attention = task.attention;
		if (task.ended || !attention || attention.id !== questionId || attention.answer || attention.closed ||
			!task.runs.some((run) => run.id === attention.runId && !run.endedAt))
			throw new TaskError("QUESTION_STALE", "问题已被回答、替换或失效");
		return attention;
	}

	private archiveAttention(task: Task, reason?: NonNullable<TaskAttention["closed"]>["reason"]): void {
		if (!task.attention) return;
		if (reason && !task.attention.answer) task.attention.closed = { reason, at: Date.now() };
		(task.attentionHistory ??= []).push(structuredClone(task.attention));
		task.attention = undefined;
	}

	startRun(taskId: string, trigger: TaskRun["trigger"], model: string): TaskRun {
		const task = this.require(taskId);
		const run: TaskRun = {
			id: `${task.id}-R${task.runs.length + 1}`,
			n: task.runs.length + 1,
			trigger,
			model,
			startedAt: Date.now(),
		};
		task.runs.push(run);
		task.queue = undefined;
		this.commit(task, "run_started", { runId: run.id, n: run.n, trigger });
		return run;
	}

	setRunModel(taskId: string, runId: string, model: string): void {
		const task = this.require(taskId);
		const run = task.runs.find((item) => item.id === runId);
		if (!run) throw new TaskError("RUN_NOT_FOUND", "运行不存在");
		run.model = model;
		this.commit(task, "task_updated", { runId, model });
	}

	/** Record a worker report. Terminal states end the task immediately (docs 01 §4.5). */
	report(
		taskId: string,
		runId: string,
		state: ReportState,
		summary: string,
		question?: string | null,
		options?: string[],
	): { task: Task; attention?: TaskAttention; attentionOpened: boolean; ended: boolean } {
		const task = this.require(taskId);
		const run = task.runs.find((item) => item.id === runId);
		if (!run) throw new TaskError("RUN_NOT_FOUND", "运行不存在");
		if (task.ended || run.endedAt) throw new TaskError("ALREADY_ENDED", "任务或运行已结束，不能再汇报");
		run.lastReport = { state, summary, at: Date.now() };
		let attention: TaskAttention | undefined;
		let attentionOpened = false;
		if (state === "progress" || state === "blocked") {
			if (question === null) this.archiveAttention(task, "cleared");
			if (question?.trim()) {
				const previous = task.attention ?? task.attentionHistory?.findLast((item) => item.answer && item.runId === runId && item.question === question &&
					(options === undefined || JSON.stringify(item.options) === JSON.stringify(options)));
				const same = previous?.runId === runId && previous.question === question &&
					(options === undefined || JSON.stringify(previous.options) === JSON.stringify(options));
				if (same) attention = previous;
				else {
					this.archiveAttention(task, "replaced");
					attention = {
						id: `Q-${this.nextAttention++}`,
						question,
						options: options ? [...options] : undefined,
						runId,
						askedAt: Date.now(),
					};
					task.attention = attention;
					attentionOpened = true;
				}
			}
		}
		this.commit(task, "task_report", { runId, state, summary, question, attentionId: attention?.id, attentionOpened });
		if (attentionOpened) this.events.append("attention_opened", { task, attention });
		if (state === "ready" || state === "failed" || state === "dropped") {
			this.archiveAttention(task, "task_ended");
			this.endRun(task, run, state);
			this.end(task, state === "ready" ? "done" : state, "worker", summary);
		}
		return { task: this.snapshot(task), attention, attentionOpened, ended: Boolean(task.ended) };
	}

	endRunInterrupted(taskId: string, reason: "interrupted" | "stalled" | "cancelled"): void {
		const task = this.tasks.get(taskId);
		const run = task?.runs.find((item) => !item.endedAt);
		if (!task || !run) return;
		this.endRun(task, run, reason);
	}

	recordStallRetry(taskId: string, runId: string): boolean {
		const task = this.require(taskId); const run = task.runs.find(item => item.id === runId);
		if (!run || task.ended || run.endedAt || run.stallRetries) return false;
		run.stallRetries = 1; this.commit(task, "run_stall_retry", { runId }); return true;
	}

	failStalled(taskId: string, runId: string, summary: string): void {
		const task = this.require(taskId); const run = task.runs.find(item => item.id === runId);
		if (!run || task.ended || run.endedAt) return;
		run.lastReport = { state: "failed", summary, at: Date.now() };
		this.commit(task, "task_report", { runId, state: "failed", summary, source: "watchdog" });
		this.endRun(task, run, "stalled"); this.end(task, "failed", "system", summary);
	}

	cancelRunning(taskId: string, by: "main" | "system", authorization: { actor: "main" | "user" | "system"; basis: string[] } = { actor: by, basis: [] }): Task {
		const task = this.require(taskId);
		if (task.ended) return this.snapshot(task);
		this.audit?.append("cancel", { taskId, actor: authorization.actor, basis: authorization.basis });
		this.archiveAttention(task, "task_ended");
		const run = task.runs.find((item) => !item.endedAt);
		if (run) this.endRun(task, run, "cancelled");
		this.end(task, "cancelled", by);
		return this.snapshot(task);
	}

	setQueue(taskId: string, reason: QueueReason | null, holder?: string): void {
		const task = this.tasks.get(taskId);
		if (!task || task.ended) return;
		if (!reason) {
			if (!task.queue) return;
			task.queue = undefined;
			this.commit(task, "task_dequeued", {});
			return;
		}
		if (task.queue?.reason === reason && task.queue.holder === holder) return;
		task.queue = { reason, holder };
		this.commit(task, "task_queued", { reason, holder });
	}

	recordChangedFiles(taskId: string, files: string[]): void {
		const task = this.tasks.get(taskId);
		if (!task || files.length === 0) return;
		const merged = new Set(task.changedFiles ?? []);
		for (const file of files) merged.add(file);
		task.changedFiles = [...merged];
		this.commit(task, "task_files_changed", { files: task.changedFiles });
	}

	recordUsage(taskId: string, usage: TaskUsage): void {
		const task = this.tasks.get(taskId);
		if (!task) return;
		task.usage.inputTokens += usage.inputTokens;
		task.usage.outputTokens += usage.outputTokens;
		task.usage.toolCalls += usage.toolCalls;
		for (const key of ["cacheReadTokens", "cacheWriteTokens", "costUsd"] as const) {
			if (usage[key] !== undefined) task.usage[key] = (task.usage[key] ?? 0) + usage[key];
		}
		if (usage.costIncomplete) task.usage.costIncomplete = true;
		// The final reply/tool often arrives after task_ended: persist and publish every delta.
		this.commit(task, "usage_updated");
	}

	/** Find tasks whose declared scope overlaps another running task. */
	overlapWarnings(task: Task, running = this.runningTasks()): ScopeWarning[] {
		if (task.scope.length === 0) return [];
		const warnings: ScopeWarning[] = [];
		for (const other of running) {
			if (other.id === task.id) continue;
			const paths = overlappingPaths(task.scope, other.scope);
			if (paths.length > 0) warnings.push({ withTaskId: other.id, paths });
		}
		return warnings;
	}

	private runningTasks(): Task[] {
		return [...this.tasks.values()].filter((task) => !task.ended && task.runs.some((run) => !run.endedAt));
	}

	private addInput(
		task: Task,
		kind: TaskInputKind,
		payload: { note?: string; body?: string; quotes?: Quote[]; questionId?: string; jobId?: string },
	): TaskInput {
		const input: TaskInput = {
			id: `I-${task.inputs.length + 1}`,
			kind,
			quotes: payload.quotes,
			note: payload.note,
			body: payload.body,
			questionId: payload.questionId,
			jobId: payload.jobId,
			at: Date.now(),
		};
		task.inputs.push(input);
		this.commit(task, "task_input", { inputId: input.id, kind });
		return input;
	}

	private endRun(task: Task, run: TaskRun, reason: NonNullable<TaskRun["endReason"]>): void {
		if (task.attention?.runId === run.id) this.archiveAttention(task, "run_ended");
		run.endedAt = Date.now();
		run.endReason = reason;
		this.events.append("run_ended", { task, runId: run.id, endReason: reason });
	}

	private end(task: Task, outcome: TaskOutcome, by: "worker" | "main" | "system", reason?: string): void {
		this.archiveAttention(task, "task_ended");
		task.ended = { at: Date.now(), outcome, by, reason };
		task.queue = undefined;
		this.events.append("task_ended", { task, outcome, by, changedFiles: task.changedFiles ?? [] });
		this.onChange(task, "task_ended");
	}

	private commit(task: Task, kind: EventKind, data: Record<string, unknown> = {}): void {
		task.updatedAt = Date.now();
		this.events.append(kind, { task, ...data });
		this.onChange(task, kind);
	}

	private snapshot(task: Task): Task {
		return task;
	}

	private require(taskId: string): Task {
		const task = this.tasks.get(taskId);
		if (!task) throw new TaskError("TASK_NOT_FOUND", "任务不存在");
		return task;
	}

	private replay(records: readonly LoggedEvent[]): void {
		for (const event of records) {
			if (event.kind === "access_recorded" && typeof event.data.taskId === "string" && event.data.access) {
				const entries = this.accesses.get(event.data.taskId) ?? [];
				entries.push(structuredClone(event.data.access as TaskAccess));
				this.accesses.set(event.data.taskId, entries);
				continue;
			}
			if (event.kind === "assistant_message" && typeof event.data.taskId === "string" && event.data.message) {
				this.applyAssistant(event.data.taskId, { ...event.data.message as AssistantMessageView, streaming: false });
				continue;
			}
			if (event.kind === "tool_activity" && typeof event.data.taskId === "string" && event.data.call) {
				this.applyTool(event.data.taskId, event.data.call as ToolCall);
				continue;
			}
			const candidate = event.data.task as Task | undefined;
			if (!candidate || typeof candidate.id !== "string" || !Array.isArray(candidate.runs)) continue;
			this.tasks.set(candidate.id, structuredClone(candidate));
			const numeric = Number(candidate.id.slice(2));
			if (Number.isFinite(numeric)) this.nextTask = Math.max(this.nextTask, numeric + 1);
			for (const attention of [...(candidate.attentionHistory ?? []), ...(candidate.attention ? [candidate.attention] : [])]) {
				const n = Number(attention.id.slice(2));
				if (Number.isFinite(n)) this.nextAttention = Math.max(this.nextAttention, n + 1);
			}
		}
		// A crash may occur between access_recorded and the following task snapshot.
		for (const [taskId, entries] of this.accesses) {
			const task = this.tasks.get(taskId);
			if (!task) continue;
			const writes = entries.filter((entry) => (entry.kind === "fs_write" || entry.kind === "fs_delete") && entry.coverage !== "command_scope").map((entry) => entry.target);
			if (writes.length) task.changedFiles = [...new Set([...(task.changedFiles ?? []), ...writes])];
		}
	}
}

export class TaskError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

/** Normalize a path for display and comparison (04 §2.4). No realpath here: it may not exist yet. */
export function normalizePath(input: string, base: string): string {
	const absolute = isAbsolute(input) ? resolve(input) : resolve(base, input);
	return absolute.replace(/\//g, sep);
}

/** Segment-prefix overlap on lower-cased paths. */
export function pathsOverlap(a: string, b: string): boolean {
	const left = a.toLowerCase().replace(/[\\/]+$/, "");
	const right = b.toLowerCase().replace(/[\\/]+$/, "");
	return left === right || left.startsWith(`${right}${sep}`) || right.startsWith(`${left}${sep}`);
}

function overlappingPaths(left: string[], right: string[]): string[] {
	const hits: string[] = [];
	for (const a of left) {
		for (const b of right) if (pathsOverlap(a, b)) hits.push(a);
	}
	return [...new Set(hits)];
}

/** Resolve the declared scope entries against the task cwd. */
export function resolveScope(scope: string[] | undefined, cwd: string): string[] {
	return (scope ?? []).map((entry) => normalizePath(entry, cwd)).filter((entry) => entry.length > 0);
}

/** Output dir under the default workspace: outputs/<taskId>-<slug>/. */
export function taskOutputDir(workspaceDir: string, taskId: string, title: string): string {
	const slug =
		basename(title)
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 24) || "task";
	return resolve(workspaceDir, "outputs", `${taskId}-${slug}`);
}

export function ensureDir(dir: string): void {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
