import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { QqMailCredentials, QqMailState } from "../shared/connections.ts";
import type { CredentialVault } from "./credential-vault.ts";
import { qqMailTransport, type QqMailTransport } from "./qqmail-transport.ts";

interface Stored { address: string; ciphertext: string }
const badLogin = "无法验证 QQ 邮箱。请确认已开启 IMAP/SMTP、填写的是邮箱授权码，并检查网络。";
const isAddress = (address: string) => /^[a-z0-9][a-z0-9_.-]{0,63}@qq\.com$/i.test(address);

export class QqMailConnection {
	private readonly file: string;
	private saved?: Stored;
	private generation = new AbortController();
	private checking?: AbortController;
	private checkedAt?: number;
	private error?: string;
	private disposed = false;
	private readonly vault?: CredentialVault;
	readonly transport: QqMailTransport;

	constructor(home: string, vault?: CredentialVault, transport = qqMailTransport) {
		this.file = join(home, "qqmail-connection.json");
		this.vault = vault;
		this.transport = transport;
		try {
			if (!existsSync(this.file)) return;
			const saved = JSON.parse(readFileSync(this.file, "utf8")) as Partial<Stored> | null;
			if (!saved || typeof saved.address !== "string" || !isAddress(saved.address) || typeof saved.ciphertext !== "string" || !vault) throw new Error();
			vault.decrypt(Buffer.from(saved.ciphertext, "base64"));
			this.saved = { address: saved.address, ciphertext: saved.ciphertext };
		} catch { this.error = "无法读取本地 QQ 邮箱凭据，请重新连接。"; }
	}

	state(): QqMailState {
		return { address: this.saved?.address, status: this.checking ? "checking" : this.error ? "error" : this.saved ? "connected" : "disconnected", checkedAt: this.checkedAt, error: this.error };
	}

	async save(input: QqMailCredentials): Promise<QqMailState> {
		if (this.disposed || !this.vault) throw new Error("系统凭据加密不可用，无法保存 QQ 邮箱授权码。");
		const address = typeof input?.address === "string" ? input.address.trim().toLowerCase() : "";
		const authorizationCode = typeof input?.authorizationCode === "string" ? input.authorizationCode.trim() : "";
		if (!isAddress(address) || !authorizationCode || authorizationCode.length > 256 || /[\s\x00-\x1f\x7f]/.test(authorizationCode)) throw new Error("请输入 @qq.com 邮箱地址和完整的邮箱授权码。");
		const ciphertext = this.vault.encrypt(authorizationCode).toString("base64");
		await this.check({ address, authorizationCode }, () => {
			const saved = { address, ciphertext };
			const temp = `${this.file}.tmp`;
			try {
				writeFileSync(temp, JSON.stringify(saved), { encoding: "utf8", mode: 0o600 });
				renameSync(temp, this.file);
			} finally { rmSync(temp, { force: true }); }
			this.revoke();
			this.saved = saved;
		});
		return this.state();
	}

	async verify(): Promise<QqMailState> {
		await this.check(this.credentials());
		return this.state();
	}

	disconnect(): QqMailState {
		if (this.disposed) return this.state();
		rmSync(this.file, { force: true });
		this.checking?.abort(); this.checking = undefined;
		this.revoke(); this.saved = undefined; this.error = undefined; this.checkedAt = undefined;
		return this.state();
	}

	available(): boolean { return !this.disposed && Boolean(this.saved); }

	/** Privilege is bound to the account configuration the Worker started with. */
	lease() {
		const generation = this.generation;
		if (!this.available()) return undefined;
		return {
			address: this.saved!.address,
			run: async <T>(work: (credentials: QqMailCredentials, signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
				const combined = signal ? AbortSignal.any([generation.signal, signal]) : generation.signal;
				combined.throwIfAborted();
				return work(this.credentials(), combined);
			},
		};
	}

	dispose(): void { this.disposed = true; this.checking?.abort(); this.generation.abort(); }

	private revoke(): void { this.generation.abort(); this.generation = new AbortController(); }

	private credentials(): QqMailCredentials {
		if (this.disposed || !this.saved || !this.vault) throw new Error("QQ 邮箱尚未连接。");
		try { return { address: this.saved.address, authorizationCode: this.vault.decrypt(Buffer.from(this.saved.ciphertext, "base64")) }; }
		catch { throw new Error("无法读取 QQ 邮箱授权码，请重新连接。"); }
	}

	private async check(credentials: QqMailCredentials, afterVerification?: () => void): Promise<void> {
		if (this.disposed || this.checking) throw new Error("已有 QQ 邮箱验证正在进行。");
		const check = new AbortController();
		this.checking = check;
		try {
			try { await this.transport.verify(credentials, check.signal); }
			catch { check.signal.throwIfAborted(); if (!this.saved || !afterVerification) this.error = badLogin; throw new Error(badLogin); }
			check.signal.throwIfAborted();
			afterVerification?.();
			this.checkedAt = Date.now(); this.error = undefined;
		} finally { if (this.checking === check) this.checking = undefined; }
	}
}
