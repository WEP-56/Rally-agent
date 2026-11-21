import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QQBot, type QQBotInboundMessage } from "@tencent-connect/qqbot-nodejs";
import type { ImBotCredentials, ImBotState, QqBotSource } from "../shared/connections.ts";
import type { CredentialVault } from "./credential-vault.ts";

type Saved = { appId: string; ciphertext: string; owner?: string };
export type QqBotClient = Pick<QQBot, "on" | "start" | "stop" | "sendText">;
export type QqBotFactory = (credentials: ImBotCredentials) => QqBotClient;
const WINDOW = 5 * 60_000;
const CONNECT_ERROR = "无法连接 QQ 机器人。请检查 AppID、AppSecret 和机器人状态后重连。";
// The official gateway combines c2c and group events under one intent. Only c2c is routed below.
const GROUP_AND_C2C = 1 << 25;
const connect: QqBotFactory = credentials => new QQBot({ ...credentials, transport: "websocket", intents: GROUP_AND_C2C, reconnect: { maxAttempts: 8 } });

export class QqBotConnection {
	private readonly file: string;
	private readonly vault?: CredentialVault;
	private readonly factory: QqBotFactory;
	private readonly receive: (text: string, source: QqBotSource) => Promise<string | null>;
	private saved?: Saved;
	private client?: QqBotClient;
	private status: ImBotState["status"] = "disconnected";
	private pairing?: ImBotState["pairing"];
	private disposed = false;
	private error?: string;
	private lastMessageAt?: number;
	private readonly seen = new Map<string, number>();

	constructor(home: string, vault: CredentialVault | undefined, receive: QqBotConnection["receive"], factory: QqBotFactory = connect) {
		this.file = join(home, "qqbot-connection.json");
		this.vault = vault;
		this.receive = receive;
		this.factory = factory;
		try {
			if (!existsSync(this.file)) return;
			const saved = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Saved> | null;
			if (!saved || typeof saved.appId !== "string" || typeof saved.ciphertext !== "string" || (saved.owner !== undefined && typeof saved.owner !== "string")) throw new Error();
			this.saved = { appId: saved.appId, ciphertext: saved.ciphertext, owner: saved.owner };
		} catch { this.status = "error"; this.error = "无法读取本地 QQ 机器人配置，请重新连接。"; }
	}

	state(): ImBotState {
		if (this.pairing && this.pairing.expiresAt <= Date.now()) this.pairing = undefined;
		return { status: this.status, appId: this.saved?.appId, paired: Boolean(this.saved?.owner), pairing: this.pairing && { ...this.pairing }, lastMessageAt: this.lastMessageAt, error: this.error };
	}

	save(input: ImBotCredentials): ImBotState {
		if (!this.vault || this.disposed) throw new Error("系统凭据加密不可用，无法保存 QQ 机器人密钥。");
		const appId = typeof input?.appId === "string" ? input.appId.trim() : "";
		const appSecret = typeof input?.appSecret === "string" ? input.appSecret.trim() : "";
		if (!/^\d{1,32}$/.test(appId) || !appSecret || appSecret.length > 256 || /[\s\x00-\x1f\x7f]/.test(appSecret)) throw new Error("请输入 QQ 机器人开放平台的 AppID 和 AppSecret。");
		const owner = this.saved?.appId === appId ? this.saved.owner : undefined;
		this.persist({ appId, ciphertext: this.vault.encrypt(appSecret).toString("base64"), owner });
		if (!owner) this.lastMessageAt = undefined;
		return this.start();
	}

	start(): ImBotState {
		if (this.disposed || !this.saved) return this.state();
		this.stop();
		this.error = undefined;
		try {
			if (!this.vault) throw new Error();
			const client = this.factory({ appId: this.saved.appId, appSecret: this.vault.decrypt(Buffer.from(this.saved.ciphertext, "base64")) });
			this.client = client;
			this.status = "connecting";
			const ready = () => { if (this.client === client) { this.status = "connected"; this.error = undefined; } };
			const failed = () => { if (this.client === client) { this.stop(); this.status = "error"; this.error = CONNECT_ERROR; } };
			client.on("ready", ready);
			client.on("resumed", ready);
			client.on("disconnected", event => {
				if (this.client !== client) return;
				if (event.willReconnect) this.status = "reconnecting";
				else failed();
			});
			client.on("message", (_context, message) => this.accept(client, message));
			void client.start().then(failed, failed);
		} catch { this.stop(); this.status = "error"; this.error = CONNECT_ERROR; }
		return this.state();
	}

	pair(): ImBotState {
		if (this.status !== "connected" || !this.saved || this.saved.owner) throw new Error("请先连接尚未配对的 QQ 机器人。");
		this.pairing = { code: randomBytes(5).toString("hex"), expiresAt: Date.now() + WINDOW };
		return this.state();
	}

	disconnect(): ImBotState {
		if (this.disposed) return this.state();
		rmSync(this.file, { force: true });
		this.stop();
		this.saved = undefined;
		this.error = undefined;
		this.lastMessageAt = undefined;
		this.seen.clear();
		return this.state();
	}

	dispose(): void { this.disposed = true; this.stop(); }

	private stop(): void {
		const client = this.client;
		this.client = undefined;
		this.pairing = undefined;
		this.status = "disconnected";
		client?.stop();
	}

	private persist(saved: Saved): void {
		const temp = `${this.file}.tmp`;
		try {
			writeFileSync(temp, JSON.stringify(saved), { encoding: "utf8", mode: 0o600 });
			renameSync(temp, this.file);
		} finally { rmSync(temp, { force: true }); }
		this.saved = saved;
	}

	private async accept(client: QqBotClient, message: QQBotInboundMessage): Promise<void> {
		const saved = this.saved;
		if (this.client !== client || this.status !== "connected" || !saved || message.kind !== "c2c" ||
			typeof message.content !== "string" || !message.senderId || !message.messageId || message.attachments?.length) return;
		const now = Date.now();
		const timestamp = Date.parse(message.timestamp);
		if (!Number.isFinite(timestamp) || timestamp < now - WINDOW || timestamp > now + WINDOW) return;
		const text = message.content.trim();
		if (!text) return;
		const reply = async (value: string) => {
			if (this.client !== client || this.saved?.owner !== message.senderId) return;
			try {
				await client.sendText({ scope: "c2c", targetId: message.senderId, msgId: message.messageId }, replyText(value));
				if (this.client === client) this.error = undefined;
			} catch { if (this.client === client) this.error = "QQ 机器人回复失败，请检查平台权限或在桌面查看回复。"; }
		};
		if (!saved.owner) {
			const code = this.state().pairing?.code;
			if (!code || text !== `/pair ${code}`) return;
			try { this.persist({ ...saved, owner: message.senderId }); }
			catch { this.error = "无法保存配对，请检查本地数据目录。"; return; }
			this.pairing = undefined;
			await reply("Rally 配对成功。现在可以通过机器人继续桌面上的主对话。");
			return;
		}
		if (message.senderId !== saved.owner || /^\/pair(?:\s|$)/.test(text)) return;
		const key = JSON.stringify([saved.appId, message.senderId, message.messageId]);
		for (const [id, at] of this.seen) { if (at >= now - WINDOW) break; this.seen.delete(id); }
		if (this.seen.has(key)) return;
		if (this.seen.size >= 1024) this.seen.delete(this.seen.keys().next().value!);
		this.seen.set(key, now);
		this.lastMessageAt = now;
		if (text.length > 16_000) { await reply("这条消息太长，请拆成几条发送。"); return; }
		try {
			const result = await this.receive(text, { platform: "qq", appId: saved.appId, chatId: message.senderId, messageId: message.messageId });
			if (result) await reply(result);
		} catch { await reply("Rally 未能处理这条消息，请在桌面查看主对话。"); }
	}
}

function replyText(value: string): string {
	// Keep a single reply comfortably within the platform's text budget; preserve the full turn on desktop.
	if (Buffer.byteLength(value, "utf8") <= 1800) return value;
	let result = "";
	let bytes = 0;
	for (const char of value) {
		bytes += Buffer.byteLength(char, "utf8");
		if (bytes > 1700) break;
		result += char;
	}
	return `${result.trimEnd()}\n… 完整回复请在 Rally 桌面查看。`;
}
