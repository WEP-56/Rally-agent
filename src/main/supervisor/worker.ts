// One Pi session per task (docs 04 §4). The worker only talks to the supervisor through tools;
// every tool event is translated into task facts (changed files, usage) on the way through.

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	type AgentSession,
	type AgentSessionEvent,
	createBashToolDefinition,
	createPowerShellToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	SessionManager,
	type ToolDefinition,
} from "@rally/coding-agent";
import type { Static, TSchema } from "typebox";
import type { RallyPaths } from "../../shared/ipc.ts";
import type { Quote, ReportState, Task, TaskInput, TaskRun } from "../../shared/task.ts";
import { WORKER_SYSTEM_PROMPT } from "../prompts.ts";
import type { ModelStore } from "../model-store.ts";
import { createRoleSession } from "./session.ts";
import type { TaskStore } from "./task-store.ts";

export interface ReportResult {
	taskId: string;
	ended: boolean;
	attentionId?: string;
}

export interface WorkerManagerOptions {
	paths: RallyPaths;
	store: TaskStore;
	models: ModelStore;
	createTools(task: Task): ToolDefinition[];
	report(
		task: Task,
		runId: string,
		state: ReportState,
		summary: string,
		question?: string,
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
	toolCalls: number;
	reportedThisTurn: boolean;
	reportedState?: ReportState;
	nudged: boolean;
	starts: Map<string, { toolName: string; args: unknown }>;
	disposed: boolean;
}

export class WorkerManager {
	private readonly workers = new Map<string, Worker>();
	private readonly options: WorkerManagerOptions;
	private disposed = false;

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
	async start(task: Task, run: TaskRun): Promise<void> {
		const { paths, store } = this.options;
		// A terminal report can be resumed before the old turn's final sentence settles.
		if (this.workers.has(task.id)) await this.abort(task.id);
		const file = join(paths.sessionsTasksDir, `${task.id}.jsonl`);
		const runtime = await this.options.models.whenReady();
		if (this.disposed || task.ended || run.endedAt) return;
		const selection = this.options.models.selection("worker");
		if (!runtime || !selection) throw new WorkerError("NO_MODEL", "尚未配置任务 agent 的模型，请在设置 → 供应商中选择任务 agent 模型与思考强度");
		const sessionManager = SessionManager.open(file, paths.sessionsTasksDir, task.cwd);
		const { session } = await createRoleSession({
			cwd: task.cwd,
			agentDir: paths.agentDir,
			sessionManager,
			modelRuntime: runtime,
			model: selection.model,
			thinkingLevel: selection.thinkingLevel,
			rolePrompt: WORKER_SYSTEM_PROMPT,
			loadProjectContext: true,
			tools: [],
			customTools: [...this.options.createTools(task), ...buildTools(task)].map((tool) => this.guardTool(task, run, tool)),
		});
		if (this.disposed || task.ended || run.endedAt) {
			session.dispose();
			return;
		}
		store.setRunModel(task.id, run.id, `${selection.model.provider}/${selection.model.id}`);

		const label = session.model ? `${session.model.provider}/${session.model.id}` : "";
		if (!label || label.startsWith("unknown/")) {
			session.dispose();
			throw new WorkerError("NO_MODEL", "尚未配置任务 agent 的模型");
		}

		const worker: Worker = {
			taskId: task.id,
			runId: run.id,
			session,
			unsubscribe: () => {},
			streaming: true,
			lastText: "",
			toolCalls: 0,
			reportedThisTurn: false,
			nudged: false,
			starts: new Map(),
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
				if (task.mode === "readonly" && !withinOutput(task.outputDir, path)) {
					throw new WorkerError("READONLY_TASK", "只读任务不能写项目目录；需要改动请汇报 blocked 说明原因");
				}
				input = { ...params, path };
			}
			return tool.execute(id, input, signal, onUpdate, ctx);
		} };
	}

	/** Abort the current turn, then release the session (docs 01 §4.7 / 04 §5.3). */
	async abort(taskId: string): Promise<void> {
		const worker = this.workers.get(taskId);
		if (!worker) return;
		try {
			await worker.session.abort();
		} catch {
			// A session that is already idle has nothing to abort.
		}
		this.disposeWorker(worker);
	}

	/** Jack out every session without touching task facts; startup recovery marks the runs interrupted. */
	dispose(): void {
		this.disposed = true;
		for (const worker of this.workers.values()) this.disposeWorker(worker);
		this.workers.clear();
	}

	private handle(worker: Worker, event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				worker.streaming = true;
				this.options.onBusyChange();
				return;
			case "message_start":
				if (event.message.role === "assistant") worker.lastText = "";
				return;
			case "message_update":
				if (event.message.role === "assistant") worker.lastText = extractText(event.message);
				return;
			case "message_end":
				if (event.message.role === "assistant") {
					worker.lastText = extractText(event.message);
					this.countUsage(worker, event.message);
					if (event.message.stopReason === "error") this.fail(worker, event.message.errorMessage ?? "模型调用失败");
				}
				return;
			case "tool_execution_start":
				worker.starts.set(event.toolCallId, { toolName: event.toolName, args: event.args });
				return;
			case "tool_execution_end":
				this.finishTool(worker, event.toolCallId, event.toolName, event.isError);
				return;
			case "agent_end":
				if (event.willRetry) return;
				this.turnEnded(worker);
				return;
			case "agent_settled":
				worker.streaming = false;
				this.options.onBusyChange();
				return;
		}
	}

	private countUsage(worker: Worker, message: unknown): void {
		const usage = (message as { usage?: { input?: number; output?: number; cost?: { total?: number } } }).usage;
		if (!usage) return;
		this.options.store.recordUsage(worker.taskId, {
			inputTokens: Math.max(0, usage.input ?? 0),
			outputTokens: Math.max(0, usage.output ?? 0),
			toolCalls: 0,
		});
	}

	private finishTool(worker: Worker, toolCallId: string, toolName: string, isError: boolean): void {
		const start = worker.starts.get(toolCallId);
		worker.starts.delete(toolCallId);
		worker.toolCalls++;
		this.options.store.recordUsage(worker.taskId, { inputTokens: 0, outputTokens: 0, toolCalls: 1 });
		if (isError || (toolName !== "write" && toolName !== "edit")) return;
		const path = (start?.args as { path?: unknown } | undefined)?.path;
		if (typeof path === "string" && path.trim()) {
			const task = this.options.store.get(worker.taskId);
			if (task) this.options.store.recordChangedFiles(task.id, [resolveWritePath(path, task.cwd)]);
		}
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

	private disposeWorker(worker: Worker): void {
		if (worker.disposed) return;
		worker.disposed = true;
		worker.unsubscribe();
		try {
			worker.session.dispose();
		} catch {
			// Disposing twice is harmless.
		}
		if (this.workers.get(worker.taskId) === worker) this.workers.delete(worker.taskId);
		worker.streaming = false;
		this.options.onBusyChange();
	}

	/** The task's own session is the only session for it; a resume reopens the same file. */
	private upstreams(task: Task): Task[] {
		return task.dependsOn.map((id) => this.options.store.get(id)).filter((dep): dep is Task => Boolean(dep));
	}
}

/** Per-task shell env: build scripts get a stable task id and their own output directory (04 §2.3). */
function buildTools(task: Task): ToolDefinition[] {
	const taskEnv = { RALLY_TASK_ID: task.id, RALLY_OUTPUT_DIR: task.outputDir };
	const spawnHook = (context: { command: string; cwd: string; env: NodeJS.ProcessEnv }) => ({
		...context,
		env: { ...context.env, ...taskEnv },
	});
	return [headless(createReadToolDefinition(task.cwd)), headless(createWriteToolDefinition(task.cwd)), headless(createEditToolDefinition(task.cwd)),
		headless(createGrepToolDefinition(task.cwd)), headless(createFindToolDefinition(task.cwd)), headless(createLsToolDefinition(task.cwd)),
		headless(createBashToolDefinition(task.cwd, { spawnHook })), headless(createPowerShellToolDefinition(task.cwd, { spawnHook }))];
}

/** Pi's TUI renderers are irrelevant here; preserve schema validation at the SDK boundary. */
function headless<P extends TSchema, R, S>(tool: ToolDefinition<P, R, S>): ToolDefinition {
	return { name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters,
		promptSnippet: tool.promptSnippet, promptGuidelines: tool.promptGuidelines,
		execute: (id, params, signal, onUpdate, ctx) => tool.execute(id, params as Static<P>, signal, onUpdate, ctx) };
}

function resolveWritePath(input: string, cwd: string): string {
	let path = input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ").replace(/^@/, "");
	if (/^~([\\/]|$)/.test(path)) path = join(homedir(), path.slice(1));
	return resolve(cwd, path);
}

/** Resolve the closest existing ancestor too, so junctions/symlinks cannot escape the output dir. */
function canonicalTarget(path: string): string {
	if (existsSync(path)) return realpathSync(path);
	try {
		if (lstatSync(path).isSymbolicLink()) throw new Error("不能写入悬空符号链接");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const parent = dirname(path);
	if (parent === path) return path;
	return resolve(canonicalTarget(parent), relative(parent, path));
}

function withinOutput(output: string, path: string): boolean {
	const rel = relative(canonicalTarget(output), canonicalTarget(path));
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
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

function extractText(message: unknown): string {
	const content = (message as { content?: unknown } | null)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			const type = (part as { type?: unknown } | null)?.type;
			const text = (part as { text?: unknown } | null)?.text;
			return type === "text" && typeof text === "string" ? text : "";
		})
		.join("");
}
