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
import { MAIN_SYSTEM_PROMPT } from "../prompts.ts";
import type { ModelStore } from "../model-store.ts";
import type { EventLog } from "./event-log.ts";
import { createRoleSession } from "./session.ts";

/** Tools the main agent may call: read-only file access only (docs 02 section 2). */
const MAIN_TOOLS = ["read", "grep", "find", "ls"];

export interface MainAgentOptions {
	models: ModelStore;
	customTools?: ToolDefinition[];
}

export class MainAgent {
	private session: AgentSession | null = null;
	private unsubscribe: (() => void) | null = null;
	private starting: Promise<void> | null = null;
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

	constructor(paths: RallyPaths, events: EventLog, emit: (event: ChatEvent) => void, options: MainAgentOptions) {
		this.paths = paths;
		this.events = events;
		this.emit = emit;
		this.customTools = options.customTools ?? [];
		this.models = options.models;
		this.replay();
	}

	isBusy(): boolean {
		return this.busy;
	}

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

	/** Deliver a supervisor event to the model. `turn` wakes it, `steer` cuts into the current turn. */
	async sendCustom(text: string, mode: "turn" | "steer" | "notice"): Promise<void> {
		const session = this.session;
		if (!session || !this.model) return;
		const options =
			mode === "turn"
				? { triggerTurn: true }
				: mode === "steer"
					? { triggerTurn: false, deliverAs: "steer" as const }
					: { triggerTurn: false, deliverAs: "nextTurn" as const };
		try {
			await session.sendCustomMessage({ customType: "rally-event", content: text, display: false }, options);
		} catch (error) {
			this.fail(error);
		}
	}

	/** Surface a supervisor fact in the conversation (system line, docs 01 §6). */
	addSystemLine(text: string): void {
		this.addLine("system", text);
	}

	/** Lazily create the Pi session. Safe to call repeatedly. */
	async start(): Promise<void> {
		if (this.session) return;
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
		try {
			// Do not await the whole turn: the run streams back through events.
			void session.sendUserMessage(`[User message ${line.id}]\n${text}`, deliverAs ? { deliverAs } : undefined).catch((error: unknown) => {
				this.fail(error);
			});
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
	async reset(): Promise<void> {
		await this.start();
		if (!this.session || !this.model) { this.addSystemLine("请先选择主 agent 模型再整理上下文。"); return; }
		if (this.busy) { this.addSystemLine("请等待当前回复结束后再整理上下文。"); return; }
		this.setBusy(true);
		try {
			await this.session.compact("Preserve user goals, quoted message IDs, task IDs, decisions and unresolved questions. Never invent user quotes.");
			this.events.append("chat_compacted", {});
			this.addSystemLine("上下文已整理，对话历史与原话引用保留。");
		} catch (error) {
			this.fail(error);
		} finally {
			this.setBusy(false);
		}
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.session?.dispose();
		this.session = null;
	}

	private async create(fresh: boolean): Promise<void> {
		try {
			const runtime = await this.models.whenReady();
			const selection = this.models.selection();
			const sessionManager = fresh
				? SessionManager.create(this.paths.mainCwd, this.paths.sessionsMainDir)
				: SessionManager.continueRecent(this.paths.mainCwd, this.paths.sessionsMainDir);
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
			this.session = session;
			this.unsubscribe = session.subscribe((event) => this.handle(event));
			this.notice = modelFallbackMessage ?? null;
			this.busy = session.isStreaming;
			this.refreshModelState();
		} catch (error) {
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
	}

	private handle(event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				this.setBusy(true);
				return;
			case "agent_end":
				if (event.willRetry) return;
				this.finishStreaming();
				return;
			case "agent_settled":
				this.setBusy(false);
				return;
			case "message_start":
				if (event.message.role === "assistant") this.startStreaming();
				return;
			case "message_update":
				if (event.message.role === "assistant") this.updateStreaming(extractText(event.message));
				return;
			case "message_end":
				if (event.message.role !== "assistant") return;
				this.updateStreaming(extractText(event.message));
				this.finishStreaming();
				if (event.message.stopReason === "error" && event.message.errorMessage) {
					this.addSystemLine(`模型调用失败：${event.message.errorMessage}`);
				}
		}
	}

	private startStreaming(): void {
		this.finishStreaming();
		const line = this.addLine("assistant", "", true);
		this.streaming = { line };
	}

	private updateStreaming(text: string): void {
		const streaming = this.streaming;
		// A late delta after the message was finalized: ignore rather than resurrect it.
		if (!streaming) return;
		if (streaming.line.text === text) return;
		streaming.line.text = text;
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

	private addLine(role: ChatRole, text: string, streaming = false): ChatLine {
		const line: ChatLine = { id: `#${this.nextLine++}`, role, text, at: Date.now(), streaming };
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
			this.messages.push({ id: `#${n}`, role, text, at, streaming: false });
			this.nextLine = Math.max(this.nextLine, n + 1);
		}
	}
}

/** Assistant messages are either a plain string or a content array; keep only text parts. */
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

function clone(line: ChatLine): ChatLine {
	return { ...line };
}
