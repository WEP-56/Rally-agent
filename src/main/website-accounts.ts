import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CredentialRequest, CredentialState, WebsiteAccount } from "../shared/credentials.ts";
import { httpAddress } from "../shared/browser.ts";
import type { CredentialVault } from "./credential-vault.ts";

interface Account extends WebsiteAccount { username: string; password: string }
interface Saved { version: 1; accounts: Account[]; requests: CredentialRequest[] }

function origin(value: unknown): string {
	if (typeof value !== "string") throw Error("网站地址无效");
	return new URL(httpAddress(value)).origin;
}

/** Host-only secrets. Public state deliberately excludes account names and passwords. */
export class WebsiteAccounts {
	private readonly file: string;
	private readonly vault?: CredentialVault;
	private readonly active: (taskId: string, runId?: string) => boolean;
	private saved: Saved = { version: 1, accounts: [], requests: [] };

	constructor(file: string, vault?: CredentialVault, active: (taskId: string, runId?: string) => boolean = () => false) {
		this.file = file; this.vault = vault; this.active = active;
		let ciphertext: string;
		try { ciphertext = readFileSync(file, "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw Error("无法读取网站账号库"); }
		if (!vault) throw Error("网站账号加密不可用");
		try {
			const data = JSON.parse(vault.decrypt(Buffer.from(ciphertext.trim(), "base64"))) as Saved;
			if (data.version !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.requests)) throw Error("格式无效");
			for (const account of data.accounts) {
				if (typeof account.id !== "string" || origin(account.origin) !== account.origin || typeof account.enabled !== "boolean" || !Number.isFinite(account.createdAt) || typeof account.username !== "string" || typeof account.password !== "string") throw Error("账号格式无效");
			}
			for (const request of data.requests) {
				if (typeof request.id !== "string" || origin(request.origin) !== request.origin || !["pending", "saved", "cancelled", "expired"].includes(request.status) || !Number.isFinite(request.createdAt)) throw Error("申请格式无效");
				for (const field of [request.purpose, request.taskId, request.runId]) if (field !== undefined && typeof field !== "string") throw Error("申请关联无效");
			}
			this.saved = data;
		} catch { throw Error("网站账号库无法解密或已损坏"); }
	}

	state(): CredentialState {
		this.expire();
		return {
			accounts: this.saved.accounts.map(({ id, origin, enabled, createdAt }) => ({ id, origin, enabled, createdAt })),
			requests: this.saved.requests.map(request => ({ ...request })),
		};
	}

	request(id: string, website: string, context: Pick<CredentialRequest, "purpose" | "taskId" | "runId"> = {}): CredentialRequest {
		this.expire();
		const site = origin(website);
		const previous = this.saved.requests.find(request => request.id === id);
		if (previous) { if (previous.origin !== site || previous.taskId !== context.taskId || previous.runId !== context.runId) throw Error("账号申请编号已用于其他网站或运行"); return { ...previous }; }
		if (context.taskId && !this.active(context.taskId, context.runId)) throw Error("关联任务或运行已结束");
		const request: CredentialRequest = { id, origin: site, status: "pending", createdAt: Date.now(), ...context };
		this.persist({ ...this.saved, requests: [...this.saved.requests, request] });
		return { ...request };
	}

	submit(input: unknown): CredentialRequest {
		this.expire();
		if (!input || typeof input !== "object") throw Error("账号提交格式无效");
		const raw = input as Record<string, unknown>;
		const request = this.saved.requests.find(item => item.id === raw.requestId);
		if (!request) throw Error("账号申请不存在");
		if (origin(raw.website) !== request.origin) throw Error("填写网站必须与申请来源一致");
		if (request.status !== "pending") return { ...request };
		const credentials = this.validateCredentials(raw);
		const account: Account = { id: randomUUID(), origin: request.origin, enabled: true, createdAt: Date.now(), ...credentials };
		const next: CredentialRequest = { ...request, status: "saved", accountId: account.id };
		this.persist({ ...this.saved, accounts: [...this.saved.accounts, account], requests: this.saved.requests.map(item => item.id === request.id ? next : item) });
		return { ...next };
	}

	cancel(id: string): void {
		this.expire();
		const request = this.saved.requests.find(item => item.id === id);
		if (!request) throw Error("账号申请不存在");
		if (request.status !== "pending") return;
		this.persist({ ...this.saved, requests: this.saved.requests.map(item => item.id === id ? { ...item, status: "cancelled" } : item) });
	}

	update(id: string, enabled: boolean): void {
		if (typeof enabled !== "boolean" || !this.saved.accounts.some(item => item.id === id)) throw Error("账号不存在或状态无效");
		this.persist({ ...this.saved, accounts: this.saved.accounts.map(item => item.id === id ? { ...item, enabled } : item) });
	}

	remove(id: string): void {
		if (!this.saved.accounts.some(item => item.id === id)) throw Error("账号不存在");
		this.persist({ ...this.saved, accounts: this.saved.accounts.filter(item => item.id !== id) });
	}

	replace(id: string, input: unknown): void {
		if (!this.saved.accounts.some(item => item.id === id)) throw Error("账号不存在");
		const credentials = this.validateCredentials(input);
		this.persist({ ...this.saved, accounts: this.saved.accounts.map(item => item.id === id ? { ...item, ...credentials } : item) });
	}

	private validateCredentials(input: unknown): { username: string; password: string } {
		if (!input || typeof input !== "object") throw Error("账号提交格式无效");
		const raw = input as Record<string, unknown>;
		if (typeof raw.username !== "string" || !raw.username.length || raw.username.length > 4096 || typeof raw.password !== "string" || !raw.password.length || raw.password.length > 16384) throw Error("请填写有效的账号和密码");
		return { username: raw.username, password: raw.password };
	}

	private expire(): void {
		const now = Date.now(); let changed = false;
		const requests = this.saved.requests.map(request => {
			if (request.status !== "pending" || (now - request.createdAt < 24 * 60 * 60 * 1000 && (!request.taskId || this.active(request.taskId, request.runId)))) return request;
			changed = true; return { ...request, status: "expired" as const };
		});
		if (changed) this.persist({ ...this.saved, requests });
	}

	/** Never expose this method through IPC or a model tool. Recheck origin again at the browser fill boundary. */
	forHost(id: string, website: string): { username: string; password: string } {
		const site = origin(website);
		const account = this.saved.accounts.find(item => item.id === id && item.enabled && item.origin === site);
		if (!account) throw Error("此网站没有可用的账号授权");
		return { username: account.username, password: account.password };
	}

	/** Host output filtering only; includes disabled accounts whose login state may remain. */
	privateValuesForHost(): string[] { return this.saved.accounts.flatMap(account => [account.username, account.password]); }

	private persist(next: Saved): void {
		if (!this.vault) throw Error("网站账号加密不可用");
		let ciphertext: Buffer;
		try { ciphertext = this.vault.encrypt(JSON.stringify(next)); }
		catch { throw Error("网站账号加密失败"); }
		const temporary = `${this.file}.${randomUUID()}.tmp`;
		try {
			mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
			writeFileSync(temporary, ciphertext.toString("base64") + "\n", { flag: "wx", mode: 0o600 });
			renameSync(temporary, this.file);
		} catch {
			rmSync(temporary, { force: true });
			throw Error("无法保存网站账号库");
		}
		this.saved = next;
	}
}
