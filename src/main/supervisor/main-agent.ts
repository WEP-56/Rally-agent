// Main-agent session: Pi session under ~/.rally/agent/main with read-only tools, mirrored into the
// Rally chat via the event log. Only the main process touches this class (docs 01 section 4).

import {
	type AgentSession,
	type AgentSessionEvent,
	SessionManager,
	type ToolDefinition,
} from "@rally/coding-agent";
import type { ChatEvent, ChatLine, ChatRole, ChatState, RallyPaths } from "../../shared/ipc.ts";
import type { SelectModelInput, ThinkingLevelName } from "../../shared/models.ts";
import type { Quote, QuoteRef } from "../../shared/task.ts";
import type { WorkspaceState } from "../../shared/workspace.ts";
import { toolInput, toolOutput } from "../../shared/tools.ts";
import { assistantContent } from "../../shared/conversation.ts";
import { MAIN_SYSTEM_PROMPT } from "../prompts.ts";
import type { ModelStore } from "../model-store.ts";
import type { EventLog } from "./event-log.ts";
import { closeRoleSession, createRoleSession } from "./session.ts";
import type { RelayMessage, RelayMode } from "./relay.ts";
import { searchChat, type ChatSearchParams } from "./chat-search.ts";
import { existsSync, statSync } from "node:fs";

/** Tools the main agent may call: read-only file access only (docs 02 section 2). */
const MAIN_TOOLS = ["read", "grep", "find", "ls"];

export interface MainAgentOptions {
	models: ModelStore;
	customTools?: ToolDefinition[];
	workspace?(): WorkspaceState;
	memory?(): string;
	taskState?(): string;
	capabilities?(): Promise<string>;
	segmentBytes?: number;
	segmentCompactions?: number;
	onSettled?(aborted: boolean): void;
	onRelayRead?(ids: string[]): void;
	onAvailable?(): void;
}

export class MainAgent {
	private session: AgentSession | null = null;
	private unsubscribe: (() => void) | null = null;
	private starting: Promise<void> | null = null;
	private disposed = false;
	private disposal?: Promise<void>;
	private readonly messages: ChatLine[] = [];
	private streaming: { line: ChatLine } | null = null;
	private nextLine = 1;
	private busy = false;
	private model: string | null = null;
	private thinkingLevel: string | null = null;
	private thinkingLevels: string[] = [];
	private notice: string | null = null;

	private readonly paths: RallyPaths;
	private readonly events: EventLog;
	private readonly emit: (event: ChatEvent) => void;
	private readonly customTools: ToolDefinition[];
	private readonly models: ModelStore;
	private readonly workspace?: () => WorkspaceState;
	private readonly memory?: () => string;
	private readonly taskState?: () => string;
	private readonly capabilities?: () => Promise<string>;
	private readonly segmentBytes: number;
	private readonly segmentCompactions: number;
	private readonly onSettled?: (aborted: boolean) => void;
	private readonly onRelayRead?: (ids: string[]) => void;
	private readonly onAvailable?: () => void;
	private readonly queuedRelays = new Set<string>();
	private readonly toolLines = new Map<string, ChatLine>();

	constructor(paths: RallyPaths, events: EventLog, emit: (event: ChatEvent) => void, options: MainAgentOptions) {
		this.paths = paths;
		this.events = events;
		this.emit = emit;
		this.customTools = options.customTools ?? [];
		this.models = options.models;
		this.workspace = options.workspace;
		this.memory = options.memory;
		this.taskState = options.taskState;
		this.capabilities = options.capabilities;
		this.segmentBytes = options.segmentBytes ?? 20 * 1024 * 1024;
		this.segmentCompactions = options.segmentCompactions ?? 10;
		this.onSettled = options.onSettled;
		this.onRelayRead = options.onRelayRead;
		this.onAvailable = options.onAvailable;
		this.replay();
	}

	isBusy(): boolean {
		return this.busy || Boolean(this.session?.isStreaming);
	}

	canReceiveRelay(): boolean { return !this.disposed && Boolean(this.session && this.model); }

	search(params: ChatSearchParams) { return searchChat(this.messages, params); }

	/** Freeze a user message (and optionally the confirmed proposal before it) into a Quote. */
	quote(ref: QuoteRef): Quote | null {
		const index = this.messages.findIndex((line) => line.id === ref.id);
		if (index === -1) return null;
		const line = this.messages[index];
		if (line.role !== "user") return null;
		let text = line.text;
		let kind: Quote["kind"] = "user";
		if (ref.withProposal) {
			const proposal = this.messages[index - 1];
			if (proposal?.role === "assistant" && proposal.text.trim()) {
				text = `${proposal.text}\n\n${line.text}`;
				kind = "proposal";
			} else return null;
		}
		return { messageId: line.id, kind, text, at: line.at };
	}

	/** Durable relay metadata deduplicates an ambiguous send after restart. */
	async sendRelay(items: RelayMessage[], mode: RelayMode): Promise<void> {
		const session = this.session;
		if (!session || !this.canReceiveRelay()) throw new Error("主会话未就绪，中继保留待送");
		// A compacted-away record is not usable context: reinject that pending payload.
		const received = new Set(session.messages.flatMap((message) => message.role === "custom" && message.customType === "rally-relay" ? relayIds(message.details) : []));
		const pending = new Set(session.getPendingCustomMessages().flatMap((message) => message.customType === "rally-relay" ? relayIds(message.details) : []));
		const fresh = items.filter((item) => !received.has(item.id) && !this.queuedRelays.has(item.id) && !pending.has(item.id));
		const recovered = items.filter((item) => received.has(item.id));
		if (mode === "notice" && recovered.length) this.onRelayRead?.(recovered.map((item) => item.id));
		if (!fresh.length && (!recovered.length || mode === "notice")) return;
		for (const item of fresh) this.queuedRelays.add(item.id);
		const ids = [...fresh, ...(mode === "notice" ? [] : recovered)].map((item) => item.id);
		const content = [...fresh.map((item) => item.text), ...(mode !== "notice" && recovered.length
			? [`<rally-resume relays="${recovered.map((item) => item.id).join(",")}">Process the relay facts already in history. Their delivery acknowledgement was interrupted; do not repeat completed actions.</rally-resume>`] : [])].join("\n\n");
		try {
			await session.sendCustomMessage({ customType: "rally-relay", content, display: false, details: { relayIds: ids } },
				mode === "notice" ? { triggerTurn: false, deliverAs: "nextTurn" } : { triggerTurn: true, deliverAs: "steer" });
		} catch (error) {
			for (const item of fresh) this.queuedRelays.delete(item.id);
			throw error;
		}
	}

	/** Surface a supervisor fact in the conversation (system line, docs 01 §6). */
	addSystemLine(text: string, relayId?: string): void {
		if (relayId && this.messages.some((line) => line.relayId === relayId)) return;
		this.addLine("system", text, false, relayId);
	}

	/** Lazily create the Pi session. Safe to call repeatedly. */
	async start(): Promise<void> {
		if (this.disposed || this.session) return;
		if (!this.starting) {
			this.starting = this.create(false).finally(() => {
				this.starting = null;
			});
		}
		return this.starting;
	}

	state(): ChatState {
		return {
			messages: this.messages.map(clone),
			busy: this.busy,
			model: this.model,
			thinkingLevel: this.thinkingLevel,
			thinkingLevels: [...this.thinkingLevels],
			notice: this.notice,
		};
	}

	/**
	 * Switch the main session model (and thinking level). Persisted by ModelStore so a restart
	 * restores the same choice. Only the main agent's model can be changed here (M1-C scope).
	 */
	async selectModel(input: SelectModelInput): Promise<ChatState> {
		await this.start();
		const model = this.models.resolve(input.provider, input.model);
		if (!model) throw new Error(`找不到模型 ${input.provider}/${input.model}，请先在设置中保存该供应商`);
		if (input.thinkingLevel && !this.models.levelsFor(input.provider, input.model).includes(input.thinkingLevel)) throw new Error(`该模型不支持思考档位 ${input.thinkingLevel}`);
		const session = this.session;
		if (!session) throw new Error("主会话没有启动成功，无法切换模型");
		try {
			await session.setModel(model);
			if (input.thinkingLevel) session.setThinkingLevel(input.thinkingLevel);
			this.models.setActive({
				provider: input.provider,
				model: input.model,
				thinkingLevel: session.thinkingLevel as ThinkingLevelName,
			});
			this.refreshModelState();
			this.events.append("model_select", { provider: input.provider, model: input.model });
			return this.state();
		} catch (error) {
			this.fail(error);
			throw error;
		}
	}

	/** Send a user message. Steers the running turn when the agent is busy. */
	async send(text: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) return;
		await this.start();
		if (this.disposed) return;
		const line = this.addLine("user", text);
		const session = this.session;
		if (!session) {
			this.addLine("system", "主会话没有启动成功，消息未送达。");
			return;
		}
		if (!this.model) {
			this.addLine("system", "尚未配置模型。请先在设置中接入一个 provider 并选择模型。");
			return;
		}
		const deliverAs = session.isStreaming ? ("steer" as const) : undefined;
		this.onAvailable?.();
		try {
			// Do not await the whole turn: the run streams back through events.
			void session.sendUserMessage(`[User message ${line.id}]\n${text}`, deliverAs ? { deliverAs } : undefined).catch((error: unknown) => {
				this.fail(error);
			});
			this.onAvailable?.();
		} catch (error) {
			this.fail(error);
		}
	}

	async abort(): Promise<void> {
		const session = this.session;
		if (!session) return;
		try {
			await session.abort();
		} catch (error) {
			this.fail(error);
		}
	}

	/**
	 * Compact model context in place. UI history and quote IDs remain intact.
	 */
	async reset(): Promise<boolean> {
		await this.start();
		if (!this.session || !this.model) { this.addSystemLine("请先选择主 agent 模型再整理上下文。"); return false; }
		if (this.isBusy()) { this.addSystemLine("请等待当前回复结束后再整理上下文。"); return false; }
		this.setBusy(true);
		try {
			await this.session.compact("Preserve user goals, quoted message IDs, task IDs, decisions and unresolved questions. Never invent user quotes.");
			this.events.append("chat_compacted", {});
			this.addSystemLine("上下文已整理，对话历史与原话引用保留。");
			return true;
		} catch (error) {
			this.fail(error);
			return false;
		} finally {
			this.setBusy(false);
		}
	}

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		this.unsubscribe?.();
		this.unsubscribe = null;
		const session = this.session;
		this.session = null;
		this.disposal = Promise.allSettled([
			this.starting,
			session ? closeRoleSession(session) : undefined,
		]).then((results) => {
			const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
			if (errors.length) throw new AggregateError(errors, "Main session shutdown failed");
		});
		return this.disposal;
	}

	private async create(fresh: boolean): Promise<void> {
		try {
			const runtime = await this.models.whenReady();
			if (this.disposed) return;
			const selection = this.models.selection();
			const sessionManager = fresh
				? SessionManager.create(this.paths.mainCwd, this.paths.sessionsMainDir)
				: SessionManager.continueRecent(this.paths.mainCwd, this.paths.sessionsMainDir);
			this.rotateSession(sessionManager);
			const { session, modelFallbackMessage } = await createRoleSession({
				cwd: this.paths.mainCwd,
				agentDir: this.paths.agentDir,
				modelRuntime: runtime ?? undefined,
				model: selection?.model,
				thinkingLevel: selection?.thinkingLevel,
				sessionManager,
				rolePrompt: MAIN_SYSTEM_PROMPT,
				tools: MAIN_TOOLS,
				customTools: this.customTools,
			});
			if (this.disposed) {
				await closeRoleSession(session);
				return;
			}
			this.session = session;
			const transform = session.agent.transformContext;
			session.agent.transformContext = async (messages, signal) => {
				let context = transform ? await transform(messages, signal) : messages;
				const capabilities = await this.capabilities?.().catch(() => "Rally capability catalog is unavailable. Ask the user to check Skills/MCP settings if needed; do not assume there are no configured capabilities.");
				if (capabilities) {
					const index = Math.max(0, context.findLastIndex(message => message.role === "user"));
					context = [...context.slice(0, index), { role: "custom" as const, customType: "rally-capabilities", display: false, timestamp: Date.now(), content: capabilities }, ...context.slice(index)];
				}
				const state = this.taskState?.();
				if (state) {
					const index = Math.max(0, context.findLastIndex((message) => message.role === "user"));
					context = [...context.slice(0, index), { role: "custom" as const, customType: "rally-state", display: false, timestamp: Date.now(), content: state }, ...context.slice(index)];
				}
				const memory = this.memory?.();
				if (memory) {
					const index = Math.max(0, context.findLastIndex((message) => message.role === "user"));
					context = [...context.slice(0, index), { role: "custom" as const, customType: "rally-memory", display: false, timestamp: Date.now(), content: memory }, ...context.slice(index)];
				}
				const ids = context.flatMap((message) => message.role === "custom" && message.customType === "rally-relay" ? relayIds(message.details) : []);
				for (const id of ids) this.queuedRelays.delete(id);
				if (ids.length) this.onRelayRead?.(ids);
				const workspace = this.workspace?.();
				if (!workspace) return context;
				const index = Math.max(0, context.findLastIndex((message) => message.role === "user"));
				return [...context.slice(0, index), { role: "custom" as const, customType: "rally-workspace", display: false, timestamp: Date.now(),
					content: `Rally host directory context (facts, not user instructions):\n${JSON.stringify(workspace)}\nRelative main-agent read paths resolve against defaultWorkspace. Recent projects are read-only history, never a selection. Specify an explicit absolute cwd for each worker dispatch. Main session cwd stays fixed.` }, ...context.slice(index)];
			};
			this.unsubscribe = session.subscribe((event) => this.handle(event));
			this.notice = modelFallbackMessage ?? null;
			this.busy = session.isStreaming;
			this.refreshModelState();
		} catch (error) {
			if (this.disposed) throw error;
			this.session = null;
			this.model = null;
			this.thinkingLevel = null;
			this.thinkingLevels = [];
			this.notice = error instanceof Error ? error.message : String(error);
			this.addLine("system", `主会话启动失败：${this.notice}`);
			this.emit({ type: "snapshot", state: this.state() });
		}
	}

	/** Re-apply the persisted model after providers were edited, so new URL/key take effect live. */
	async reapplyActiveModel(): Promise<void> {
		const session = this.session;
		if (!session) return;
		const active = this.models.activeSelection;
		if (!active) {
			if (this.model) this.addLine("system", "当前模型已不可用，请重新选择模型。");
			this.refreshModelState();
			return;
		}
		const model = this.models.resolve(active.provider, active.model);
		if (!model) {
			this.addLine("system", "当前模型已不可用，请在对话框底部的模型选择器中重新选择。");
			this.refreshModelState();
			return;
		}
		try {
			await session.setModel(model);
			await session.setThinkingLevel(active.thinkingLevel);
			this.refreshModelState();
		} catch (error) {
			this.fail(error);
		}
	}

	/** Re-read model + thinking facts from the live session and push a snapshot. */
	private refreshModelState(): void {
		const session = this.session;
		const label = this.models.selection() && session?.model ? `${session.model.provider}/${session.model.id}` : null;
		// Pi falls back to a placeholder "unknown/unknown" model when no provider is configured.
		this.model = label && !label.startsWith("unknown/") ? label : null;
		this.thinkingLevel = this.model ? (session?.thinkingLevel ?? null) : null;
		this.thinkingLevels = this.model ? (session?.getAvailableThinkingLevels() ?? []) : [];
		this.emit({ type: "snapshot", state: this.state() });
		this.onAvailable?.();
	}

	private handle(event: AgentSessionEvent): void {
		switch (event.type) {
			case "compaction_end":
				if (event.result && !event.aborted && this.session) this.rotateSession(this.session.sessionManager);
				return;
			case "agent_start":
				this.setBusy(true);
				return;
			case "agent_end":
				if (event.willRetry) return;
				this.finishStreaming();
				return;
			case "agent_settled":
				if (this.session) this.rotateSession(this.session.sessionManager);
				this.queuedRelays.clear();
				for (const line of new Set(this.toolLines.values())) {
					for (const call of line.toolCalls ?? []) if (call.status === "running") { call.status = "interrupted"; call.endedAt = Date.now(); }
					this.logLine(line); this.emit({ type: "message", message: clone(line) });
				}
				this.toolLines.clear();
				this.setBusy(false);
				this.onSettled?.(event.aborted);
				return;
			case "tool_execution_start": {
				const last = this.messages.at(-1);
				const source = this.messages.findLast((message) => message.role === "assistant" && message.blocks?.some((block) => block.type === "tool" && block.toolCallId === event.toolCallId));
				const line = source ?? (last?.role === "assistant" ? last : this.addLine("assistant", ""));
				line.toolCalls ??= [];
				line.toolCalls.push({ id: event.toolCallId, name: event.toolName, input: toolInput(event.args), status: "running", startedAt: Date.now() });
				this.toolLines.set(event.toolCallId, line);
				this.logLine(line); this.emit({ type: "message", message: clone(line) });
				return;
			}
			case "tool_execution_end": {
				const line = this.toolLines.get(event.toolCallId);
				const call = line?.toolCalls?.find((item) => item.id === event.toolCallId);
				if (line && call) {
					Object.assign(call, { status: event.isError ? "error" : "ok", endedAt: Date.now(), output: toolOutput(event.result) });
					this.logLine(line); this.emit({ type: "message", message: clone(line) });
				}
				this.toolLines.delete(event.toolCallId);
				return;
			}
			case "message_start":
				if (event.message.role === "assistant") this.startStreaming();
				return;
			case "message_update":
				if (event.message.role === "assistant") this.updateStreaming(event.message);
				return;
			case "message_end":
				if (event.message.role !== "assistant") return;
				this.updateStreaming(event.message);
				this.finishStreaming();
				if (event.message.stopReason === "error" && event.message.errorMessage) {
					this.addSystemLine(`模型调用失败：${event.message.errorMessage}`);
				}
		}
	}

	private rotateSession(manager: SessionManager): void {
		const file = manager.getSessionFile();
		if (!file || !existsSync(file)) return;
		try {
			const base = manager.getHeader()?.segmentCompactionId;
			const branch = manager.getBranch();
			const compactions = branch.slice(base ? branch.findIndex(entry => entry.id === base) + 1 : 0).filter(entry => entry.type === "compaction");
			if (statSync(file).size < this.segmentBytes && compactions.length < this.segmentCompactions) return;
			const next = manager.rotateCompactedSession();
			if (next) this.events.append("segment_rotated", { previousFile: file, file: next, compactionId: manager.getHeader()?.segmentCompactionId });
		} catch (error) { this.addSystemLine(`会话分段失败，继续使用当前会话：${String(error)}`); }
	}

	private startStreaming(): void {
		this.finishStreaming();
		const line = this.addLine("assistant", "", true);
		this.streaming = { line };
	}

	private updateStreaming(message: unknown): void {
		const streaming = this.streaming;
		// A late delta after the message was finalized: ignore rather than resurrect it.
		if (!streaming) return;
		Object.assign(streaming.line, assistantContent(message));
		this.emit({ type: "message", message: clone(streaming.line) });
	}

	private finishStreaming(): void {
		const streaming = this.streaming;
		if (!streaming) return;
		this.streaming = null;
		const line = streaming.line;
		line.streaming = false;
		this.logLine(line);
		this.emit({ type: "message", message: clone(line) });
	}

	private addLine(role: ChatRole, text: string, streaming = false, relayId?: string): ChatLine {
		const line: ChatLine = { id: `#${this.nextLine++}`, role, text, at: Date.now(), streaming, relayId };
		this.messages.push(line);
		if (!streaming) this.logLine(line);
		this.emit({ type: "message", message: clone(line) });
		return line;
	}

	private logLine(line: ChatLine): void {
		this.events.append("chat_message", {
			n: Number(line.id.slice(1)),
			role: line.role,
			text: line.text,
			at: line.at,
			toolCalls: line.toolCalls,
			blocks: line.blocks,
			relayId: line.relayId,
		});
	}

	private setBusy(busy: boolean): void {
		if (this.busy === busy) return;
		this.busy = busy;
		this.emit({ type: "busy", busy });
	}

	private fail(error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.finishStreaming();
		this.addLine("system", `出错了：${message}`);
		this.setBusy(false);
	}

	private replay(): void {
		for (const event of this.events.all()) {
			if (event.kind === "chat_reset") {
				this.messages.length = 0;
				continue;
			}
			if (event.kind !== "chat_message") continue;
			const n = Number(event.data.n);
			const role = event.data.role as ChatRole;
			const text = String(event.data.text ?? "");
			const at = Number(event.data.at ?? event.at);
			if (!Number.isFinite(n)) continue;
			const toolCalls = (event.data.toolCalls as ChatLine["toolCalls"])?.map((call) => ({ ...call, status: call.status === "running" ? "interrupted" as const : call.status }));
			const blocks = event.data.blocks as ChatLine["blocks"];
			const relayId = typeof event.data.relayId === "string" ? event.data.relayId : undefined;
			const line = { id: `#${n}`, role, text, at, streaming: false, toolCalls, blocks, relayId };
			const index = this.messages.findIndex((item) => item.id === line.id);
			if (index === -1) this.messages.push(line);
			else this.messages[index] = line;
			this.nextLine = Math.max(this.nextLine, n + 1);
		}
	}
}

function clone(line: ChatLine): ChatLine {
	return { ...line, blocks: line.blocks?.map((block) => ({ ...block })), toolCalls: line.toolCalls?.map((call) => ({ ...call })) };
}

function relayIds(details: unknown): string[] {
	if (!details || typeof details !== "object" || !("relayIds" in details) || !Array.isArray(details.relayIds)) return [];
	return details.relayIds.filter((id): id is string => typeof id === "string");
}
