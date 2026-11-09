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
} from "../../shared/task.ts";
import { taskView } from "../../shared/task.ts";
import type { EventKind, EventLog } from "./event-log.ts";

export interface CreateTaskInput {
	title: string;
	quotes: Quote[];
	note?: string;
	cwd: string;
	scope: string[];
	mode: TaskMode;
	dependsOn: string[];
	autoApprove: boolean;
}

export interface ScopeWarning {
	withTaskId: string;
	paths: string[];
}

export class TaskStore {
	private readonly tasks = new Map<string, Task>();
	private readonly workspaceDir: string;
	private readonly events: EventLog;
	private readonly onChange: (task: Task, kind: string) => void;
	private nextTask = 1045;
	private nextAttention = 1;

	constructor(events: EventLog, workspaceDir: string, onChange: (task: Task, kind: string) => void) {
		this.events = events;
		this.workspaceDir = workspaceDir;
		this.onChange = onChange;
		this.replay();
	}

	/** Persisted tasks, newest first. */
	list(): Task[] {
		return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
	}

	get(id: string): Task | undefined {
		return this.tasks.get(id);
	}

	board(active: number, limit: number, now = Date.now()): TaskBoard {
		const open = this.list().filter((task) => !task.ended);
		const ended = this.list()
			.filter((task) => task.ended)
			.slice(0, 8);
		return { tasks: [...open, ...ended].map((task) => taskView(task, now)), active, limit, autoApprove: false };
	}

	create(input: CreateTaskInput): { task: Task; warnings: ScopeWarning[] } {
		const now = Date.now();
		const id = `T-${this.nextTask++}`;
		const outputDir = taskOutputDir(this.workspaceDir, id, input.title);
		const task: Task = {
			id,
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
		task.approval = { state: "approved", by, basis, at: Date.now() };
		this.commit(task, "task_approved", { by, basis });
		return this.snapshot(task);
	}

	cancel(taskId: string, by: "main" | "system", reason?: string): Task {
		const task = this.require(taskId);
		if (task.ended) return this.snapshot(task);
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
		task.attention = undefined;
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

	answerAttention(taskId: string, text: string, by: "main" | "user", basis: string[]): Task {
		const task = this.require(taskId);
		if (!task.attention) throw new TaskError("NO_QUESTION", "该任务没有待回答的问题");
		const questionId = task.attention.id;
		task.attention.answer = { by, basis, text, at: Date.now() };
		this.addInput(task, "answer", { body: text });
		this.commit(task, "attention_answered", { questionId });
		return this.snapshot(task);
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
		question?: string,
		options?: string[],
	): { task: Task; attention?: TaskAttention; ended: boolean } {
		const task = this.require(taskId);
		const run = task.runs.find((item) => item.id === runId);
		if (!run) throw new TaskError("RUN_NOT_FOUND", "运行不存在");
		if (task.ended || run.endedAt) throw new TaskError("ALREADY_ENDED", "任务或运行已结束，不能再汇报");
		run.lastReport = { state, summary, at: Date.now() };
		let attention: TaskAttention | undefined;
		if (state === "progress" || state === "blocked") {
			if (question?.trim()) {
				attention = {
					id: `Q-${this.nextAttention++}`,
					question: question.trim(),
					options,
					runId,
					askedAt: Date.now(),
				};
				task.attention = attention;
			}
		}
		this.commit(task, "task_report", { runId, state, summary, question });
		if (attention) this.events.append("attention_opened", { task, attention });
		if (state === "ready" || state === "failed" || state === "dropped") {
			this.endRun(task, run, state);
			this.end(task, state === "ready" ? "done" : state, "worker", summary);
		}
		return { task: this.snapshot(task), attention, ended: Boolean(task.ended) };
	}

	endRunInterrupted(taskId: string, reason: "interrupted" | "stalled" | "cancelled"): void {
		const task = this.tasks.get(taskId);
		const run = task?.runs.find((item) => !item.endedAt);
		if (!task || !run) return;
		this.endRun(task, run, reason);
	}

	cancelRunning(taskId: string, by: "main" | "system"): Task {
		const task = this.require(taskId);
		if (task.ended) return this.snapshot(task);
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

	recordUsage(taskId: string, usage: { inputTokens: number; outputTokens: number; toolCalls: number }): void {
		const task = this.tasks.get(taskId);
		if (!task) return;
		task.usage.inputTokens += usage.inputTokens;
		task.usage.outputTokens += usage.outputTokens;
		task.usage.toolCalls += usage.toolCalls;
		// Usage is high-frequency; keep it in the snapshot without an extra event per delta.
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
		payload: { note?: string; body?: string; quotes?: Quote[] },
	): TaskInput {
		const input: TaskInput = {
			id: `I-${task.inputs.length + 1}`,
			kind,
			quotes: payload.quotes,
			note: payload.note,
			body: payload.body,
			at: Date.now(),
		};
		task.inputs.push(input);
		this.commit(task, "task_input", { inputId: input.id, kind });
		if (task.attention?.answer) task.attention = undefined;
		return input;
	}

	private endRun(task: Task, run: TaskRun, reason: NonNullable<TaskRun["endReason"]>): void {
		run.endedAt = Date.now();
		run.endReason = reason;
		this.events.append("run_ended", { task, runId: run.id, endReason: reason });
	}

	private end(task: Task, outcome: TaskOutcome, by: "worker" | "main" | "system", reason?: string): void {
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

	private replay(): void {
		for (const event of this.events.all()) {
			const candidate = event.data.task as Task | undefined;
			if (!candidate || typeof candidate.id !== "string" || !Array.isArray(candidate.runs)) continue;
			this.tasks.set(candidate.id, candidate);
			const numeric = Number(candidate.id.slice(2));
			if (Number.isFinite(numeric)) this.nextTask = Math.max(this.nextTask, numeric + 1);
			const attention = candidate.attention?.id;
			if (attention) {
				const n = Number(attention.slice(2));
				if (Number.isFinite(n)) this.nextAttention = Math.max(this.nextAttention, n + 1);
			}
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
