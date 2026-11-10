// One Pi session per task (docs 04 §4). The worker only talks to the supervisor through tools;
// every tool event is translated into task facts (changed files, usage) on the way through.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	SessionManager,
	type ToolDefinition,
} from "@rally/coding-agent";
import type { Static, TSchema } from "typebox";
import type { AssistantMessage } from "@rally/ai";
import type { RallyPaths } from "../../shared/ipc.ts";
import type { Quote, ReportState, Task, TaskAccess, TaskInput, TaskRun } from "../../shared/task.ts";
import { toolInput, toolOutput } from "../../shared/tools.ts";
import { assistantContent, type AssistantMessageView } from "../../shared/conversation.ts";
import { WORKER_SYSTEM_PROMPT } from "../prompts.ts";
import type { ModelStore } from "../model-store.ts";
import { closeRoleSession, createRoleSession } from "./session.ts";
import { workerMcpExtensions } from "./mcp.ts";
import type { TaskStore } from "./task-store.ts";
import type { GateService } from "./gates.ts";
import type { AuditLog } from "./audit.ts";
import { createVersionedFileTools, FileVersions } from "./file-versions.ts";
import { resolveToolPath as resolveWritePath, withinOutput } from "./file-paths.ts";
import { createFileDeleteTool } from "./file-delete.ts";
import { createGitTool } from "./git-tool.ts";
import { managedGitRunner } from "./git-runner.ts";
import { createGithubTool } from "./github-tool.ts";
import { managedGithubRunner } from "./github-runner.ts";
import type { NetworkRunner } from "./network-runner.ts";
import { createFetchPageTool, createHttpRequestTool } from "./network-tools.ts";
import type { ProcessRegistry } from "./process-registry.ts";
import type { JobManager } from "./jobs.ts";
import type { ServiceManager } from "./services.ts";
import { createServiceTools } from "./service-tools.ts";
import { createJobTools } from "./job-tools.ts";
import { managedSearchExecution } from "./search-process.ts";

export interface ReportResult {
	taskId: string;
	ended: boolean;
	notifiedMain: boolean;
	attentionId?: string;
	answer?: string;
}

export interface WorkerManagerOptions {
	paths: RallyPaths;
	store: TaskStore;
	models: ModelStore;
	gates: GateService;
	audit: AuditLog;
	processes: ProcessRegistry;
	network: NetworkRunner;
	jobs: JobManager;
	services: ServiceManager;
	/** Injectable monotonic clock for inactivity tests; real thresholds remain ten minutes. */
	watchdogNow?: () => number;
	createTools(task: Task): ToolDefinition[];
	report(
		task: Task,
		runId: string,
		state: ReportState,
		summary: string,
		question?: string | null,
		options?: string[],
	): ReportResult;
	/** Called whenever a worker session starts or stops streaming, so the scheduler can re-count slots. */
	onBusyChange(): void;
}

interface Worker {
	taskId: string;
	runId: string;
	session: AgentSession;
	unsubscribe: () => void;
	streaming: boolean;
	lastText: string;
	messageSequence: number;
	message?: AssistantMessageView;
	toolCalls: number;
	priced: boolean;
	reportedThisTurn: boolean;
	reportedState?: ReportState;
	nudged: boolean;
	disposed: boolean;
	lastActivity: number;
	jobExempt: boolean;
	recovering: boolean;
}
interface OpeningWorker {
	task: Task;
	run: TaskRun;
	lastActivity: number;
	jobExempt: boolean;
	recovering: boolean;
	controller: AbortController;
	session?: AgentSession;
	stop?: Promise<void>;
	selection?: NonNullable<ReturnType<ModelStore["selection"]>>;
}

export class WorkerManager {
	private readonly workers = new Map<string, Worker>();
	private readonly starting = new Set<Promise<void>>();
	private readonly closing = new Map<string, Promise<void>>();
	private readonly options: WorkerManagerOptions;
	private disposed = false;
	private disposal?: Promise<void>;
	private readonly closeErrors: unknown[] = [];
	private watchdogTimer?: NodeJS.Timeout;
	private readonly opening = new Map<string, OpeningWorker>();

	constructor(options: WorkerManagerOptions) {
		this.options = options;
	}

	/** Streaming and running jobs share one slot per task (docs 04 §3.2). */
	streamingCount(): number {
		return this.streamingIds().length;
	}

	streamingIds(): string[] {
		return [...new Set([...this.workers.values()].filter(worker => worker.streaming).map(worker => worker.taskId).concat(this.options.jobs.activeTaskIds()))];
	}

	has(taskId: string): boolean {
		return this.workers.has(taskId);
	}

	/** Create the task session and send the assignment message (docs 03 §5.1). */
	start(task: Task, run: TaskRun): Promise<void> {
		if (this.disposed) return Promise.resolve();
		const opening: OpeningWorker = { task, run, lastActivity: this.now(), jobExempt: this.options.jobs.hasBackground(task.id), recovering: false, controller: new AbortController() };
		this.opening.set(task.id, opening); this.watch();
		const pending = this.openWorker(opening).finally(() => { this.starting.delete(pending); if (this.opening.get(task.id) === opening) this.opening.delete(task.id); });
		this.starting.add(pending);
		return pending;
	}

	private async openWorker(opening: OpeningWorker): Promise<void> {
		for (;;) {
			try { await this.startWorker(opening.task, opening.run, opening); return; }
			catch (error) {
				await opening.stop;
				if (this.disposed || opening.task.ended || opening.run.endedAt) return;
				if (!opening.recovering) throw error;
				opening.controller = new AbortController(); opening.session = undefined; opening.stop = undefined; opening.recovering = false; opening.lastActivity = this.now();
				this.options.store.nudge(opening.task.id, STALL_TEXT);
			}
		}
	}

	private async startWorker(task: Task, run: TaskRun, opening: OpeningWorker): Promise<void> {
		const { paths, store } = this.options;
		// A terminal report can be resumed before the old turn's final sentence settles.
		const previous = this.workers.get(task.id);
		if (previous) await this.disposeWorker(previous); else await this.closing.get(task.id);
		const file = join(paths.sessionsTasksDir, `${task.id}.jsonl`);
		const runtime = await this.options.models.whenReady();
		if (this.disposed || task.ended || run.endedAt) return;
		opening.controller.signal.throwIfAborted();
		const selection = opening.selection ??= this.options.models.selection("worker") ?? undefined;
		if (!runtime || !selection) throw new WorkerError("NO_MODEL", "尚未配置任务 agent 的模型，请在设置 → 供应商中选择任务 agent 模型与思考强度");
		const sessionManager = SessionManager.open(file, paths.sessionsTasksDir, task.cwd);
		const versions = new FileVersions(sessionManager);
		const { session } = await createRoleSession({
			startupSignal: opening.controller.signal,
			onSessionCreated: session => { opening.session = session; },
			cwd: task.cwd,
			agentDir: paths.agentDir,
			sessionManager,
			modelRuntime: runtime,
			model: selection.model,
			thinkingLevel: selection.thinkingLevel,
			rolePrompt: WORKER_SYSTEM_PROMPT,
			loadProjectContext: true,
			loadProjectSkills: true,
			...workerMcpExtensions(paths.agentDir, task, run, () => !this.disposed && !task.ended && !run.endedAt, {
				gates: this.options.gates, audit: this.options.audit, processes: this.options.processes,
				external: (tool) => store.recordExternalAction(task.id, tool),
			}),
			tools: [],
			customTools: [...this.options.createTools(task), ...buildTools(task, versions, (path) => this.assertWritable(task, run, path), this.options.processes),
				...createJobTools(this.options.jobs, task, run),
				...createServiceTools(this.options.services, task, run),
				headless(createFileDeleteTool({ task, run, store, versions, gates: this.options.gates, isActive: () => !this.disposed && !task.ended && !run.endedAt })),
				createGitTool({ task, run, store, gates: this.options.gates, audit: this.options.audit, isActive: () => !this.disposed && !task.ended && !run.endedAt }, managedGitRunner(this.options.processes, task.id)),
				createGithubTool({ task, run, store, audit: this.options.audit, isActive: () => !this.disposed && !task.ended && !run.endedAt }, managedGithubRunner(this.options.processes, task.id)),
				createFetchPageTool(this.options.network, { task, run, store, isActive: () => !this.disposed && !task.ended && !run.endedAt }),
				createHttpRequestTool(this.options.network, { task, run, store, isActive: () => !this.disposed && !task.ended && !run.endedAt }),
			].map((tool) => this.guardTool(task, run, tool)),
		});
		if (this.disposed || task.ended || run.endedAt) {
			await closeRoleSession(session);
			return;
		}
		store.setRunModel(task.id, run.id, `${selection.model.provider}/${selection.model.id}`);

		const label = session.model ? `${session.model.provider}/${session.model.id}` : "";
		if (!label || label.startsWith("unknown/")) {
			await closeRoleSession(session);
			throw new WorkerError("NO_MODEL", "尚未配置任务 agent 的模型");
		}

		const worker: Worker = {
			taskId: task.id,
			runId: run.id,
			session,
			unsubscribe: () => {},
			streaming: true,
			lastText: "",
			messageSequence: 0,
			toolCalls: 0,
			priced: Object.values(selection.model.cost).some((price) => typeof price === "number" && price > 0),
			reportedThisTurn: false,
			nudged: false,
			disposed: false,
			lastActivity: this.now(), jobExempt: this.options.jobs.hasBackground(task.id), recovering: false,
		};
		worker.unsubscribe = session.subscribe((event) => this.handle(worker, event));
		this.workers.set(task.id, worker);
		this.opening.delete(task.id);
		this.options.onBusyChange();

		const pending = task.inputs.filter((input) => !input.deliveredAt);
		const message = [assignmentMessage(task, run, this.upstreams(task)), ...pending.map(inputBlock)].join("\n\n");
		for (const input of pending) store.markDelivered(task.id, input.id);
		void session.sendUserMessage(message).catch((error: unknown) => this.fail(worker, error));
	}

	/** Remember that this turn reported, so the end-of-turn nudge logic stays quiet. */
	noteReport(taskId: string, state: ReportState): void {
		const worker = this.workers.get(taskId);
		if (!worker) return;
		worker.reportedThisTurn = true;
		worker.reportedState = state;
		worker.nudged = false;
	}

	/** Steer or answer an open worker. Streaming workers get the text injected; idle ones wake. */
	deliver(taskId: string, text: string, inputId?: string): boolean {
		const worker = this.workers.get(taskId);
		if (!worker || worker.disposed || worker.recovering) return false;
		const task = this.options.store.get(taskId);
		if (!task || task.ended || task.approval.state !== "approved" || task.runs.find((run) => run.id === worker.runId)?.endedAt) return false;
		if (!worker.session.isStreaming || !worker.streaming) {
			this.options.onBusyChange();
			return false;
		}
		void worker.session
			.sendUserMessage(text, { deliverAs: "steer" })
			.catch((error: unknown) => this.fail(worker, error));
		if (inputId) this.options.store.markDelivered(taskId, inputId);
		worker.streaming = true;
		this.options.onBusyChange();
		return true;
	}

	pendingIds(): string[] {
		return [...this.workers.values()].filter(worker => {
			const task = this.options.store.get(worker.taskId);
			return !worker.disposed && !worker.streaming && task && !task.ended && task.approval.state === "approved" && !task.runs.find(run => run.id === worker.runId)?.endedAt && task.inputs.some(input => !input.deliveredAt);
		}).map(worker => worker.taskId);
	}

	/** Called only after the scheduler admits this task, including any job-held slot. */
	wake(taskId: string): void {
		if (!this.pendingIds().includes(taskId)) return;
		const worker = this.workers.get(taskId)!; const task = this.options.store.get(taskId)!;
		const pending = task.inputs.filter(input => !input.deliveredAt);
		worker.streaming = true;
		worker.lastActivity = this.now();
		for (const input of pending) this.options.store.markDelivered(task.id, input.id);
		void worker.session.sendUserMessage(pending.map(inputBlock).join("\n\n")).catch((error: unknown) => this.fail(worker, error));
	}

	/** Shell output is activity even before a command becomes a background job. */
	noteActivity(taskId: string): void {
		const worker = this.workers.get(taskId);
		if (worker && !worker.disposed && !worker.recovering) worker.lastActivity = this.now();
	}

	/** Background jobs suspend the inactivity clock, including the instant the final job ends. */
	jobsChanged(): void {
		for (const opening of this.opening.values()) {
			const running = this.options.jobs.hasBackground(opening.task.id);
			if (running || opening.jobExempt) opening.lastActivity = this.now();
			opening.jobExempt = running;
		}
		for (const worker of this.workers.values()) {
			const running = this.options.jobs.hasBackground(worker.taskId);
			if (running || worker.jobExempt) worker.lastActivity = this.now();
			worker.jobExempt = running;
		}
	}

	checkStalled(): void {
		if (this.disposed) return;
		this.jobsChanged();
		for (const opening of this.opening.values()) {
			const { task, run } = opening;
			if (task.ended || run.endedAt) continue;
			if (opening.jobExempt) continue;
			if (this.now() - opening.lastActivity < STALL_MS) continue;
			if (run.stallRetries) this.options.store.failStalled(task.id, run.id, "worker 初始化自动重试或中止等待后再次连续 10 分钟无事件。");
			else if (this.options.store.recordStallRetry(task.id, run.id)) { opening.recovering = true; opening.lastActivity = this.now(); }
			opening.controller.abort();
			if (opening.session && !opening.stop) { opening.stop = closeRoleSession(opening.session); void opening.stop.catch(error => { this.closeErrors.push(error); }); }
		}
		for (const worker of this.workers.values()) {
			const task = this.options.store.get(worker.taskId); const run = task?.runs.find(run => run.id === worker.runId);
			if (!task || task.ended || !run || run.endedAt || worker.disposed || !worker.streaming || worker.jobExempt || this.now() - worker.lastActivity < STALL_MS) continue;
			if (run.stallRetries) {
				this.options.store.failStalled(task.id, run.id, worker.recovering ? "worker 连续 10 分钟无事件，且中止等待再次超过 10 分钟；未启动重叠重试。" : "worker 自动重试后再次连续 10 分钟无事件。");
				void this.disposeWorker(worker); continue;
			}
			if (!this.options.store.recordStallRetry(task.id, run.id)) continue;
			worker.recovering = true; worker.lastActivity = this.now();
			void this.retryStalled(worker);
		}
	}

	private async retryStalled(worker: Worker): Promise<void> {
		try {
			await worker.session.abort();
			const task = this.options.store.get(worker.taskId); const run = task?.runs.find(run => run.id === worker.runId);
			if (this.disposed || worker.disposed || !task || task.ended || !run || run.endedAt) return;
			this.finishMessage(worker); this.interruptTools(worker);
			worker.nudged = false; worker.reportedThisTurn = false; worker.reportedState = undefined;
			this.options.store.nudge(task.id, STALL_TEXT);
			const pending = task.inputs.filter(input => !input.deliveredAt);
			for (const input of pending) this.options.store.markDelivered(task.id, input.id);
			worker.recovering = false; worker.lastActivity = this.now(); worker.streaming = true;
			void worker.session.sendUserMessage(pending.map(inputBlock).join("\n\n")).catch(error => this.fail(worker, error));
		} catch (error) {
			if (this.disposed || worker.disposed) return;
			this.options.store.failStalled(worker.taskId, worker.runId, `worker 卡死恢复失败：${String(error)}`);
			void this.disposeWorker(worker);
		}
	}

	private now(): number { return this.options.watchdogNow?.() ?? performance.now(); }
	private watch(): void {
		if (!this.watchdogTimer) { this.watchdogTimer = setInterval(() => { try { this.checkStalled(); } catch (error) { console.error("Worker watchdog failed", error); } }, 1000); this.watchdogTimer.unref(); }
	}

	private guardTool(task: Task, run: TaskRun, tool: ToolDefinition): ToolDefinition {
		return { ...tool, execute: async (id, params, signal, onUpdate, ctx) => {
			if (this.disposed || task.ended || run.endedAt) throw new WorkerError("TASK_ENDED", "任务或运行已结束，不能再调用工具");
			let input = params;
			if (tool.name === "write" || tool.name === "edit") {
				if (!params || typeof params !== "object" || !("path" in params) || typeof params.path !== "string") throw new WorkerError("PATH_REQUIRED", "缺少文件路径");
				const path = resolveWritePath(params.path, task.cwd);
				this.assertWritable(task, run, path);
				input = { ...params, path };
			}
			const access = toolAccess(task, run, tool.name, id, input);
			// Shell may fail after touching files; record the attempt without inferring its effects.
			if (access?.kind === "shell") this.options.store.recordAccess(task.id, access);
			const result = await tool.execute(id, input, signal, onUpdate, ctx);
			if (tool.name === "service_start" && result.details && typeof result.details === "object" && "serviceId" in result.details && typeof result.details.serviceId === "string") {
				this.options.store.recordAccess(task.id, { runId: run.id, toolCallId: id, tool: tool.name, at: Date.now(), kind: "service", target: result.details.serviceId });
			}
			if (access?.kind === "shell" && result.details && typeof result.details === "object" && "jobId" in result.details && typeof result.details.jobId === "string") {
				this.options.store.recordAccess(task.id, { ...access, kind: "job", target: result.details.jobId });
			}
			if (!result.isError && access && access.kind !== "shell") this.options.store.recordAccess(task.id, access);
			return result;
		} };
	}

	private assertWritable(task: Task, run: TaskRun, path: string): void {
		if (this.disposed || task.ended || run.endedAt) throw new WorkerError("TASK_ENDED", "任务或运行已结束，不能再调用工具");
		if (task.mode === "readonly" && !withinOutput(task.outputDir, path)) {
			throw new WorkerError("READONLY_TASK", "只读任务不能写项目目录；需要改动请汇报 blocked 说明原因");
		}
	}

	/** Stop the turn and its MCP transports together, including a connection still starting. */
	abort(taskId: string): Promise<void> {
		const opening = this.opening.get(taskId);
		if (opening) { opening.controller.abort(); if (opening.session) opening.stop ??= closeRoleSession(opening.session); }
		const worker = this.workers.get(taskId);
		return Promise.all([worker ? this.disposeWorker(worker) : this.closing.get(taskId), opening?.stop]).then(() => {});
	}

	/** Jack out every session without touching task facts; startup recovery marks the runs interrupted. */
	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		if (this.watchdogTimer) clearInterval(this.watchdogTimer);
		for (const opening of this.opening.values()) { opening.controller.abort(); if (opening.session) { opening.stop ??= closeRoleSession(opening.session); void opening.stop.catch(error => { this.closeErrors.push(error); }); } }
		for (const worker of this.workers.values()) void this.disposeWorker(worker);
		// A startup that finishes after this point closes its own newly created session.
		this.disposal = Promise.all([
			...this.closing.values(),
			...Array.from(this.starting, (pending) => pending.catch(error => { this.closeErrors.push(error); })),
		]).then(() => {
			if (this.closeErrors.length) throw new AggregateError(this.closeErrors, "Worker sessions shutdown failed");
		});
		return this.disposal;
	}

	private handle(worker: Worker, event: AgentSessionEvent): void {
		if (worker.disposed) return;
		if (!worker.recovering) worker.lastActivity = this.now();
		switch (event.type) {
			case "agent_start":
				worker.streaming = true;
				this.options.onBusyChange();
				return;
			case "message_start":
				if (event.message.role === "assistant") {
					this.finishMessage(worker);
					worker.lastText = "";
					worker.message = { id: `${worker.runId}:assistant:${++worker.messageSequence}`, runId: worker.runId, at: Date.now(), streaming: true, ...assistantContent(event.message, `${worker.runId}:`) };
					this.options.store.recordAssistant(worker.taskId, worker.message, false);
				}
				return;
			case "message_update":
				if (event.message.role === "assistant") this.updateMessage(worker, event.message);
				return;
			case "message_end":
				if (event.message.role === "assistant") {
					this.updateMessage(worker, event.message);
					this.finishMessage(worker);
					this.countUsage(worker, event.message);
					if (event.message.stopReason === "error") this.fail(worker, event.message.errorMessage ?? "模型调用失败");
				}
				return;
			case "tool_execution_start":
				this.options.store.recordTool(worker.taskId, { id: `${worker.runId}:${event.toolCallId}`, runId: worker.runId, name: event.toolName, input: toolInput(event.args), status: "running", startedAt: Date.now() });
				return;
			case "tool_execution_end":
				{
					const call = this.options.store.timeline(worker.taskId).find((item) => item.id === `${worker.runId}:${event.toolCallId}`);
					if (call) this.options.store.recordTool(worker.taskId, { ...call, status: event.isError ? "error" : "ok", endedAt: Date.now(), output: toolOutput(event.result) });
				}
				this.finishTool(worker);
				return;
			case "agent_end":
				if (worker.recovering) return;
				if (event.willRetry) return;
				this.finishMessage(worker);
				this.turnEnded(worker);
				return;
			case "agent_settled":
				if (worker.recovering) return;
				worker.streaming = false;
				this.options.onBusyChange();
				return;
		}
	}

	private updateMessage(worker: Worker, message: unknown): void {
		const content = assistantContent(message, `${worker.runId}:`);
		worker.lastText = content.text;
		if (!worker.message) return;
		Object.assign(worker.message, content);
		this.options.store.recordAssistant(worker.taskId, worker.message, false);
	}

	private finishMessage(worker: Worker): void {
		if (!worker.message) return;
		worker.message.streaming = false;
		this.options.store.recordAssistant(worker.taskId, worker.message, true);
		worker.message = undefined;
	}

	private countUsage(worker: Worker, message: AssistantMessage): void {
		const usage = message.usage;
		if (!usage) return;
		const input = Math.max(0, usage.input ?? 0);
		const cacheRead = Math.max(0, usage.cacheRead ?? 0);
		const cacheWrite = Math.max(0, usage.cacheWrite ?? 0);
		const output = Math.max(0, usage.output ?? 0);
		const costKnown = worker.priced || usage.cost?.totalFromProvider === true || (usage.cost?.total ?? 0) > 0;
		this.options.store.recordUsage(worker.taskId, {
			inputTokens: input + cacheRead + cacheWrite,
			outputTokens: output,
			cacheReadTokens: cacheRead,
			cacheWriteTokens: cacheWrite,
			costUsd: costKnown ? Math.max(0, usage.cost?.total ?? 0) : undefined,
			costIncomplete: !costKnown && input + cacheRead + cacheWrite + output > 0,
			toolCalls: 0,
		});
	}

	private finishTool(worker: Worker): void {
		worker.toolCalls++;
		this.options.store.recordUsage(worker.taskId, { inputTokens: 0, outputTokens: 0, toolCalls: 1 });
	}

	private turnEnded(worker: Worker): void {
		const task = this.options.store.get(worker.taskId);
		if (!task || worker.disposed) {
			worker.streaming = false;
			this.options.onBusyChange();
			return;
		}
		if (task.ended || task.runs.find((run) => run.id === worker.runId)?.endedAt) {
			worker.streaming = false;
			this.options.onBusyChange();
			this.disposeWorker(worker);
			return;
		}
		const last = task.runs.find((run) => run.id === worker.runId)?.lastReport;
		const reportedNow = worker.reportedThisTurn;
		worker.reportedThisTurn = false;
		// Keep the slot until agent_settled; waking here would nest a model turn.
		if (this.options.jobs.hasRunning(task.id) || task.inputs.some(input => input.kind === "job_done" && !input.deliveredAt)) return;

		// A report that leaves the worker waiting on another party is not a forgotten report.
		if (reportedNow && worker.reportedState === "blocked") return;
		if (reportedNow && task.attention && !task.attention.answer) return;
		if (!reportedNow && last?.state === "blocked") return;
		if (worker.nudged) {
			this.options.report(task, worker.runId, "blocked", lastText(worker), undefined, undefined);
			worker.reportedThisTurn = false;
			return;
		}
		worker.nudged = true;
		this.options.store.nudge(worker.taskId, NUDGE_TEXT);
	}

	private fail(worker: Worker, error: unknown): void {
		if (worker.disposed || worker.recovering) return;
		const message = error instanceof Error ? error.message : String(error);
		const task = this.options.store.get(worker.taskId);
		if (!task || task.ended) return;
		this.options.report(task, worker.runId, "failed", `模型调用失败：${message}`);
		this.disposeWorker(worker);
	}

	private disposeWorker(worker: Worker): Promise<void> {
		if (worker.disposed) return this.closing.get(worker.taskId) ?? Promise.resolve();
		try { this.finishMessage(worker); } catch (error) { this.closeErrors.push(error); }
		worker.disposed = true;
		worker.unsubscribe();
		this.interruptTools(worker);
		const closing = closeRoleSession(worker.session)
			.catch((error: unknown) => { this.closeErrors.push(error); console.error("Worker session shutdown failed", error); })
			.finally(() => { if (this.closing.get(worker.taskId) === closing) this.closing.delete(worker.taskId); });
		this.closing.set(worker.taskId, closing);
		if (this.workers.get(worker.taskId) === worker) this.workers.delete(worker.taskId);
		worker.streaming = false;
		this.options.onBusyChange();
		return closing;
	}

	private interruptTools(worker: Worker): void {
		for (const call of this.options.store.timeline(worker.taskId)) {
			if (call.runId === worker.runId && call.endedAt === undefined && (call.status === "running" || call.status === "interrupted")) {
				try { this.options.store.recordTool(worker.taskId, { ...call, status: "interrupted", endedAt: Date.now() }); }
				catch (error) { this.closeErrors.push(error); }
			}
		}
	}

	/** The task's own session is the only session for it; a resume reopens the same file. */
	private upstreams(task: Task): Task[] {
		return task.dependsOn.map((id) => this.options.store.get(id)).filter((dep): dep is Task => Boolean(dep));
	}
}

/** Per-task shell env: build scripts get a stable task id and their own output directory (04 §2.3). */
function buildTools(task: Task, versions: FileVersions, assertWritable: (path: string) => void, processes: ProcessRegistry): ToolDefinition[] {
	const [read, write, edit] = createVersionedFileTools(task.cwd, versions, assertWritable);
	const execution = managedSearchExecution(processes, () => task.cwd, task.id);
	return [headless(read), headless(write), headless(edit),
		headless(createGrepToolDefinition(task.cwd, { execution })), headless(createFindToolDefinition(task.cwd, { execution })), headless(createLsToolDefinition(task.cwd))];
}

/** Pi's TUI renderers are irrelevant here; preserve schema validation at the SDK boundary. */
function headless<P extends TSchema, R, S>(tool: ToolDefinition<P, R, S>): ToolDefinition {
	return { name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters,
		promptSnippet: tool.promptSnippet, promptGuidelines: tool.promptGuidelines,
		execute: (id, params, signal, onUpdate, ctx) => tool.execute(id, params as Static<P>, signal, onUpdate, ctx) };
}

function toolAccess(task: Task, run: TaskRun, name: string, id: string, params: unknown): TaskAccess | undefined {
	if (!params || typeof params !== "object") return;
	const base = { toolCallId: `${run.id}:${id}`, runId: run.id, tool: name, at: Date.now() };
	if ((name === "bash" || name === "powershell") && "command" in params && typeof params.command === "string") {
		return { ...base, kind: "shell", target: task.cwd, command: params.command };
	}
	if (!["read", "grep", "find", "ls", "write", "edit"].includes(name)) return;
	const path = "path" in params && typeof params.path === "string" ? params.path : undefined;
	if (!path && (name === "read" || name === "write" || name === "edit")) return;
	const target = resolveWritePath(path ?? ".", task.cwd);
	return name === "write" || name === "edit"
		? { ...base, kind: "fs_write", target, created: !existsSync(target) }
		: { ...base, kind: "fs_read", target };
}

export class WorkerError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}

const NUDGE_TEXT =
	"Your turn ended without a report. If the task is finished or cannot continue, call task_report; if work remains, continue it.";
const STALL_MS = 10 * 60 * 1000;
const STALL_TEXT = "<rally-nudge>\nNo activity for 10 minutes; your last step was stopped. Continue the task from where it stopped.\n</rally-nudge>";

function lastText(worker: Worker): string {
	const text = worker.lastText.trim();
	return text || "（worker 结束了一轮，但没有汇报）";
}

function assignmentMessage(task: Task, run: TaskRun, upstreams: Task[]): string {
	const mode = task.mode;
	const lines = [
		`<rally-assignment task="${task.id}" run="${run.n}" mode="${mode}">`,
		`Title: ${task.title}`,
		"User's words, quoted verbatim:",
	];
	for (const quote of task.quotes) lines.push(formatQuote(quote));
	if (task.note) lines.push(`Main agent's note: ${task.note}`);
	lines.push(
		`Directory: ${task.cwd}`,
		`Output directory: ${task.outputDir}`,
		`Upstream tasks: ${task.dependsOn.length ? task.dependsOn.join(", ") : "none"}`,
		"</rally-assignment>",
	);
	for (const upstream of upstreams) lines.push(upstreamBlock(upstream));
	return lines.join("\n");
}

function inputBlock(input: TaskInput): string {
	const lines = [`<rally-input kind="${input.kind}">`];
	if (input.note) lines.push(`Note: ${input.note}`);
	if (input.body) lines.push(input.body);
	for (const quote of input.quotes ?? []) lines.push(formatQuote(quote));
	lines.push("</rally-input>");
	return lines.join("\n");
}

function upstreamBlock(task: Task): string {
	const outcome = task.ended?.outcome ?? "running";
	const lastRun = task.runs[task.runs.length - 1];
	const summary = truncate(lastRun?.lastReport?.summary ?? "（还没有汇报）", 600);
	const changed = task.changedFiles?.length ? task.changedFiles.join(", ") : "(none)";
	return [
		`<rally-upstream task="${task.id}" outcome="${outcome}">`,
		`Title: ${task.title}`,
		`Summary: ${summary}`,
		`Outputs: ${task.outputDir}`,
		`Changed: ${changed}`,
		`Full report: task_read ${task.id} report`,
		"</rally-upstream>",
	].join("\n");
}

function formatQuote(quote: Quote): string {
	const when = clock(quote.at);
	const text = quote.text.replace(/\n/g, "\n> ");
	const tag = quote.kind === "proposal" ? " · 用户已确认主 agent 提议" : "";
	return `[${quote.messageId} ${when}${tag}] ${text}`;
}

function clock(at: number): string {
	const date = new Date(at);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function truncate(text: string, max: number): string {
	return [...text].length > max ? `${[...text].slice(0, max).join("")}…` : text;
}
