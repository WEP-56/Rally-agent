import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { ClientApp, PROTOCOL_VERSION, methods, ndJsonStream, type ContentBlock, type NewSessionResponse } from "@agentclientprotocol/sdk"
import type { PromptResponse } from "@agentclientprotocol/sdk/unstable";
import { getAgentDir, getShellEnv } from "@rally/coding-agent";
import type { ExternalAgentModel, RoleWorkerExecutor } from "../../shared/role-workers.ts";
import type { TaskMode } from "../../shared/task.ts";
import { processIdentity, stopProcessTree } from "./process-identity.ts";
import { readClaudeModelConfiguration } from "./claude-model-settings.ts";
import { resolveExternalWorkerRuntime } from "./external-worker-runtime.ts";

export type ExternalExecutor = Exclude<RoleWorkerExecutor, "rally">;

export interface ExternalToolUpdate {
	id: string;
	name?: string;
	status?: "running" | "ok" | "error";
	input?: unknown;
	output?: string;
}

interface SessionOptions {
	executor: ExternalExecutor;
	cwd: string;
	mode: TaskMode;
	outputDir?: string;
	modelId?: string;
	signal?: AbortSignal;
	onText?(chunk: string): void;
	onTool?(update: ExternalToolUpdate): void;
	onCost?(costUsd: number): void;
	onUsage?(usage: Pick<NonNullable<PromptResponse["usage"]>, "inputTokens" | "outputTokens" | "cachedReadTokens" | "cachedWriteTokens">): void;
}

type Connection = ReturnType<ClientApp["connect"]>;

export class ExternalWorkerSession {
	readonly models: ExternalAgentModel[];
	readonly acceptsImages: boolean;
	private readonly executor: ExternalExecutor;
	private readonly connection: Connection;
	private readonly stopProcess: () => Promise<void>;
	private readonly sessionId: string;
	private pending?: Promise<string>;
	private closing?: Promise<void>;
	private costUsd = 0;
	private readonly onUsage: (usage: Pick<NonNullable<PromptResponse["usage"]>, "inputTokens" | "outputTokens" | "cachedReadTokens" | "cachedWriteTokens">) => void;
	private usage?: { inputTokens: number; outputTokens: number; cachedReadTokens: number; cachedWriteTokens: number };

	private constructor(connection: Connection, stopProcess: () => Promise<void>, session: NewSessionResponse, acceptsImages: boolean, executor: ExternalExecutor, onUsage: (usage: Pick<NonNullable<PromptResponse["usage"]>, "inputTokens" | "outputTokens" | "cachedReadTokens" | "cachedWriteTokens">) => void) {
		this.connection = connection;
		this.stopProcess = stopProcess;
		this.sessionId = session.sessionId;
		this.acceptsImages = acceptsImages;
		this.executor = executor;
		this.onUsage = onUsage;
		const model = session.configOptions?.find(option => option.category === "model" && option.type === "select");
		const models = model?.type === "select" ? model.options.flatMap(option => "value" in option
			? [{ id: option.value, name: option.name }]
			: option.options.map(item => ({ id: item.value, name: `${option.name} · ${item.name}` }))) : [];
		if (model?.type === "select" && model.currentValue && !models.some(item => item.id === model.currentValue)) {
			models.unshift({ id: model.currentValue, name: `${model.currentValue} · 当前配置` });
		}
		this.models = models;
	}

	static async start(options: SessionOptions): Promise<ExternalWorkerSession> {
		const signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(options.signal ? [options.signal] : [])]);
		signal.throwIfAborted();
		const env: NodeJS.ProcessEnv = { ...getShellEnv(), ELECTRON_RUN_AS_NODE: "1" };
		const { entry, executable } = resolveExternalWorkerRuntime(options.executor, { agentDir: getAgentDir(), env });
		let claudeSettings: Record<string, unknown> = {};
		if (options.executor === "claude-code") {
			env.CLAUDE_CODE_EXECUTABLE = executable;
			const claudeConfiguration = readClaudeModelConfiguration(options.cwd, env);
			claudeSettings = claudeConfiguration.settings;
			Object.assign(env, claudeConfiguration.environment, { CLAUDE_AGENT_ACP_PROTOCOL: "v1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" });
		} else {
			// Keep authentication and the user's Codex model provider; do not use a separate CODEX_HOME.
			env.CODEX_PATH = executable;
			delete env.DEFAULT_AUTH_REQUEST;
			let existingConfig: Record<string, unknown> = {};
			try {
				const value: unknown = env.CODEX_CONFIG ? JSON.parse(env.CODEX_CONFIG) : {};
				if (value && typeof value === "object" && !Array.isArray(value)) existingConfig = value as Record<string, unknown>;
			} catch { throw new Error("Codex CODEX_CONFIG 环境变量不是有效 JSON，外部 worker 已停止启动"); }
			const priorFeatures = existingConfig.features;
			const features = priorFeatures && typeof priorFeatures === "object" && !Array.isArray(priorFeatures) ? priorFeatures as Record<string, unknown> : {};
			env.CODEX_CONFIG = JSON.stringify({ ...existingConfig, features: {
				...features, multi_agent: false, multi_agent_v2: false, multi_agent_v2_dynamic_tools: false,
				hooks: false, plugin_hooks: false, skill_mcp_dependency_install: false,
			} });
			env.INITIAL_AGENT_MODE = options.mode === "write" ? "workspace-write" : "read-only";
		}
		if (options.executor === "codex" && process.platform === "win32") {
			const preloadUrl = new URL("./external-worker-windows-preload.js", import.meta.url).href;
			env.NODE_OPTIONS = [env.NODE_OPTIONS, `--import=${preloadUrl}`].filter(Boolean).join(" ");
		}
		const child = spawn(process.execPath, [entry], {
			cwd: options.cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
		});
		const pid = child.pid;
		// stderr may contain paths, request parameters, or credentials. Never relay it to the UI.
		child.stderr.resume();
		child.stdin.on("error", () => {});
		child.on("error", () => {});
		const exited = once(child, "exit").then(() => true, () => true);
		const identity = pid && process.platform === "win32" ? processIdentity(pid).catch(() => undefined) : undefined;
		const stopProcess = async () => {
			child.stdin.end();
			if (await Promise.race([exited, delay(1200, false, { ref: false })])) return;
			const savedIdentity = await identity;
			if (savedIdentity) {
				try { await stopProcessTree(savedIdentity, 0); }
				catch {
					// Codex can finish its own shutdown while taskkill is starting.
					if (!await Promise.race([exited, delay(500, false, { ref: false })])) throw new Error("无法终止 ACP 进程树");
				}
			} else if (pid && process.platform !== "win32") {
				try { process.kill(-pid, "SIGKILL"); }
				catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
			} else child.kill();
			if (!await Promise.race([exited, delay(3000, false, { ref: false })])) throw new Error("ACP 进程未退出");
		};

		let connection: Connection | undefined;
		let cumulativeCost = 0;
		let instance: ExternalWorkerSession | undefined;
		try {
			await once(child, "spawn", { signal });
			const app = new ClientApp({ name: "Rally" });
			// Native permissions are intentionally not equivalent to Rally gates. Never grant ACP escalation.
			app.onRequest(methods.client.session.requestPermission, ({ params }) => {
				const reject = params.options.find(option => option.kind === "reject_once");
				return { outcome: reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" } };
			});
			app.onNotification(methods.client.session.update, ({ params }) => {
				if (!instance || instance.closing || params.sessionId !== instance.sessionId) return;
				const update = params.update;
				if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") options.onText?.(update.content.text);
				if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") options.onTool?.({
					id: update.toolCallId, name: update.title ?? undefined, input: update.rawInput,
					status: update.status === "completed" ? "ok" : update.status === "failed" ? "error" : update.status ? "running" : undefined,
					output: update.content?.flatMap(part => part.type === "content" && part.content.type === "text" ? [part.content.text] : []).join("\n") || undefined,
				});
				if (update.sessionUpdate === "usage_update" && update.cost?.currency === "USD" && Number.isFinite(update.cost.amount) && update.cost.amount > cumulativeCost) {
					options.onCost?.(update.cost.amount - cumulativeCost);
					cumulativeCost = update.cost.amount;
					instance.costUsd = cumulativeCost;
				}
			});
			connection = app.connect(ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>));
			const initialized = await connection.agent.request(methods.agent.initialize, {
				protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
			}, { cancellationSignal: signal, stopWaitingOnCancel: true });
			if (initialized.protocolVersion !== PROTOCOL_VERSION) throw new Error("ACP 协议版本不匹配");
			if (options.executor === "codex") {
				const auth = await connection.agent.request<{ state: string }>("auth/status", {}, { cancellationSignal: signal, stopWaitingOnCancel: true });
				if (auth.state === "unauthenticated") throw new Error("请先在当前主机登录 Codex");
			}
			const additionalRoots = options.outputDir ? [options.outputDir] : [];
			const claude = options.executor === "claude-code";
			const session = await connection.agent.request(methods.agent.session.new, {
				cwd: options.cwd, mcpServers: [], _meta: {
					additionalRoots,
					...(claude ? { claudeCode: { options: {
						executable: process.execPath,
						tools: options.mode === "write" ? ["Read", "Glob", "Grep", "Edit", "Write", "MultiEdit"] : ["Read", "Glob", "Grep"],
						disallowedTools: ["Agent", "Task", "Bash", "Skill", "EnterWorktree"],
						settingSources: [], strictMcpConfig: true, allowDangerouslySkipPermissions: false,
						settings: { ...claudeSettings, disableAllHooks: true },
					...(options.outputDir ? { additionalDirectories: [options.outputDir] } : {}),
				} } } : {}),
				},
			}, { cancellationSignal: signal, stopWaitingOnCancel: true });
			instance = new ExternalWorkerSession(connection, stopProcess, session, initialized.agentCapabilities?.promptCapabilities?.image === true, options.executor, options.onUsage ?? (() => {}));
			if (!instance.models.length) throw new Error("适配器没有提供可选模型，请检查本机登录或模型配置");
			if (options.modelId !== undefined) {
				const model = session.configOptions?.find(option => option.category === "model" && option.type === "select");
				if (!model || !instance.models.some(item => item.id === options.modelId)) throw new Error(`当前模型列表没有 ${options.modelId}，请重新选择角色模型`);
				const applied = await connection.agent.request(methods.agent.session.setConfigOption, { sessionId: session.sessionId, configId: model.id, value: options.modelId }, { cancellationSignal: signal, stopWaitingOnCancel: true });
				if (!applied.configOptions.some(option => option.id === model.id && option.type === "select" && (option.currentValue === options.modelId || (option.options.flatMap(item => "value" in item ? [item.value] : item.options.map(child => child.value)).every(value => !value.includes("/")) && option.options.flatMap(item => "value" in item ? [item.value] : item.options.map(child => child.value)).includes(options.modelId!))))) throw new Error("适配器没有确认选中的模型");
				if (claude) {
					const modeId = options.mode === "write" ? "acceptEdits" : "default";
					if (!session.modes?.availableModes.some(mode => mode.id === modeId)) throw new Error(`适配器没有提供 ${modeId} 权限模式`);
					await connection.agent.request(methods.agent.session.setMode, { sessionId: session.sessionId, modeId }, { cancellationSignal: signal, stopWaitingOnCancel: true });
				} else {
					const modeId = options.mode === "write" ? "workspace-write" : "read-only";
					if (!session.modes?.availableModes.some(mode => mode.id === modeId)) throw new Error(`Codex adapter 没有提供 ${modeId} 沙箱模式`);
					await connection.agent.request(methods.agent.session.setMode, { sessionId: session.sessionId, modeId }, { cancellationSignal: signal, stopWaitingOnCancel: true });
				}
			}
			return instance;
		} catch (error) {
			connection?.close();
			await stopProcess().catch(cleanup => console.error("ACP startup cleanup failed", cleanup));
			if (options.signal?.aborted) throw options.signal.reason;
			if (signal.aborted) throw new Error(`${options.executor} ACP 初始化超时，请检查本机登录和模型配置`);
			const detail = error instanceof Error ? error.message : String(error);
			if (/authentication required/i.test(detail)) throw new Error(`请先在当前主机登录 ${options.executor === "codex" ? "Codex" : "Claude Code"}`);
			throw new Error(`${options.executor} ACP 初始化失败：${detail}`);
		}
	}

	prompt(content: ContentBlock[]): Promise<string> {
		if (this.closing || this.pending) throw new Error("外部会话已关闭或正在运行");
		this.pending = this.connection.agent.request(methods.agent.session.prompt, { sessionId: this.sessionId, prompt: content }).then(response => {
			const { stopReason } = response;
			const usage = (response as PromptResponse).usage;
			if (usage) {
				const current = {
					inputTokens: Math.max(0, usage.inputTokens - (usage.cachedReadTokens ?? 0) - (usage.cachedWriteTokens ?? 0)),
					outputTokens: usage.outputTokens,
					cachedReadTokens: Math.max(0, usage.cachedReadTokens ?? 0),
					cachedWriteTokens: Math.max(0, usage.cachedWriteTokens ?? 0),
				};
				const previous = this.usage ?? { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0 };
				const delta = this.executor === "codex" ? current : {
					inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
					outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
					cachedReadTokens: Math.max(0, current.cachedReadTokens - previous.cachedReadTokens),
					cachedWriteTokens: Math.max(0, current.cachedWriteTokens - previous.cachedWriteTokens),
				};
				this.usage = this.executor === "codex" ? {
					inputTokens: previous.inputTokens + current.inputTokens,
					outputTokens: previous.outputTokens + current.outputTokens,
					cachedReadTokens: previous.cachedReadTokens + current.cachedReadTokens,
					cachedWriteTokens: previous.cachedWriteTokens + current.cachedWriteTokens,
				} : current;
				this.onUsage?.(delta);
			}
			return stopReason;
		})
			.finally(() => { this.pending = undefined; });
		return this.pending;
	}

	async abort(): Promise<void> {
		const pending = this.pending;
		if (!pending) return;
		await this.connection.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
		if (!await Promise.race([pending.then(() => true, () => true), delay(3000, false, { ref: false })])) throw new Error("ACP adapter 未确认取消");
	}

	close(): Promise<void> {
		return this.closing ??= this.shutdown();
	}

	private async shutdown(): Promise<void> {
		try {
			await this.abort();
			await this.connection.agent.request(methods.agent.session.close, { sessionId: this.sessionId }, { cancellationSignal: AbortSignal.timeout(1500), stopWaitingOnCancel: true });
		} catch { /* Disconnected or non-responsive adapters are stopped below. */ }
		finally {
			this.connection.close();
			await this.stopProcess();
		}
	}
}
