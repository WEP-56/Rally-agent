import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLarkChannel, LoggerLevel, type LarkChannel, type NormalizedMessage } from "@larksuiteoapi/node-sdk";
import type { FeishuConnectionState, FeishuCredentials, FeishuSource } from "../shared/connections.ts";

import type { CredentialVault } from "./credential-vault.ts";

type Saved = { appId: string; secret: string; tools: boolean; owner?: string };
type Channel = Pick<LarkChannel, "connect" | "disconnect" | "send" | "getConnectionStatus" | "updatePolicy" | "botIdentity" | "rawWsClient"> & { on(name: "message", handler: (message: NormalizedMessage) => void | Promise<void>): () => void };
type ChannelFactory = (credentials: FeishuCredentials, owner?: string) => Channel;
const CONNECT_ERROR = "无法连接飞书。请检查网络、应用凭据、机器人能力和长连接设置，再试一次。";
const PAIR_TTL = 5 * 60_000;

function connectChannel(credentials: FeishuCredentials, owner?: string): Channel {
	return createLarkChannel({ ...credentials, transport: "websocket", source: "rally", loggerLevel: LoggerLevel.fatal,
		handshakeTimeoutMs: 8_000, wsConfig: { pingTimeout: 10 },
		policy: { dmMode: owner ? "allowlist" : "disabled", dmAllowlist: owner ? [owner] : [], groupAllowlist: [] },
		safety: { staleMessageWindowMs: 5 * 60_000, chatQueue: { enabled: true }, batch: { text: { maxMessages: 1 } } },
	});
}

export class FeishuConnection {
	private readonly file: string;
	private saved?: Saved;
	private channel?: Channel;
	private pairing?: NonNullable<FeishuConnectionState["pairing"]>;
	private error?: string;
	private connecting = false;
	private disposed = false;
	private lastMessageAt?: number;
	private readonly toolClosers = new Set<() => Promise<void>>();
	private readonly vault?: CredentialVault;
	private readonly receive: (text: string, source: FeishuSource) => Promise<string | null>;
	private readonly factory: ChannelFactory;

	constructor(home: string, vault: CredentialVault | undefined, receive: FeishuConnection["receive"], factory: ChannelFactory = connectChannel) {
		this.file = join(home, "feishu-connection.json");
		this.vault = vault;
		this.receive = receive;
		this.factory = factory;
		try {
			if (!existsSync(this.file)) return;
			const saved = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved> | null;
			if (!saved || typeof saved.appId !== "string" || typeof saved.secret !== "string" || typeof saved.tools !== "boolean" || (saved.owner !== undefined && typeof saved.owner !== "string")) throw new Error();
			this.saved = { appId: saved.appId, secret: saved.secret, tools: saved.tools, owner: saved.owner };
		} catch { this.error = "无法读取本地飞书配置，请重新连接。"; }
	}

	state(): FeishuConnectionState {
		if (this.pairing && this.pairing.expiresAt <= Date.now()) {
			this.pairing = undefined;
			this.channel?.updatePolicy({ dmMode: "disabled" });
		}
		const ws = this.channel?.getConnectionStatus()?.state;
		const status = this.connecting ? "connecting" : ws === "connected" ? "connected" : ws === "reconnecting" || ws === "connecting" ? "reconnecting" : this.error || ws === "failed" ? "error" : "disconnected";
		return { status, appId: this.saved?.appId, botName: this.channel?.botIdentity?.name, paired: Boolean(this.saved?.owner), tools: this.saved?.tools === true,
			pairing: this.pairing && { ...this.pairing }, lastMessageAt: this.lastMessageAt, error: this.error ?? (ws === "failed" ? CONNECT_ERROR : undefined) };
	}

	save(input: FeishuCredentials): FeishuConnectionState {
		if (this.disposed || !this.vault) throw new Error("系统凭据加密不可用，无法保存飞书应用密钥。");
		const appId = typeof input?.appId === "string" ? input.appId.trim() : "";
		const appSecret = typeof input?.appSecret === "string" ? input.appSecret.trim() : "";
		if (!/^cli_[A-Za-z0-9]{6,64}$/.test(appId) || !/^[A-Za-z0-9_-]{8,128}$/.test(appSecret)) throw new Error("请输入有效的飞书 App ID 和 App Secret。");
		const previous = this.saved?.appId === appId ? this.saved : undefined;
		this.persist({ appId, secret: this.vault.encrypt(appSecret).toString("base64"), tools: previous?.tools ?? false, owner: previous?.owner });
		return this.start();
	}

	start(): FeishuConnectionState {
		if (this.disposed || !this.saved) return this.state();
		void this.stop();
		this.error = undefined;
		try {
			const channel = this.factory(this.credentials(), this.saved.owner);
			this.channel = channel;
			this.connecting = true;
			channel.on("message", message => this.accept(channel, message));
			void channel.connect().catch(() => {
				if (this.channel !== channel) return;
				this.error = CONNECT_ERROR;
				this.channel = undefined;
				this.connecting = false;
			}).finally(() => {
				if (this.channel === channel) this.connecting = false;
				else void this.closeChannel(channel);
			});
		} catch { this.error = "无法解密本地的飞书应用密钥，请重新连接。"; }
		return this.state();
	}

	pair(): FeishuConnectionState {
		if (this.state().status !== "connected" || !this.channel || this.saved?.owner) throw new Error("当前无法配对，请先连接尚未配对的飞书机器人。");
		this.pairing = { code: randomBytes(5).toString("hex"), expiresAt: Date.now() + PAIR_TTL };
		this.channel.updatePolicy({ dmMode: "open" });
		return this.state();
	}

	setTools(enabled: boolean): FeishuConnectionState {
		if (!this.saved || this.disposed || (enabled && !this.saved.owner) || typeof enabled !== "boolean") throw new Error("请先配对飞书机器人。");
		if (this.saved.tools !== enabled) {
			this.persist({ ...this.saved, tools: enabled });
			if (!enabled) void this.closeTools();
		}
		return this.state();
	}

	disconnect(): FeishuConnectionState {
		if (this.disposed) return this.state();
		rmSync(this.file, { force: true });
		this.saved = undefined;
		this.error = undefined;
		this.lastMessageAt = undefined;
		void this.stop();
		return this.state();
	}

	toolsEnabled(): boolean { return !this.disposed && Boolean(this.saved?.tools && this.saved.owner); }

	canReply(source: FeishuSource): boolean {
		return !this.disposed && this.saved?.appId === source.appId && this.saved.owner === source.senderId && this.state().status === "connected";
	}

	async reply(source: FeishuSource, text: string): Promise<void> {
		if (!this.canReply(source) || !this.channel) throw Error("原飞书账号尚未连接，回复保留在收件箱");
		try {
			await this.channel.send(source.chatId, { text }, { replyTo: source.messageId });
			this.error = undefined;
		} catch {
			this.error = "飞书回复发送失败，请检查机器人发消息权限。";
			throw Error(this.error);
		}
	}

	openTools(close: () => Promise<void>): { credentials: FeishuCredentials; release: () => void } {
		if (!this.toolsEnabled()) throw new Error("飞书工具未授权。");
		const credentials = this.credentials();
		this.toolClosers.add(close);
		return { credentials, release: () => this.toolClosers.delete(close) };
	}

	async dispose(): Promise<void> { this.disposed = true; await this.stop(); }

	private credentials(): FeishuCredentials {
		if (!this.vault || !this.saved) throw new Error("没有可用的飞书凭据。");
		return { appId: this.saved.appId, appSecret: this.vault.decrypt(Buffer.from(this.saved.secret, "base64")) };
	}

	private persist(saved: Saved): void {
		const temp = `${this.file}.tmp`;
		writeFileSync(temp, JSON.stringify(saved), { encoding: "utf8", mode: 0o600 });
		renameSync(temp, this.file);
		this.saved = saved;
	}

	private async closeTools(): Promise<void> {
		const closers = [...this.toolClosers];
		this.toolClosers.clear();
		await Promise.allSettled(closers.map(close => close()));
	}

	private async stop(): Promise<void> {
		const channel = this.channel;
		this.channel = undefined;
		this.connecting = false;
		this.pairing = undefined;
		await Promise.allSettled([this.closeChannel(channel), this.closeTools()]);
	}

	private async closeChannel(channel?: Channel): Promise<void> {
		// The SDK only disconnects after the first successful handshake. Close a pending socket too.
		channel?.rawWsClient?.close({ force: true });
		await channel?.disconnect().catch(() => {});
	}

	private async accept(channel: Channel, message: NormalizedMessage): Promise<void> {
		if (this.channel !== channel || !this.saved || message.chatType !== "p2p" || message.rawContentType !== "text" || !message.senderId.startsWith("ou_") || !message.messageId || !message.chatId) return;
		const text = message.content.trim();
		if (!text) return;
		const reply = async (result: string) => {
			if (this.channel !== channel || this.disposed) return;
			try {
				await channel.send(message.chatId, { text: result }, { replyTo: message.messageId });
				if (this.channel === channel) this.error = undefined;
			}
			catch { if (this.channel === channel) this.error = "飞书回复发送失败，请检查机器人发消息权限。"; }
		};
		if (!this.saved.owner) {
			const pairing = this.state().pairing;
			if (!pairing || text !== `/pair ${pairing.code}`) return;
			try { this.persist({ ...this.saved, owner: message.senderId }); }
			catch { this.error = "无法保存配对，请检查本地数据目录。"; return; }
			this.pairing = undefined;
			channel.updatePolicy({ dmMode: "allowlist", dmAllowlist: [message.senderId] });
			await reply("Rally 配对成功。现在可以在这里发送消息，继续桌面上的主对话。");
			return;
		}
		if (message.senderId !== this.saved.owner || text.startsWith("/pair ")) return;
		this.lastMessageAt = Date.now();
		if (text.length > 16_000) { await reply("这条消息太长，请拆成几条发送。"); return; }
		try {
			const result = await this.receive(text, { platform: "feishu", appId: this.saved.appId, chatId: message.chatId, messageId: message.messageId, senderId: message.senderId });
			if (result) await reply(result);
		} catch { await reply("Rally 未能处理这条消息，请在桌面查看主对话。"); }
	}
}
