import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "ssh2";
import type { SshServer, SshServerInput, SshVerification } from "../shared/ssh.ts";
import type { CredentialVault } from "./credential-vault.ts";

interface StoredServer extends SshServer { ciphertext: string }
interface Secrets { secret: string; passphrase?: string }

/** Configuration and authentication stay on the execution host. No credentials in public state. */
export class SshConnections {
	private readonly file: string;
	private readonly vault?: CredentialVault;
	private servers: StoredServer[] = [];
	private readonly pendingKeys = new Map<string, string>();
	private readonly connections = new Map<Client, string>();
	private disposed = false;

	constructor(home: string, vault?: CredentialVault) {
		this.file = join(home, "ssh-connections.json");
		this.vault = vault;
		try {
			const saved = JSON.parse(readFileSync(this.file, "utf8")) as StoredServer[];
			if (!Array.isArray(saved)) throw new Error("SSH 配置格式无效");
			for (const server of saved) {
				this.validate(server);
				if (typeof server.id !== "string" || typeof server.enabled !== "boolean" || typeof server.ciphertext !== "string") throw new Error("SSH 配置格式无效");
			}
			this.servers = saved;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("无法读取 SSH 配置");
		}
	}

	state(): SshServer[] { return this.servers.map(({ ciphertext: _secret, ...server }) => ({ ...server })); }

	server(id: string): SshServer {
		const server = this.state().find(item => item.id === id);
		if (!server) throw new Error("SSH 服务器不存在");
		return server;
	}

	/** Snapshot identity is checked again after permission waits. */
	version(id: string): object { return this.require(id); }
	assertCurrent(id: string, version: object): void {
		if (this.disposed || this.require(id) !== version || !this.require(id).enabled) throw new Error("SSH 配置已修改或停用，请重新查询服务器");
	}

	save(input: SshServerInput): SshServer[] {
		this.validate(input);
		const previous = input.id ? this.require(input.id) : undefined;
		if (!this.vault) throw new Error("系统凭据加密不可用");
		const oldSecrets = previous ? this.secrets(previous) : undefined;
		const secret = input.secret === undefined ? (previous?.auth === input.auth ? oldSecrets?.secret : undefined) : input.secret;
		if (typeof secret !== "string" || !secret || secret.length > 65536 || secret.includes("\0")) throw new Error("请填写有效的密码或私钥");
		const passphrase = input.passphrase ?? (input.auth === previous?.auth ? oldSecrets?.passphrase : undefined);
		if (passphrase !== undefined && (typeof passphrase !== "string" || passphrase.length > 4096 || passphrase.includes("\0"))) throw new Error("私钥口令无效");
		const host = input.host.trim();
		const server: StoredServer = {
			id: previous?.id ?? randomUUID(), name: input.name.trim(), host, port: input.port, username: input.username.trim(), auth: input.auth,
			enabled: previous?.enabled ?? true,
			fingerprint: previous?.host === host && previous.port === input.port ? previous.fingerprint : undefined,
			ciphertext: this.vault.encrypt(JSON.stringify({ secret, ...(input.auth === "privateKey" ? { passphrase } : {}) })).toString("base64"),
		};
		this.persist(previous ? this.servers.map(item => item.id === server.id ? server : item) : [...this.servers, server]);
		this.revoke(server.id);
		return this.state();
	}

	update(id: string, enabled: boolean): SshServer[] {
		if (typeof enabled !== "boolean") throw new Error("SSH 启用状态无效");
		this.require(id);
		this.persist(this.servers.map(item => item.id === id ? { ...item, enabled } : item));
		this.revoke(id);
		return this.state();
	}

	remove(id: string): SshServer[] {
		this.require(id);
		this.persist(this.servers.filter(item => item.id !== id));
		this.revoke(id);
		return this.state();
	}

	async verify(id: string, fingerprint?: string): Promise<SshVerification> {
		let server = this.require(id);
		if (fingerprint !== undefined) {
			if (!fingerprint || this.pendingKeys.get(id) !== fingerprint) throw new Error("请先测试连接，再确认本次显示的指纹");
			server = { ...server, fingerprint, checkedAt: undefined };
			this.persist(this.servers.map(item => item.id === id ? server : item));
			this.revoke(id);
		}
		let observed: string | undefined;
		try {
			const client = await this.connect(server, undefined, key => { observed = key; });
			client.end();
			if (this.require(id) !== server) throw new Error("SSH 配置已修改，请重新测试");
			// Update only the saved verification result; existing channels remain open.
			this.persist(this.servers.map(item => item.id === id ? { ...item, checkedAt: Date.now() } : item));
			return { status: "verified", fingerprint: server.fingerprint! };
		} catch (error) {
			if (this.require(id) === server && observed && observed !== server.fingerprint) {
				this.pendingKeys.set(id, observed);
				return { status: "confirm", fingerprint: observed, previousFingerprint: server.fingerprint };
			}
			throw error;
		}
	}

	open(id: string, signal: AbortSignal): Promise<Client> {
		const server = this.require(id);
		if (!server.enabled) throw new Error("SSH 服务器已停用");
		if (!server.fingerprint) throw new Error("请在连接 → SSH 中测试连接并确认服务器指纹");
		return this.connect(server, signal);
	}

	secretValues(id: string): string[] {
		const secrets = this.secrets(this.require(id));
		return [secrets.secret, secrets.passphrase ?? ""];
	}

	dispose(): void {
		this.disposed = true;
		for (const client of this.connections.keys()) client.destroy();
		this.pendingKeys.clear();
	}

	private require(id: string): StoredServer {
		const server = this.servers.find(item => item.id === id);
		if (!server) throw new Error("SSH 服务器不存在");
		return server;
	}

	private connect(server: StoredServer, signal?: AbortSignal, observe?: (fingerprint: string) => void): Promise<Client> {
		if (this.disposed) return Promise.reject(new Error("SSH 已关闭"));
		signal?.throwIfAborted();
		const { secret, passphrase } = this.secrets(server);
		const client = new Client();
		this.connections.set(client, server.id);
		return new Promise((resolve, reject) => {
			let ready = false;
			let mismatch = false;
			const abort = () => client.destroy();
			client.on("error", () => {
				if (!ready) { reject(new Error(mismatch ? "服务器指纹未确认或已变化" : "SSH 连接或认证失败，请检查地址、账号和凭据")); client.destroy(); }
			});
			client.once("close", () => {
				this.connections.delete(client);
				signal?.removeEventListener("abort", abort);
				if (!ready) reject(new Error("SSH 连接已中断"));
			});
			client.once("ready", () => {
				if (signal?.aborted || this.disposed || this.servers.find(item => item.id === server.id) !== server) { client.destroy(); reject(new Error("SSH 连接已取消或配置已修改")); return; }
				ready = true;
				resolve(client);
			});
			signal?.addEventListener("abort", abort, { once: true });
			try {
				client.connect({ host: server.host, port: server.port, username: server.username,
					...(server.auth === "password" ? { password: secret } : { privateKey: secret, passphrase }),
					readyTimeout: 20000, keepaliveInterval: 15000, keepaliveCountMax: 3,
					hostVerifier: (key: Buffer) => {
						const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
						observe?.(fingerprint);
						mismatch = fingerprint !== server.fingerprint;
						return !mismatch;
					},
				});
			} catch { client.destroy(); reject(new Error("SSH 凭据或连接参数无效")); }
		});
	}

	private revoke(id: string): void {
		this.pendingKeys.delete(id);
		for (const [client, owner] of this.connections) if (owner === id) client.destroy();
	}

	private secrets(server: StoredServer): Secrets {
		if (!this.vault) throw new Error("系统凭据加密不可用");
		try { return JSON.parse(this.vault.decrypt(Buffer.from(server.ciphertext, "base64"))) as Secrets; }
		catch { throw new Error("无法解密 SSH 凭据"); }
	}

	private validate(input: SshServerInput): void {
		if (!input || typeof input !== "object") throw new Error("SSH 配置无效");
		for (const [field, limit] of [["name", 200], ["host", 253], ["username", 256]] as const) {
			const value = input[field];
			if (typeof value !== "string" || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) throw new Error("请填写有效的名称、地址和用户名");
		}
		if (/\s|\//.test(input.host.trim()) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("请输入有效的 SSH 地址与端口");
		if (input.auth !== "password" && input.auth !== "privateKey") throw new Error("SSH 认证方式无效");
	}

	private persist(servers: StoredServer[]): void {
		if (this.disposed) throw new Error("SSH 已关闭");
		mkdirSync(dirname(this.file), { recursive: true });
		const temp = `${this.file}.tmp`;
		try { writeFileSync(temp, JSON.stringify(servers), { mode: 0o600 }); renameSync(temp, this.file); }
		finally { rmSync(temp, { force: true }); }
		this.servers = servers;
	}
}
