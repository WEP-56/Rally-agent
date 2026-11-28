// Main-agent session: Pi session under ~/.rally/agent/main with read-only tools, mirrored into the
// Rally chat via the event log. Only the main process touches this class (docs 01 section 4).

import {
	type AgentSession,
	type AgentSessionEvent,
	SessionManager,
	type ToolDefinition,
} from "@rally/coding-agent";
import type { ChatActivity, ChatHeaderState, ChatDelivery, ChatEvent, ChatLine, ChatRole, ChatState, RallyPaths } from "../../shared/ipc.ts";
import type { ImSource } from "../../shared/connections.ts";
import type { SelectModelInput, ThinkingLevelName } from "../../shared/models.ts";
import type { Quote, QuoteRef, TaskContext } from "../../shared/task.ts";
import type { WorkspaceState } from "../../shared/workspace.ts";
import { toolInput, toolOutput } from "../../shared/tools.ts";
import { assistantContent } from "../../shared/conversation.ts";
import { MAIN_SYSTEM_PROMPT } from "../prompts.ts";
import type { ModelStore } from "../model-store.ts";
import type { EventLog } from "./event-log.ts";
import { closeRoleSession, createRoleSession } from "./session.ts";
import type { RelayMessage, RelayMode } from "./relay.ts";
import { searchChat, type ChatSearchParams } from "./chat-search.ts";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { ResourceStore } from "../resource-store.ts";
import type { ResourceRef } from "../../shared/resources.ts";
import { attachmentMessage, resolveAttachments } from "./attachments.ts";
import { resourceTools } from "./resource-tools.ts";
import { createMainImageTool } from "./provider-tools.ts";
import type { ToolProviderStore } from "../tool-provider-store.ts";
import { INACTIVITY_MESSAGE } from "./inactivity.ts";
import { recentChatContext } from "./task-context.ts";

/** Tools the main agent may call: read-only file access only (docs 02 section 2). */
const MAIN_TOOLS = ["read", "grep", "find", "ls"];
const QUERY_TOOLS = new Set([...MAIN_TOOLS, "chat_search", "git_inspect", "github_read", "fetch_page", "web_search", "task_read", "schedule_list"]);
const NEW_CONVERSATION_COMPACTIONS = 4;

export interface MainAgentOptions {
	resources?(): ResourceStore;
	toolProviders?: ToolProviderStore;
	models: ModelStore;
	customTools?: ToolDefinition[];
	workspace?(): WorkspaceState;
	memory?(): string;
	identity?(): string;
	taskState?(): string;
	scheduleState?(): string;
	capabilities?(): Promise<string>;
	segmentBytes?: number;
	segmentCompactions?: number;
	beforeInput?(): Promise<void>;
	beforeUserTurn?(): Promise<void>;
	beforeUserInput?(): Promise<void>;
	canRun?(): boolean;
	inactivity?(): ChatState["inactivity"];
	onSettled?(aborted: boolean): void;
	onRelayRead?(ids: string[]): void;
	onAvailable?(): void;
	canReply?(source: ImSource): boolean;
	reply?(source: ImSource, text: string): Promise<void>;
}

export class MainAgent {
	private session: AgentSession | null = null;
	private unsubscribe: (() => void) | null = null;
	private starting: Promise<void> | null = null;
	private replacing?: Promise<void>;
	private pausing?: Promise<void>;
	private conversation?: ChatState["conversation"];
	private disposed = false;
	private disposal?: Promise<void>;
	private readonly messages: ChatLine[] = [];
	private contextBefore?: string;
	private streaming: { line: ChatLine } | null = null;
	private nextLine = 1;
	private busy = false;
	private loopFailed = false;
	private compactions = 0;
	private header: ChatHeaderState = { activity: null, showCompact: false, showNewConversation: false };
	private localSubmissions = 0;
	private inboxTurn?: Promise<void>;
	private activeInput?: ChatLine;
	private inboxPaused = false;
	private preparingInput = false;
	private inputError?: string;
	private readonly receivedSubmissions = new Set<string>();
	private readonly imWaiters = new Map<string, (text: string | null) => void>();
	private replying = false;
	private inboxTimer?: NodeJS.Timeout;
	private readonly receivedIm = new Set<string>();
	private model: string | null = null;
	private thinkingLevel: string | null = null;
	private thinkingLevels: string[] = [];
	private notice: string | null = null;

	private readonly paths: RallyPaths;
	private readonly events: EventLog;
	private readonly emit: (event: ChatEvent) => void;
	private readonly customTools: ToolDefinition[];
	private readonly models: ModelStore;
	private readonly resources?: () => ResourceStore;
	private imageAttempt?: { messageId: string; toolCallId: string; request: string; canCorrect: boolean };
	private readonly workspace?: () => WorkspaceState;
	private readonly memory?: () => string;
	private readonly identity?: () => string;
	private readonly taskState?: () => string;
	private readonly scheduleState?: () => string;
	private readonly capabilities?: () => Promise<string>;
	private readonly segmentBytes: number;
	private readonly segmentCompactions: number;
	private readonly onSettled?: (aborted: boolean) => void;
	private readonly onRelayRead?: (ids: string[]) => void;
	private readonly onAvailable?: () => void;
	private readonly beforeInput?: () => Promise<void>;
	private readonly beforeUserTurn?: () => Promise<void>;
	private readonly beforeUserInput?: () => Promise<void>;
	private readonly canRun: () => boolean;
	private readonly inactivity?: () => ChatState["inactivity"];
	private readonly queuedRelays = new Set<string>();
	private readonly canReply?: MainAgentOptions["canReply"];
	private readonly reply?: MainAgentOptions["reply"];
	private readonly toolLines = new Map<string, ChatLine>();

	constructor(paths: RallyPaths, events: EventLog, emit: (event: ChatEvent) => void, options: MainAgentOptions) {
		this.paths = paths;
		this.events = events;
		this.emit = emit;
		this.customTools = [...(options.customTools ?? [])];
		if (options.resources && options.toolProviders) this.customTools.push(createMainImageTool({
			providers: options.toolProviders, store: options.resources, owner: "main",
			active: () => !this.disposed && this.canRun(), publish: (id, refs) => this.publish(id, refs),
		}, (message, id, request) => this.claimImageRequest(message, id, request)));
		this.models = options.models;
		this.resources = options.resources;
		this.workspace = options.workspace;
		this.memory = options.memory;
		this.identity = options.identity;
		this.taskState = options.taskState;
		this.scheduleState = options.scheduleState;
		this.capabilities = options.capabilities;
		this.segmentBytes = options.segmentBytes ?? 20 * 1024 * 1024;
		this.segmentCompactions = options.segmentCompactions ?? 10;
		this.onSettled = options.onSettled;
		this.onRelayRead = options.onRelayRead;
		this.onAvailable = options.onAvailable;
		this.beforeInput = options.beforeInput;
		this.beforeUserTurn = options.beforeUserTurn;
		this.beforeUserInput = options.beforeUserInput;
		this.canRun = options.canRun ?? (() => true);
		this.inactivity = options.inactivity;
		this.canReply = options.canReply;
		this.reply = options.reply;
		this.replay();
		this.recoverInbox();
	}

	isBusy(): boolean {
		return this.busy || Boolean(this.session?.isStreaming);
	}

	canReceiveRelay(): boolean {
		return !this.disposed && !this.replacing && !this.pausing && !this.activeInput?.source && !this.inboxPaused &&
			this.canRun() && Boolean(this.session && this.model) &&
			(this.preparingInput || this.isBusy() || !this.messages.some(line => line.delivery?.status === "queued"));
	}

	search(params: ChatSearchParams) { return searchChat(this.messages.filter(line => line.delivery?.status !== "queued" && line.delivery?.status !== "cancelled"), params); }

	recentContext(count: number): TaskContext[] { return recentChatContext(this.messages, count, this.contextBefore); }

	recentQuoteIds(): string[] {
		const ids: string[] = [];
		for (let index = this.messages.length - 1; index >= 0 && ids.length < 5; index--) {
			const line = this.messages[index];
			if (line.role === "user" && line.delivery?.status !== "queued" && line.delivery?.status !== "cancelled") ids.push(line.id);
		}
		return ids;
	}

	/** Freeze a user message (and optionally the confirmed proposal before it) into a Quote. */
	quote(ref: QuoteRef): Quote | null {
		const index = this.messages.findIndex((line) => line.id === ref.id);
		if (index === -1) return null;
		const line = this.messages[index];
		if (line.role !== "user" || line.delivery?.status === "queued" || line.delivery?.status === "cancelled") return null;
		let text = line.text;
		let kind: Quote["kind"] = "user";
		if (ref.withProposal) {
			const proposal = this.messages.slice(0, index).findLast(item => item.role !== "user" || !item.delivery || item.delivery.status === "done" || item.delivery.status === "processing");
			if (proposal?.role === "assistant" && proposal.text.trim()) {
				text = `${proposal.text}\n\n${line.text}`;
				kind = "proposal";
			} else return null;
		}
		return { messageId: line.id, kind, text, at: line.at, source: line.source, attachments: line.attachments?.map(ref => ({ ...ref })) };
	}

	/** Durable relay metadata deduplicates an ambiguous send after restart. */
	async sendRelay(items: RelayMessage[], mode: RelayMode): Promise<void> {
		if (this.preparingInput && mode !== "notice") mode = "nextTurn";
		await this.beforeInput?.();
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
		this.localSubmissions++;
		try {
			const payload = await attachmentMessage(this.resources?.(), content, items.flatMap(item => item.attachments ?? []), session.model);
			if (!this.canReceiveRelay() || session !== this.session) throw new Error(INACTIVITY_MESSAGE);
			await session.sendCustomMessage({ customType: "rally-relay", content: payload, display: false, details: { relayIds: ids } },
				mode === "notice" || mode === "nextTurn" ? { triggerTurn: false, deliverAs: "nextTurn" } : { triggerTurn: true, deliverAs: "steer" });
		} catch (error) {
			for (const item of fresh) this.queuedRelays.delete(item.id);
			throw error;
		} finally { this.localSubmissions--; this.available(); }
	}

	/** Surface a supervisor fact in the conversation (system line, docs 01 §6). */
	addSystemLine(text: string, relayId?: string, attachments?: ResourceRef[]): void {
		if (relayId && this.messages.some((line) => line.relayId === relayId)) return;
		this.addLine("system", text, false, relayId, undefined, attachments);
	}

	/** Lazily create the Pi session. Safe to call repeatedly. */
	async start(): Promise<void> {
		await this.pausing;
		if (this.disposed || this.session) return;
		if (!this.starting) {
			this.starting = this.create().finally(() => {
				this.starting = null;
			});
		}
		return this.starting;
	}

	/** Called after host startup/resume. A timer only checks local queue/connection state. */
	available(): void {
		if (this.disposed) return;
		this.inboxTimer ??= setInterval(() => this.available(), 15_000);
		this.inboxTimer.unref();
		this.drainInbox();
		void this.flushReplies().catch(error => console.error("Inbox reply persistence failed", error));
	}

	state(): ChatState {
		return {
			inboxPaused: this.inboxPaused,
			inactivity: this.inactivity?.(),
			messages: this.messages.map(clone),
			header: { ...this.header },
			conversation: this.conversation && { ...this.conversation },
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
		if (this.replacing) throw new Error("正在新建会话，请稍候。");
		const model = this.models.resolve(input.provider, input.model);
		if (!model) throw new Error(`找不到模型 ${input.provider}/${input.model}，请先在设置中保存该供应商`);
		if (input.thinkingLevel && !this.models.levelsFor(input.provider, input.model).includes(input.thinkingLevel)) throw new Error(`该模型不支持思考档位 ${input.thinkingLevel}`);
		const session = this.session;
		if (!session) throw new Error("主会话没有启动成功，无法切换模型");
		this.localSubmissions++;
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
		} finally { this.localSubmissions--; this.available(); }
	}

	/** Connector callbacks acknowledge durable acceptance, not the eventual model reply. */
	async receiveFromIm(text: string, source: ImSource): Promise<string | null> {
		if (this.disposed) throw Error("Rally 正在关闭，消息未接收");
		if (!text.trim() || this.receivedIm.has(imKey(source))) return null;
		const line = this.enqueue(text, [], source);
		await this.wakeInbox(line);
		return null;
	}

	/** Await one reply for callers that need it; connectors use receiveFromIm. */
	async sendFromIm(text: string, source: ImSource): Promise<string | null> {
		if (this.disposed) throw Error("Rally 正在关闭，消息未接收");
		if (!text.trim() || this.receivedIm.has(imKey(source))) return null;
		const line = this.enqueue(text, [], source);
		const result = new Promise<string | null>(resolve => this.imWaiters.set(line.id, resolve));
		await this.wakeInbox(line);
		return result;
	}

	async send(text: string, attachmentIds: string[] = [], actor = "desktop", requestId?: string): Promise<void> {
		if (this.disposed) throw Error("Rally 正在关闭，消息未接收");
		if (!text.trim() && !attachmentIds.length) return;
		const submissionId = requestId ? `${actor}:${requestId}` : undefined;
		if (submissionId && this.receivedSubmissions.has(submissionId)) return;
		const resources = this.resources?.();
		if (attachmentIds.length && !resources) throw Error("附件资源库不可用");
		const attachments = resources ? resolveAttachments(resources, attachmentIds, actor) : [];
		const line = this.enqueue(text, attachments, undefined, submissionId);
		await this.wakeInbox(line);
	}

	private enqueue(text: string, attachments: ResourceRef[], source?: ImSource, submissionId?: string): ChatLine {
		const line: ChatLine = { id: `#${this.nextLine++}`, role: "user", text, at: Date.now(), streaming: false,
			delivery: { status: "queued" }, source, submissionId, ...(attachments.length ? { attachments } : {}) };
		if (attachments.length) this.resources?.().retain(`message:${line.id}`, attachments.map(ref => ref.id));
		// The message and its queued state are one append: no crash gap between acceptance and intake.
		this.logLine(line);
		this.messages.push(line);
		if (source) this.receivedIm.add(imKey(source));
		if (submissionId) this.receivedSubmissions.add(submissionId);
		this.emit({ type: "message", message: clone(line) });
		return line;
	}

	private async wakeInbox(line: ChatLine): Promise<void> {
		try {
			await this.beforeUserInput?.();
			await this.beforeInput?.();
			await this.start();
			if (this.disposed) return;
			this.setInboxPaused(false);
			this.available();
			this.onAvailable?.();
		} catch (error) {
			this.setDelivery(line, { status: "failed", error: String(error) });
			this.imWaiters.get(line.id)?.("消息已保存，但处理失败，请在 Rally 中重试。");
			this.imWaiters.delete(line.id);
		}
	}

	async updateInbox(input: unknown): Promise<void> {
		if (!input || typeof input !== "object" || !("action" in input) || this.disposed) throw Error("无效的收件箱操作");
		if (input.action === "resume") {
			if (!this.canRun()) throw Error(INACTIVITY_MESSAGE);
			this.setInboxPaused(false);
			await this.start();
			this.available();
			this.onAvailable?.();
			return;
		}
		if (!("id" in input) || typeof input.id !== "string") throw Error("缺少消息编号");
		const line = this.messages.find(item => item.id === input.id && item.role === "user");
		if (!line?.delivery) throw Error("找不到收件箱消息");
		if (input.action === "cancel") {
			if (line.delivery.reply && ["pending", "failed"].includes(line.delivery.reply.status) && line.delivery.status === "done") {
				this.setDelivery(line, { ...line.delivery, reply: { ...line.delivery.reply, status: "cancelled", error: undefined } });
				return;
			}
			if (!["queued", "failed"].includes(line.delivery.status)) throw Error("消息已开始处理，无法撤回；可停止当前回复");
			this.setDelivery(line, { status: "cancelled" });
			this.imWaiters.get(line.id)?.(null);
			this.imWaiters.delete(line.id);
			this.available();
			this.onAvailable?.();
			return;
		}
		if (input.action !== "retry") throw Error("无效的收件箱操作");
		if (!this.canRun()) throw Error(INACTIVITY_MESSAGE);
		if (line.delivery.status === "done" && line.delivery.reply?.status === "failed") {
			this.setDelivery(line, { ...line.delivery, reply: { ...line.delivery.reply, status: "pending", error: undefined } });
		} else {
			if (line.delivery.status !== "failed") throw Error("只能重试失败的消息");
			this.setDelivery(line, { status: "queued", retried: true });
		}
		this.setInboxPaused(false);
		await this.start();
		this.available();
	}

	private setInboxPaused(paused: boolean): void {
		if (this.inboxPaused === paused) return;
		this.events.append("chat_queue_paused", { paused });
		this.inboxPaused = paused;
		this.emit({ type: "snapshot", state: this.state() });
	}

	private setDelivery(line: ChatLine, delivery: ChatDelivery): void {
		if (line.delivery?.retried) delivery.retried = true;
		this.logLine({ ...line, delivery });
		line.delivery = delivery;
		this.emit({ type: "message", message: clone(line) });
	}

	private drainInbox(): void {
		if (this.disposed || this.pausing || this.replacing || this.inboxTurn || this.inboxPaused || this.localSubmissions ||
			!this.canRun() || this.isBusy() || !this.session?.isIdle || !this.model) return;
		const line = this.messages.find(item => item.delivery?.status === "queued");
		if (!line) return;
		const session = this.session;
		this.activeInput = line;
		this.inputError = undefined;
		this.inboxTurn = Promise.resolve().then(async () => {
			try {
				await this.beforeInput?.();
				if (this.disposed || this.pausing || this.inboxPaused || !this.canRun() || line.delivery?.status !== "queued") return;
				if (!line.source) {
					this.preparingInput = true;
					try { await this.beforeUserTurn?.(); }
					finally { this.preparingInput = false; }
				}
				const retry = line.delivery?.retried ? "\n\n<rally-retry>Host notice: the user explicitly retried this interrupted message. Some work may already be complete. Check conversation history and task_read before taking action; continue existing tasks and do not repeat completed actions.</rally-retry>" : "";
				const content = await attachmentMessage(this.resources?.(), `[User message ${line.id}]\n${line.text}${retry}`, line.attachments ?? [], session.model);
				if (this.disposed || this.pausing || this.inboxPaused || !this.canRun() || line.delivery?.status !== "queued") return;
				this.setDelivery(line, { status: "processing" });
				await session.sendUserMessage(content);
				if (this.disposed || this.pausing || !this.canRun()) return;
				if (this.inputError) throw Error(this.inputError);
				const reply = this.messages.findLast(item => item.role === "assistant" && item.replyTo === line.id && !item.streaming && item.text.trim())?.text.trim()
					|| "这轮没有生成文字回复，请在 Rally 查看对话和任务。";
				const awaited = this.imWaiters.has(line.id);
				this.setDelivery(line, { status: "done", ...(line.source && !awaited ? { reply: { status: "pending" as const, text: reply } } : {}) });
				this.imWaiters.get(line.id)?.(reply);
			} catch (error) {
				if (!this.disposed && !this.pausing && this.canRun()) {
					this.setDelivery(line, { status: "failed", error: error instanceof Error ? error.message : String(error),
						...(line.source ? { reply: { status: "pending" as const, text: "这条消息处理未完成，已保留在 Rally 收件箱。请检查已有进展后重试，后续消息暂时排队。" } } : {}) });
					this.setInboxPaused(true);
					this.imWaiters.get(line.id)?.("消息处理失败，请在 Rally 查看并重试。");
				}
			} finally {
				this.imWaiters.get(line.id)?.(null);
				this.imWaiters.delete(line.id);
			}
		}).catch(error => {
			// A broken log must not turn an unchanged queued item into a tight retry loop.
			this.inboxPaused = true;
			console.error("Inbox persistence failed", error);
		}).finally(() => {
			this.inboxTurn = undefined;
			this.activeInput = undefined;
			if (!this.disposed && !this.pausing) { this.available(); this.onAvailable?.(); }
		});
	}

	private async flushReplies(): Promise<void> {
		if (this.replying || !this.reply || this.disposed || !this.canRun()) return;
		this.replying = true;
		try {
			for (const line of this.messages) {
				const reply = line.delivery?.reply;
				if (this.disposed || !this.canRun()) break;
				if (reply?.status !== "pending" || !line.source || !this.canReply?.(line.source)) continue;
				this.setDelivery(line, { ...line.delivery!, reply: { ...reply, status: "sending" } });
				try {
					await this.reply(line.source, reply.text);
					if (!this.disposed) this.setDelivery(line, { ...line.delivery!, reply: { ...reply, status: "sent" } });
				} catch (error) {
					if (!this.disposed) this.setDelivery(line, { ...line.delivery!, reply: { ...reply, status: "failed", error: String(error) } });
				}
			}
		} finally { this.replying = false; }
	}

	async abort(): Promise<void> {
		this.setInboxPaused(true);
		this.inputError = "已停止处理；如需继续，请重试这条消息。";
		const session = this.session;
		if (!session) return;
		try { await session.abort(); }
		catch (error) { this.fail(error); }
	}

	/**
	 * Compact model context in place. UI history and quote IDs remain intact.
	 */
	async reset(): Promise<boolean> {
		if (!this.canRun()) { this.addSystemLine(INACTIVITY_MESSAGE); return false; }
		await this.start();
		if (!this.session || !this.model) { this.addSystemLine("请先选择主 agent 模型再整理上下文。"); return false; }
		if (this.replacing || this.inboxTurn || this.localSubmissions || this.isBusy() || !this.session.isIdle) { this.addSystemLine("请等待当前回复结束后再整理上下文。"); return false; }
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
			this.available();
		}
	}

	async newConversation(): Promise<void> {
		await this.start();
		if (this.disposed || !this.session) throw new Error("主会话未就绪，请稍后再试。");
		if (this.replacing || this.inboxTurn || this.localSubmissions || this.isBusy() || !this.session.isIdle) {
			throw new Error("请等待当前回复或整理结束后再新建会话。");
		}
		if (this.hasPendingInbox()) {
			throw new Error("请先处理或撤回收件箱中的待处理消息，再新建会话。");
		}
		const operation = this.create(randomUUID());
		this.replacing = operation;
		try { await operation; }
		finally {
			this.replacing = undefined;
			if (!this.disposed) { this.available(); this.onAvailable?.(); }
		}
	}

	private hasPendingInbox(): boolean {
		return this.messages.some(line => line.delivery?.status === "queued" || line.delivery?.status === "failed" ||
			line.delivery?.reply && ["pending", "sending", "failed"].includes(line.delivery.reply.status));
	}

	/** Close inference, compaction, cache warming and transports without clearing history. */
	pause(): Promise<void> {
		if (this.pausing) return this.pausing;
		const current = this.session;
		const closing = current ? closeRoleSession(current) : undefined;
		this.pausing = (async () => {
			const results = await Promise.allSettled([closing, this.starting, this.replacing, this.inboxTurn]);
			const session = this.session;
			if (session && session !== current) await closeRoleSession(session);
			this.unsubscribe?.();
			this.unsubscribe = null;
			this.session = null;
			this.queuedRelays.clear();
			this.finishStreaming();
			this.recoverInbox();
			this.setBusy(false);
			const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
			if (errors.length) throw new AggregateError(errors, "Main session pause failed");
		})().finally(() => { this.pausing = undefined; });
		return this.pausing;
	}

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		clearInterval(this.inboxTimer);
		for (const resolve of this.imWaiters.values()) resolve(null);
		this.imWaiters.clear();
		this.unsubscribe?.();
		this.unsubscribe = null;
		const session = this.session;
		this.session = null;
		this.disposal = Promise.allSettled([
			this.pausing,
			this.inboxTurn,
			this.starting,
			this.replacing,
			session ? closeRoleSession(session) : undefined,
		]).then((results) => {
			const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
			if (errors.length) throw new AggregateError(errors, "Main session shutdown failed");
		});
		return this.disposal;
	}

	private async create(newId?: string): Promise<void> {
		let candidate: AgentSession | undefined;
		try {
			const runtime = await this.models.whenReady();
			if (this.disposed) return;
			const selection = this.models.selection();
			const id = newId ?? this.conversation?.id;
			const dir = id ? join(this.paths.sessionsMainDir, id) : this.paths.sessionsMainDir;
			const sessionManager = newId ? SessionManager.create(this.paths.mainCwd, dir) : SessionManager.continueRecent(this.paths.mainCwd, dir);
			const compactions = newId ? 0 : countCompactions(sessionManager);
			if (!newId) this.rotateSession(sessionManager);
			const { session, modelFallbackMessage } = await createRoleSession({
				canRun: () => !this.disposed && this.canRun(),
				cwd: this.paths.mainCwd,
				agentDir: this.paths.agentDir,
				modelRuntime: runtime ?? undefined,
				model: selection?.model,
				thinkingLevel: selection?.thinkingLevel,
				sessionManager,
				rolePrompt: MAIN_SYSTEM_PROMPT,
				tools: MAIN_TOOLS,
				customTools: this.customTools,
				...(this.resources ? { extensions: [resourceTools({ store: this.resources, owner: "main", cwd: () => this.workspace?.().defaultWorkspace ?? this.paths.mainCwd,
					roots: () => [this.workspace?.().defaultWorkspace ?? this.paths.mainCwd], active: () => !this.disposed && this.canRun(),
					publish: (id, refs) => this.publish(id, refs) })], extensionTools: ["resource_publish"] } : {}),
			});
			candidate = session;
			if (this.disposed) { await closeRoleSession(session); return; }
			const previous = this.session;
			if (newId) {
				// A message may have arrived while the replacement session was loading.
				if (this.hasPendingInbox()) {
					throw Error("新消息已进入收件箱，请先处理或撤回后再新建会话。");
				}
				const event = this.events.append("chat_reset", { conversationId: newId });
				this.conversation = { id: newId, at: event.at };
				this.unsubscribe?.();
				this.messages.length = 0;
				this.contextBefore = undefined;
				this.streaming = null;
				this.toolLines.clear();
				this.queuedRelays.clear();
				this.setInboxPaused(false);
			}
			this.session = session;
			this.compactions = compactions;
			candidate = undefined;
			const transform = session.agent.transformContext;
			session.agent.transformContext = async (messages, signal) => {
				let context = transform ? await transform(messages, signal) : messages;
				const schedules = this.scheduleState?.();
				if (schedules) {
					context = context.filter(message => message.role !== "custom" || message.customType !== "rally-schedules");
					const index = Math.max(0, context.findLastIndex(message => message.role === "user"));
					context = [...context.slice(0, index), { role: "custom" as const, customType: "rally-schedules", display: false, timestamp: Date.now(), content: schedules }, ...context.slice(index)];
				}
				const identity = this.identity?.();
				if (identity) {
					context = context.filter(message => message.role !== "custom" || message.customType !== "rally-identity");
					const index = Math.max(0, context.findLastIndex(message => message.role === "user"));
					context = [...context.slice(0, index), { role: "custom" as const, customType: "rally-identity", display: false, timestamp: Date.now(), content: identity }, ...context.slice(index)];
				}
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
			if (previous) {
				await closeRoleSession(previous).catch(error => console.error("Previous main session cleanup failed", error));
				if (!this.disposed) this.onSettled?.(false);
			}
		} catch (error) {
			if (candidate) await closeRoleSession(candidate);
			if (newId || this.disposed) throw error;
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
		if (this.replacing) await this.replacing.catch(() => {});
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
		this.localSubmissions++;
		try {
			await session.setModel(model);
			await session.setThinkingLevel(active.thinkingLevel);
			this.refreshModelState();
		} catch (error) {
			this.fail(error);
		} finally { this.localSubmissions--; this.available(); }
	}

	/** Re-read model + thinking facts from the live session and push a snapshot. */
	private refreshModelState(): void {
		const session = this.session;
		const label = this.models.selection() && session?.model ? `${session.model.provider}/${session.model.id}` : null;
		// Pi falls back to a placeholder "unknown/unknown" model when no provider is configured.
		this.model = label && !label.startsWith("unknown/") ? label : null;
		this.thinkingLevel = this.model ? (session?.thinkingLevel ?? null) : null;
		this.thinkingLevels = this.model ? (session?.getAvailableThinkingLevels() ?? []) : [];
		this.refreshHeader();
		this.emit({ type: "snapshot", state: this.state() });
		this.onAvailable?.();
		this.available();
	}

	private handle(event: AgentSessionEvent): void {
		switch (event.type) {
			case "compaction_start":
				this.setActivity("compacting");
				return;
			case "compaction_end":
				if (event.result && !event.aborted && this.session) {
					this.compactions++;
					this.rotateSession(this.session.sessionManager);
				}
				this.refreshHeader();
				this.setActivity(this.busy && event.reason !== "manual" ? "thinking" : null);
				return;
			case "agent_start":
				this.loopFailed = false;
				this.header = { ...this.header, loopResult: undefined };
				this.setBusy(true);
				this.setActivity("thinking");
				return;
			case "agent_end":
				if (event.willRetry) return;
				this.finishStreaming();
				return;
			case "agent_settled":
				this.header = { ...this.header, loopResult: { outcome: event.aborted ? "aborted" : this.loopFailed ? "error" : "completed", at: Date.now() } };
				this.emit({ type: "header", header: this.header });
				if (event.aborted && this.activeInput) this.inputError ??= "处理被中断，请检查已有进展后重试。";
				this.contextBefore = undefined;
				if (this.session) this.rotateSession(this.session.sessionManager);
				this.queuedRelays.clear();
				for (const line of new Set(this.toolLines.values())) {
					for (const call of line.toolCalls ?? []) if (call.status === "running") { call.status = "interrupted"; call.endedAt = Date.now(); }
					this.logLine(line); this.emit({ type: "message", message: clone(line) });
				}
				this.toolLines.clear();
				this.refreshHeader();
				this.setBusy(false);
				this.onSettled?.(event.aborted);
				queueMicrotask(() => this.available());
				return;
			case "tool_execution_start": {
				const last = this.messages.at(-1);
				const source = this.messages.findLast((message) => message.role === "assistant" && message.blocks?.some((block) => block.type === "tool" && block.toolCallId === event.toolCallId));
				const line = source ?? (last?.role === "assistant" ? last : this.addLine("assistant", ""));
				line.toolCalls ??= [];
				line.toolCalls.push({ id: event.toolCallId, name: event.toolName, input: toolInput(event.args), status: "running", startedAt: Date.now() });
				this.toolLines.set(event.toolCallId, line);
				this.setActivity(toolActivity(event.toolName));
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
				const remaining = [...this.toolLines].at(-1);
				const name = remaining?.[1].toolCalls?.find(call => call.id === remaining[0])?.name;
				if (this.header.activity !== "compacting") this.setActivity(name ? toolActivity(name) : "thinking");
				return;
			}
			case "message_start":
				if (event.message.role === "user") {
					// Anchor to input admitted by Pi; newer queued UI messages are not this request.
					const content = event.message.content;
					const text = typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text).join("\n");
					this.contextBefore = /^\[User message (#[1-9]\d*)\]/.exec(text)?.[1] ?? this.messages.findLast(line => line.role === "user")?.id;
				}
				if (event.message.role === "assistant") {
					if (!this.toolLines.size && this.header.activity !== "compacting") this.setActivity("thinking");
					this.startStreaming();
				}
				return;
			case "message_update":
				if (event.message.role === "assistant") {
					if (!this.toolLines.size && this.header.activity !== "compacting" && event.assistantMessageEvent.type === "text_delta" && event.assistantMessageEvent.delta.trim()) this.setActivity("replying");
					this.updateStreaming(event.message);
				}
				return;
			case "message_end":
				if (event.message.role !== "assistant") return;
				this.updateStreaming(event.message);
				this.finishStreaming();
				if (this.activeInput && !this.inboxPaused && event.message.stopReason !== "error" && event.message.stopReason !== "aborted") this.inputError = undefined;
				this.loopFailed = event.message.stopReason === "error";
				if (event.message.stopReason === "error") {
					const error = event.message.errorMessage || "模型未能完成这条消息。";
					if (this.activeInput) this.inputError = error;
					this.addSystemLine(`模型调用失败：${error}`);
				} else if (event.message.stopReason === "aborted" && this.activeInput) {
					this.inputError ??= "处理被中断，请检查已有进展后重试。";
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
		this.streaming = { line: { id: `#${this.nextLine++}`, role: "assistant", text: "", at: Date.now(), streaming: true, replyTo: this.activeInput?.id } };
	}

	private updateStreaming(message: unknown): void {
		const streaming = this.streaming;
		// A late delta after the message was finalized: ignore rather than resurrect it.
		if (!streaming) return;
		Object.assign(streaming.line, assistantContent(message));
		if (!streaming.line.text.trim() && !streaming.line.blocks?.length) return;
		if (!this.messages.includes(streaming.line)) this.messages.push(streaming.line);
		this.emit({ type: "message", message: clone(streaming.line) });
	}

	private finishStreaming(): void {
		const streaming = this.streaming;
		if (!streaming) return;
		this.streaming = null;
		const line = streaming.line;
		if (!this.messages.includes(line)) return;
		line.streaming = false;
		this.logLine(line);
		this.emit({ type: "message", message: clone(line) });
	}

	private addLine(role: ChatRole, text: string, streaming = false, relayId?: string, source?: ImSource, attachments?: ResourceRef[]): ChatLine {
		const line: ChatLine = { id: `#${this.nextLine++}`, role, text, at: Date.now(), streaming, relayId, source, ...(attachments?.length ? { attachments } : {}) };
		if (attachments?.length) this.resources?.().retain(`message:${line.id}`, attachments.map(ref => ref.id));
		this.messages.push(line);
		if (!streaming) this.logLine(line);
		this.emit({ type: "message", message: clone(line) });
		return line;
	}

	private claimImageRequest(messageId: string, toolCallId: string, request: string): (parametersRejected: boolean) => void {
		const index = this.messages.findLastIndex(message => message.role === "user" && (this.activeInput ? message.id === this.activeInput.id : message.delivery?.status !== "queued" && message.delivery?.status !== "cancelled"));
		if (index < 0 || this.messages[index].id !== messageId) throw Error("主对话生图需要引用最近一条明确授权的用户消息");
		const preceding = this.messages.slice(index + 1).flatMap(line => line.toolCalls ?? []).filter(call => call.name === "image_gen" && call.id !== toolCallId);
		const previous = this.imageAttempt?.messageId === messageId ? this.imageAttempt : undefined;
		if (previous) {
			if (!previous.canCorrect || !preceding.some(call => call.id === previous.toolCallId && call.status === "error")) {
				throw Error("主对话每条请求只能生成一次单张图片；批量生成或设计请发布任务");
			}
			if (previous.request === request) throw Error("参数没有变化，请按提供商文档调整参数，或向用户索要文档");
		} else if (preceding.some(call => call.status !== "running")) {
			throw Error("这条请求已有生图尝试；若仍需生成图片，请让用户在新的消息里确认");
		}
		const attempt = { messageId, toolCallId, request, canCorrect: false };
		this.imageAttempt = attempt;
		return (parametersRejected) => { if (!previous && parametersRejected) attempt.canCorrect = true; };
	}

	private publish(toolCallId: string, attachments: ResourceRef[]): void {
		const line = this.toolLines.get(toolCallId);
		if (!line) throw Error("找不到附件对应的工具调用");
		this.resources?.().retain(`message:${line.id}`, attachments.map(ref => ref.id));
		line.attachments = [...new Map([...(line.attachments ?? []), ...attachments].map(ref => [ref.id, ref])).values()];
		const call = line.toolCalls?.find(call => call.id === toolCallId);
		if (call) call.attachments = attachments;
		this.logLine(line); this.emit({ type: "message", message: clone(line) });
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
			source: line.source,
			attachments: line.attachments,
			delivery: line.delivery,
			replyTo: line.replyTo,
			submissionId: line.submissionId,
		});
	}

	private refreshHeader(): void {
		const usage = this.model ? this.session?.getContextUsage() : undefined;
		const reserve = this.session?.settingsManager.getCompactionReserveTokens(this.session.model) ?? 0;
		const threshold = usage ? Math.max(0, 1 - reserve / usage.contextWindow) : 0;
		// Leave 30 percentage points before the configured trigger; warn proportionally
		// earlier for models with an unusually low threshold.
		const warning = Math.max(threshold / 2, threshold - 0.3);
		const showCompact = usage?.tokens != null && usage.tokens > 0 && usage.tokens >= warning * usage.contextWindow;
		const showNewConversation = this.compactions >= NEW_CONVERSATION_COMPACTIONS;
		if (this.header.showCompact === showCompact && this.header.showNewConversation === showNewConversation) return;
		this.header = { ...this.header, showCompact, showNewConversation };
		this.emit({ type: "header", header: this.header });
	}

	private setActivity(activity: ChatActivity | null): void {
		if (this.header.activity === activity) return;
		this.header = { ...this.header, activity };
		this.emit({ type: "header", header: this.header });
	}

	private setBusy(busy: boolean): void {
		if (!busy) this.setActivity(null);
		if (this.busy === busy) return;
		this.busy = busy;
		this.emit({ type: "busy", busy });
	}

	private fail(error: unknown): void {
		this.loopFailed = true;
		this.header = { ...this.header, loopResult: { outcome: "error", at: Date.now() } };
		this.emit({ type: "header", header: this.header });
		const message = error instanceof Error ? error.message : String(error);
		this.finishStreaming();
		this.addLine("system", `出错了：${message}`);
		this.setBusy(false);
	}

	private replay(): void {
		for (const event of this.events.all()) {
			if (event.kind === "chat_queue_paused") this.inboxPaused = event.data.paused === true;
			if (event.kind === "chat_reset") {
				const id = event.data.conversationId;
				if (typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)) this.conversation = { id, at: event.at };
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
			const source = event.data.source as ImSource | undefined;
			if (source?.platform === "feishu" || source?.platform === "qq") this.receivedIm.add(imKey(source));
			const attachments = event.data.attachments as ResourceRef[] | undefined;
			const delivery = event.data.delivery as ChatDelivery | undefined;
			const replyTo = typeof event.data.replyTo === "string" ? event.data.replyTo : undefined;
			const submissionId = typeof event.data.submissionId === "string" ? event.data.submissionId : undefined;
			if (submissionId) this.receivedSubmissions.add(submissionId);
			const line = { id: `#${n}`, role, text, at, streaming: false, toolCalls, blocks, relayId, source, attachments, delivery, replyTo, submissionId };
			const index = this.messages.findIndex((item) => item.id === line.id);
			if (index === -1) this.messages.push(line);
			else this.messages[index] = line;
			this.nextLine = Math.max(this.nextLine, n + 1);
		}
	}

	private recoverInbox(): void {
		for (const line of this.messages) {
			if (line.delivery?.status === "processing") {
				this.setDelivery(line, { status: "failed", error: "上次处理被中断，可能已有部分操作完成。请检查进展后重试。" });
				this.setInboxPaused(true);
			} else if (line.delivery?.reply?.status === "sending") {
				this.setDelivery(line, { ...line.delivery, reply: { ...line.delivery.reply, status: "failed", error: "上次发送结果不明，请先检查原聊天；重发可能重复。" } });
			}
		}
	}
}

/** Earlier segments may retain copies of compaction entries. Count each once, stopping at the UI threshold. */
function countCompactions(manager: SessionManager): number {
	const ids = new Set<string>();
	const visited = new Set<string>();
	while (ids.size < NEW_CONVERSATION_COMPACTIONS) {
		for (const entry of manager.getBranch()) if (entry.type === "compaction") ids.add(entry.id);
		if (ids.size >= NEW_CONVERSATION_COMPACTIONS) break;
		const header = manager.getHeader();
		const parent = header?.parentSession;
		if (!header?.segmentCompactionId || !parent || dirname(parent) !== manager.getSessionDir() || extname(parent) !== ".jsonl" || visited.has(parent)) break;
		visited.add(parent);
		try { manager = SessionManager.open(parent, manager.getSessionDir(), manager.getCwd()); }
		catch { break; }
	}
	return ids.size;
}

function toolActivity(name: string): ChatActivity {
	if (QUERY_TOOLS.has(name)) return "querying";
	if (name === "task_dispatch" || name === "schedule_create") return "planning";
	if (name.startsWith("task_") || name.startsWith("schedule_")) return "orchestrating";
	return "tooling";
}

function imKey(source: ImSource): string {
	return JSON.stringify([source.platform, source.appId, source.chatId, source.messageId]);
}

function clone(line: ChatLine): ChatLine {
	return { ...line, delivery: line.delivery && structuredClone(line.delivery), attachments: line.attachments?.map(ref => ({ ...ref })), blocks: line.blocks?.map((block) => ({ ...block })), toolCalls: line.toolCalls?.map((call) => ({ ...call })) };
}

function relayIds(details: unknown): string[] {
	if (!details || typeof details !== "object" || !("relayIds" in details) || !Array.isArray(details.relayIds)) return [];
	return details.relayIds.filter((id): id is string => typeof id === "string");
}
