import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";
import type { Client, ClientChannel } from "ssh2";
import type { CredentialReference } from "../../shared/credentials.ts";
import type { JobRecord } from "../../shared/jobs.ts";
import type { SshResult } from "../../shared/ssh.ts";
import type { Task, TaskRun } from "../../shared/task.ts";
import { SecretRedactor } from "../secret-redactor.ts";
import type { SshConnections } from "../ssh-connection.ts";
import type { WebsiteAccounts } from "../website-accounts.ts";
import type { TaskStore } from "./task-store.ts";

interface Session {
	job: JobRecord;
	controller: AbortController;
	client?: Client;
	channel?: ClientChannel;
	fd?: number;
	offset: number;
	events: EventEmitter;
	redactor: SecretRedactor;
	flush?: () => void;
	busy: boolean;
}

interface Options {
	connections: SshConnections;
	credentials: WebsiteAccounts;
	store: TaskStore;
	directory: string;
	onDone(job: JobRecord, text: string): void;
	onBusyChange(): void;
	onActivity(taskId: string): void;
}

export interface SshReadOptions { yieldTimeMs?: number; maxOutputChars?: number }
export interface SshInput extends SshReadOptions { chars?: string; credential?: CredentialReference; appendNewline?: boolean }

export class SshSessions {
	private readonly options: Options;
	private readonly sessions = new Map<string, Session>();
	private readonly taskStops = new Map<string, number>();
	private disposed = false;

	constructor(options: Options) { this.options = options; }

	recover(): void {
		for (const task of this.options.store.list()) for (const job of task.jobs ?? []) {
			if (!job.ssh) continue;
			if (job.status === "running") this.options.store.recordJob({ ...job, status: "killed", reason: "interrupted", endedAt: Date.now(),
				ssh: { ...job.ssh, status: "disconnected" }, error: "Rally restarted; remote command outcome is unknown." }, "job_exited");
			else if (job.backgroundedAt && !job.ssh.observed && !job.reason) this.options.onDone(job, this.completion(job));
		}
	}

	async execute(task: Task, run: TaskRun, serverId: string, command: string, tty: boolean, options: SshReadOptions, signal?: AbortSignal): Promise<SshResult> {
		this.active(task, run);
		this.taskStops.delete(task.id);
		this.limits(options);
		signal?.throwIfAborted();
		const id = `SSH-${randomUUID()}`;
		const redactor = new SecretRedactor();
		redactor.add(this.options.connections.secretValues(serverId));
		mkdirSync(this.options.directory, { recursive: true });
		const session: Session = {
			job: { id, taskId: task.id, runId: run.id, shell: "ssh", command, cwd: task.cwd, status: "running", startedAt: Date.now(), ssh: { serverId, status: "running" } },
			controller: new AbortController(), offset: 0, events: new EventEmitter(), redactor, busy: true,
		};
		this.sessions.set(id, session);
		const cancel = () => this.close(session, "cancelled");
		signal?.addEventListener("abort", cancel, { once: true });
		try {
			session.fd = openSync(this.logPath(id), "wx+", 0o600);
			this.options.store.recordJob(session.job, "job_started");
			this.options.onBusyChange();
			const client = await this.options.connections.open(serverId, session.controller.signal);
			session.client = client;
			client.on("error", () => this.finish(session, "disconnected", "SSH connection lost; remote command outcome is unknown."));
			client.once("close", () => this.finish(session, "disconnected", "SSH connection lost; remote command outcome is unknown."));
			this.active(task, run);
			session.controller.signal.throwIfAborted();
			const channel = await new Promise<ClientChannel>((resolve, reject) => {
				const closed = () => reject(new Error("SSH command channel closed before it was ready."));
				client.once("close", closed);
				client.exec(command, { pty: tty ? { term: "xterm", cols: 120, rows: 40 } : false }, (error, stream) => {
					client.off("close", closed);
					if (error) { reject(new Error("SSH server rejected the command channel.")); return; }
					// SSH can deliver exit-status in the same packet as channel acceptance.
					// Attach listeners here, before yielding back to the promise continuation.
					this.attach(session, stream);
					resolve(stream);
				});
			});
			if (session.controller.signal.aborted) { channel.destroy(); throw new Error("SSH command cancelled; check remote state."); }
			return await this.read(session, options, signal);
		} catch (error) {
			this.finish(session, "disconnected", error instanceof Error ? error.message : "SSH command failed.");
			throw error;
		} finally {
			signal?.removeEventListener("abort", cancel);
			session.busy = false;
			this.notify(session);
		}
	}

	serverId(taskId: string, id: string): string { return this.require(taskId, id).job.ssh!.serverId; }

	async continue(task: Task, run: TaskRun, id: string, input: SshInput, signal?: AbortSignal): Promise<SshResult> {
		this.active(task, run);
		this.limits(input);
		signal?.throwIfAborted();
		const session = this.require(task.id, id);
		if (session.busy) throw new Error("此 SSH 会话已有读写调用，请等待完成后继续。");
		if (input.credential && input.chars !== undefined) throw new Error("chars 和 credential 只能提供一个");
		if (input.appendNewline !== undefined && !input.credential) throw new Error("appendNewline 只用于 credential 输入");
		session.busy = true;
		try {
			let chars = input.chars ?? "";
			if (input.credential) {
				const secret = this.options.credentials.valueForHost(input.credential);
				session.redactor.add([secret]);
				chars = secret + (input.appendNewline === false ? "" : "\n");
			}
			if (chars) {
				const channel = session.channel;
				if (!channel?.writable || session.job.status !== "running") throw new Error("SSH 会话已结束，不能继续输入；不要自动重发不确定的操作。");
				await new Promise<void>((resolve, reject) => {
					const failed = () => { cleanup(); reject(new Error("SSH input outcome is unknown; check remote state before resending.")); };
					const cleanup = () => { channel.off("close", failed); signal?.removeEventListener("abort", failed); };
					channel.once("close", failed);
					signal?.addEventListener("abort", failed, { once: true });
					channel.write(chars, error => { cleanup(); if (error) reject(new Error("SSH input outcome is unknown; check remote state before resending.")); else resolve(); });
				});
			}
			return await this.read(session, input, signal);
		} finally { session.busy = false; this.notify(session); }
	}

	killTask(taskId: string, reason: JobRecord["reason"] = "task_ended"): number {
		const previous = this.taskStops.get(taskId);
		if (previous !== undefined) return previous;
		let count = 0;
		for (const session of this.sessions.values()) if (session.job.taskId === taskId && session.job.status === "running") { this.close(session, reason); count++; }
		this.taskStops.set(taskId, count);
		return count;
	}

	deleteTask(taskId: string): void {
		this.killTask(taskId);
		for (const job of this.options.store.get(taskId)?.jobs ?? []) if (job.ssh) {
			rmSync(this.logPath(job.id), { force: true });
			this.sessions.delete(job.id);
		}
		this.taskStops.delete(taskId);
	}

	dispose(): void {
		this.disposed = true;
		for (const session of this.sessions.values()) this.close(session, "shutdown");
	}

	private active(task: Task, run: TaskRun): void {
		if (this.disposed || task.ended || run.endedAt) throw new Error("任务或运行已结束");
	}

	private attach(session: Session, channel: ClientChannel): void {
		session.channel = channel;
		const stdoutDecoder = new StringDecoder("utf8"), stderrDecoder = new StringDecoder("utf8");
		const stdout = session.redactor.stream(text => this.append(session, text));
		const stderr = session.redactor.stream(text => this.append(session, text));
		session.flush = () => { stdout.write(stdoutDecoder.end()); stderr.write(stderrDecoder.end()); stdout.end(); stderr.end(); };
		channel.on("data", (data: Buffer) => stdout.write(stripVTControlCharacters(stdoutDecoder.write(data))));
		channel.stderr.on("data", (data: Buffer) => stderr.write(stripVTControlCharacters(stderrDecoder.write(data))));
		channel.once("exit", (code: number | null, exitSignal?: string) => {
			if (typeof code === "number") session.job.exitCode = code;
			if (exitSignal) session.job.ssh!.exitSignal = exitSignal;
		});
		channel.on("error", () => this.finish(session, "disconnected", "SSH channel failed; remote command outcome is unknown."));
		channel.once("close", () => this.finish(session, session.job.exitCode !== undefined || session.job.ssh!.exitSignal ? "exited" : "disconnected",
			session.job.exitCode === undefined && !session.job.ssh!.exitSignal ? "SSH channel closed without an exit status; check remote state." : undefined));
	}

	private require(taskId: string, id: string): Session {
		const job = this.options.store.get(taskId)?.jobs?.find(item => item.id === id && item.ssh);
		if (!job) throw new Error("SSH 会话不存在或不属于本任务");
		let session = this.sessions.get(id);
		if (!session) {
			session = { job, controller: new AbortController(), offset: 0, events: new EventEmitter(), redactor: new SecretRedactor(), busy: false };
			this.sessions.set(id, session);
		}
		return session;
	}

	private append(session: Session, text: string): void {
		if (session.fd === undefined || !text) return;
		try {
			const data = Buffer.from(text);
			let offset = 0;
			while (offset < data.length) { const count = writeSync(session.fd, data, offset); if (!count) throw new Error("Short SSH log write"); offset += count; }
			session.events.emit("change");
			this.options.onActivity(session.job.taskId);
		} catch { this.finish(session, "closed", "SSH log could not be saved; connection closed, remote outcome unknown."); }
	}

	private async read(session: Session, options: SshReadOptions, signal?: AbortSignal): Promise<SshResult> {
		const path = this.logPath(session.job.id);
		const wait = options.yieldTimeMs ?? 1000;
		if (session.job.status === "running" && statSync(path).size <= session.offset && wait > 0) {
			await new Promise<void>((resolve, reject) => {
				const done = () => { cleanup(); resolve(); };
				const abort = () => { cleanup(); reject(new Error("SSH wait cancelled")); };
				const timer = setTimeout(done, wait);
				const cleanup = () => { clearTimeout(timer); session.events.off("change", done); signal?.removeEventListener("abort", abort); };
				session.events.once("change", done);
				signal?.addEventListener("abort", abort, { once: true });
				if (signal?.aborted) abort();
			});
		}
		signal?.throwIfAborted();
		const fd = openSync(path, "r");
		let output: string;
		try {
			const buffer = Buffer.alloc((options.maxOutputChars ?? 6000) * 4);
			const size = readSync(fd, buffer, 0, buffer.length, session.offset);
			const decoded = new StringDecoder("utf8").write(buffer.subarray(0, size));
			output = [...decoded].slice(0, options.maxOutputChars ?? 6000).join("");
			session.offset += Buffer.byteLength(output);
		} finally { closeSync(fd); }
		const job = session.job;
		if (job.status === "running" && job.backgroundedAt === undefined) { job.backgroundedAt = Date.now(); this.options.store.recordJob(job, "job_backgrounded"); this.options.onBusyChange(); }
		if (job.status !== "running" && !job.ssh!.observed) { job.ssh!.observed = true; this.options.store.recordJob(job, "job_exited"); }
		return { sessionId: job.id, status: job.ssh!.status, output, hasMore: statSync(path).size > session.offset,
			...(job.exitCode !== undefined ? { exitCode: job.exitCode } : {}), ...(job.ssh!.exitSignal ? { exitSignal: job.ssh!.exitSignal } : {}),
			...(job.error ? { error: job.error } : {}), logPath: path };
	}

	private finish(session: Session, status: NonNullable<JobRecord["ssh"]>["status"], error?: string): void {
		if (session.job.status !== "running") return;
		session.job = { ...session.job, status: status === "exited" ? "exited" : "killed", endedAt: Date.now(), error,
			ssh: { ...session.job.ssh!, status } };
		session.flush?.();
		if (session.fd !== undefined) { closeSync(session.fd); session.fd = undefined; }
		session.client?.destroy();
		session.client = undefined;
		session.channel = undefined;
		session.flush = undefined;
		session.redactor = new SecretRedactor();
		this.options.store.recordJob(session.job, "job_exited");
		session.events.emit("change");
		this.options.onBusyChange();
		this.notify(session);
	}

	private close(session: Session, reason: JobRecord["reason"]): void {
		if (session.job.status !== "running") return;
		session.job.reason = reason;
		this.finish(session, "closed", "SSH connection closed; remote child processes may still be running.");
		session.controller.abort();
	}

	private notify(session: Session): void {
		const job = session.job;
		if (this.disposed || session.busy || job.status === "running" || !job.backgroundedAt || job.ssh!.observed || job.reason) return;
		this.options.onDone(job, this.completion(job));
	}

	private completion(job: JobRecord): string {
		return `SSH session ${job.id}: ${job.ssh!.status}${job.exitCode !== undefined ? `, exitCode=${job.exitCode}` : ""}${job.ssh!.exitSignal ? `, signal=${job.ssh!.exitSignal}` : ""}. Use ssh_write_stdin without input to read remaining output. Verify the task result; do not blindly repeat an uncertain command.`;
	}

	private logPath(id: string): string {
		if (!/^SSH-[a-f0-9-]{36}$/.test(id)) throw new Error("SSH 会话编号无效");
		return join(this.options.directory, `${id}.log`);
	}

	private limits(options: SshReadOptions): void {
		if (options.yieldTimeMs !== undefined && (!Number.isInteger(options.yieldTimeMs) || options.yieldTimeMs < 0 || options.yieldTimeMs > 30000)) throw new Error("yieldTimeMs 必须为 0–30000");
		if (options.maxOutputChars !== undefined && (!Number.isInteger(options.maxOutputChars) || options.maxOutputChars < 1 || options.maxOutputChars > 24000)) throw new Error("maxOutputChars 必须为 1–24000");
	}
}
