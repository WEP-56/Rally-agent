// One Pi session per task (docs 04 §4). The worker only talks to the supervisor through tools;
// every tool event is translated into task facts (changed files, usage) on the way through.

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	createBashToolDefinition,
	createPowerShellToolDefinition,
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
}

export class WorkerManager {
	private readonly workers = new Map<string, Worker>();
	private readonly starting = new Set<Promise<void>>();
	private readonly closing = new Map<string, Promise<void>>();
	private readonly options: WorkerManagerOptions;
	private disposed = false;
	private disposal?: Promise<void>;

	constructor(options: WorkerManagerOptions) {
		this.options = options;
	}

	/** Slots in use: a worker holds one while it is streaming (docs 04 §3.2). */
	streamingCount(): number {
		return this.streamingIds().length;
	}

	streamingIds(): string[] {
		return [...this.workers.values()].filter((worker) => worker.streaming).map((worker) => worker.taskId);
	}

	has(taskId: string): boolean {
		return this.workers.has(taskId);
	}

	/** Create the task session and send the assignment message (docs 03 §5.1). */
	start(task: Task, run: TaskRun): Promise<void> {
		if (this.disposed) return Promise.resolve();
		const pending = this.startWorker(task, run).finally(() => this.starting.delete(pending));
		this.starting.add(pending);
		return pending;
	}

	private async startWorker(task: Task, run: TaskRun): Promise<void> {
		const { paths, store } = this.options;
		// A terminal report can be resumed before the old turn's final sentence settles.
		await this.abort(task.id);
		const file = join(paths.sessionsTasksDir, `${task.id}.jsonl`);
		const runtime = await this.options.models.whenReady();
		if (this.disposed || task.ended || run.endedAt) return;
		const selection = this.options.models.selection("worker");
		if (!runtime || !selection) throw new WorkerError("NO_MODEL", "尚未配置任务 agent 的模型，请在设置 → 供应商中选择任务 agent 模型与思考强度");
		const sessionManager = SessionManager.open(file, paths.sessionsTasksDir, task.cwd);
		const versions = new FileVersions(sessionManager);
		const { session } = await createRoleSession({
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
				gates: this.options.gates, audit: this.options.audit,
				external: (tool) => store.recordExternalAction(task.id, tool),
			}),
			tools: [],
			customTools: [...this.options.createTools(task), ...buildTools(task, versions, (path) => this.assertWritable(task, run, path)),
				headless(createFileDeleteTool({ task, run, store, versions, gates: this.options.gates, isActive: () => !this.disposed && !task.ended && !run.endedAt })),
				createGitTool({ task, run, store, gates: this.options.gates, audit: this.options.audit, isActive: () => !this.disposed && !task.ended && !run.endedAt }),
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
		};
		worker.unsubscribe = session.subscribe((event) => this.handle(worker, event));
		this.workers.set(task.id, worker);
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
		if (!worker || worker.disposed) return false;
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

	/** Called only by the scheduler with the currently available slot count. */
	wakePending(available: number): void {
		for (const worker of this.workers.values()) {
			if (worker.disposed || worker.streaming) continue;
			const task = this.options.store.get(worker.taskId);
			if (!task || task.ended || task.approval.state !== "approved" || task.runs.find((run) => run.id === worker.runId)?.endedAt) continue;
			const pending = task.inputs.filter((input) => !input.deliveredAt);
			if (!pending.length) continue;
			if (available <= 0) {
				this.options.store.setQueue(task.id, "capacity");
				continue;
			}
			available--;
			worker.streaming = true;
			this.options.store.setQueue(task.id, null);
			for (const input of pending) this.options.store.markDelivered(task.id, input.id);
			void worker.session.sendUserMessage(pending.map(inputBlock).join("\n\n"))
				.catch((error: unknown) => this.fail(worker, error));
		}
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
		const worker = this.workers.get(taskId);
		return worker ? this.disposeWorker(worker) : this.closing.get(taskId) ?? Promise.resolve();
	}

	/** Jack out every session without touching task facts; startup recovery marks the runs interrupted. */
	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		for (const worker of this.workers.values()) void this.disposeWorker(worker);
		// A startup that finishes after this point closes its own newly created session.
		this.disposal = Promise.all([
			...this.closing.values(),
			...Array.from(this.starting, (pending) => pending.catch(() => {})),
		]).then(() => {});
		return this.disposal;
	}

	private handle(worker: Worker, event: AgentSessionEvent): void {
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
				if (event.willRetry) return;
				this.finishMessage(worker);
				this.turnEnded(worker);
				return;
			case "agent_settled":
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
		if (worker.disposed) return;
		const message = error instanceof Error ? error.message : String(error);
		const task = this.options.store.get(worker.taskId);
		if (!task || task.ended) return;
		this.options.report(task, worker.runId, "failed", `模型调用失败：${message}`);
		this.disposeWorker(worker);
	}

	private disposeWorker(worker: Worker): Promise<void> {
		if (worker.disposed) return this.closing.get(worker.taskId) ?? Promise.resolve();
		this.finishMessage(worker);
		worker.disposed = true;
		worker.unsubscribe();
		for (const call of this.options.store.timeline(worker.taskId)) {
			if (call.runId === worker.runId && call.endedAt === undefined && (call.status === "running" || call.status === "interrupted")) {
				this.options.store.recordTool(worker.taskId, { ...call, status: "interrupted", endedAt: Date.now() });
			}
		}
		const closing = closeRoleSession(worker.session)
			.catch((error: unknown) => console.error("Worker session shutdown failed", error))
			.finally(() => { if (this.closing.get(worker.taskId) === closing) this.closing.delete(worker.taskId); });
		this.closing.set(worker.taskId, closing);
		if (this.workers.get(worker.taskId) === worker) this.workers.delete(worker.taskId);
		worker.streaming = false;
		this.options.onBusyChange();
		return closing;
	}

	/** The task's own session is the only session for it; a resume reopens the same file. */
	private upstreams(task: Task): Task[] {
		return task.dependsOn.map((id) => this.options.store.get(id)).filter((dep): dep is Task => Boolean(dep));
	}
}

/** Per-task shell env: build scripts get a stable task id and their own output directory (04 §2.3). */
function buildTools(task: Task, versions: FileVersions, assertWritable: (path: string) => void): ToolDefinition[] {
	const taskEnv = { RALLY_TASK_ID: task.id, RALLY_OUTPUT_DIR: task.outputDir };
	const spawnHook = (context: { command: string; cwd: string; env: NodeJS.ProcessEnv }) => ({
		...context,
		env: { ...context.env, ...taskEnv },
	});
	const [read, write, edit] = createVersionedFileTools(task.cwd, versions, assertWritable);
	return [headless(read), headless(write), headless(edit),
		headless(createGrepToolDefinition(task.cwd)), headless(createFindToolDefinition(task.cwd)), headless(createLsToolDefinition(task.cwd)),
		headless(createBashToolDefinition(task.cwd, { spawnHook })), headless(createPowerShellToolDefinition(task.cwd, { spawnHook }))];
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
