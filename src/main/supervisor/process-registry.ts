import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessCommand, ProcessCompletion, ProcessStarted } from "./process-host.ts";
import { processIdentity, stopProcessTree, type ProcessIdentity, type ProcessStopResult } from "./process-identity.ts";

export interface OwnedProcess extends ProcessIdentity { id: string; kind: "git" | "github" | "job" | "service" | "mcp" | "search" | "config"; taskId?: string; jobId?: string; serviceId?: string }
export type ProcessOwner = Pick<OwnedProcess, "kind" | "taskId" | "jobId" | "serviceId">;
export interface ProcessRunOptions {
	signal?: AbortSignal;
	onStdout(data: string): void;
	onStderr(data: string): void;
	/** Runs after durable registration and before the command is sent to the host. */
	onStarted?(entry: OwnedProcess): void;
	/** Command has spawned; interactive writes use the native pipe and await its backpressure. */
	onReady?(input: ProcessInput): void;
	/** Explicit command timeouts may bypass the ordinary five-second cancellation grace. */
	abortGraceMs?(): number;
}
export interface ProcessInput { write(data: string | Uint8Array): Promise<void>; end(): void }
export interface ManagedProcess { ready: Promise<ProcessInput>; exited: Promise<number>; close(): void }
export interface ProcessRegistryOptions {
	assertWritable(): void;
	onStopped?(entry: OwnedProcess, reason: "recovery" | "completed" | "cancelled" | "error", result: ProcessStopResult): void;
	/** Test injection only; normal cancellation always gives the tree five seconds. */
	graceMs?: number;
	hostPath?: string;
}

/** Sole writer under StateDirectoryLock. Registry entries contain no command, env or credentials. */
export class ProcessRegistry {
	readonly file: string;
	private readonly entries = new Map<string, OwnedProcess>();
	private readonly running = new Map<Promise<number>, AbortController>();
	private recovery?: Promise<void>;
	private disposal?: Promise<void>;
	private disposed = false;
	private readonly failures: unknown[] = [];
	private readonly options: ProcessRegistryOptions;
	get failed(): boolean { return this.failures.length > 0; }

	constructor(directory: string, options: ProcessRegistryOptions) {
		this.file = join(directory, "processes.json"); this.options = options;
		options.assertWritable();
		if (!existsSync(this.file)) return;
		let content: unknown;
		try { content = JSON.parse(readFileSync(this.file, "utf8")); }
		catch (error) { throw new Error("PROCESS_REGISTRY_INVALID: 进程登记文件无法读取，原文件已保留", { cause: error }); }
		if (!content || typeof content !== "object" || !("version" in content) || content.version !== 1 || !("processes" in content) || !Array.isArray(content.processes)) throw new Error("PROCESS_REGISTRY_INVALID: 进程登记文件无效，原文件已保留");
		for (const entry of content.processes) {
			if (!validEntry(entry) || this.entries.has(entry.id)) throw new Error("PROCESS_REGISTRY_INVALID: 进程身份无效，原文件已保留");
			this.entries.set(entry.id, entry);
		}
	}

	recover(): Promise<void> {
		return this.recovery ??= this.recoverEntries();
	}

	private async recoverEntries(): Promise<void> {
		const results = await Promise.allSettled([...this.entries.values()].map(entry => this.stop(entry, "recovery")));
		const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
		if (errors.length) { this.failures.push(...errors); throw new AggregateError(errors, "PROCESS_RECOVERY_FAILED: 孤儿进程清理未完成"); }
	}

	run(command: ProcessCommand, owner: ProcessOwner, options: ProcessRunOptions): Promise<number> {
		if (this.disposed) return Promise.reject(new Error("PROCESS_REGISTRY_CLOSED"));
		if (this.failures.length) return Promise.reject(new Error("PROCESS_REGISTRY_FAILED: 上次进程清理失败，不能继续启动命令"));
		const controller = new AbortController();
		const abort = () => controller.abort();
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) controller.abort();
		const pending = this.execute(command, owner, options, controller.signal);
		this.running.set(pending, controller);
		void pending.finally(() => { this.running.delete(pending); options.signal?.removeEventListener("abort", abort); }).catch(() => {});
		return pending;
	}

	open(command: ProcessCommand, owner: ProcessOwner, options: ProcessRunOptions): ManagedProcess {
		const controller = new AbortController();
		let resolve!: (input: ProcessInput) => void; let reject!: (error: unknown) => void;
		const ready = new Promise<ProcessInput>((yes, no) => { resolve = yes; reject = no; });
		const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
		const exited = this.run({ ...command, interactive: true }, owner, { ...options, signal, onReady: resolve });
		void exited.then(() => reject(new Error("PROCESS_EXITED_BEFORE_READY")), reject);
		return { ready, exited, close: () => controller.abort() };
	}

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		for (const controller of this.running.values()) controller.abort();
		this.disposal = (async () => {
			// Expected cancelled commands reject; stop/storage failures are tracked separately.
			await Promise.allSettled([this.recover(), ...this.running.keys()]);
			if (this.failures.length) throw new AggregateError(this.failures, "PROCESS_SHUTDOWN_FAILED: 进程清理失败，保留登记及状态锁");
		})();
		return this.disposal;
	}

	private async execute(command: ProcessCommand, owner: ProcessOwner, options: ProcessRunOptions, signal: AbortSignal): Promise<number> {
		await this.recover(); signal.throwIfAborted(); this.options.assertWritable();
		const hostPath = this.options.hostPath ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./process-host.ts" : "./process-host.js", import.meta.url));
		// The helper only needs the runtime/system environment. Credentials go to the command via IPC.
		const env = Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
		// Detach the root on Windows too: libuv's parent job otherwise kills the host
		// on a crash while native grandchildren may survive and lose their root identity.
		const child = spawn(process.execPath, [hostPath], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, detached: true, stdio: [command.interactive ? "pipe" : "ignore", "pipe", "pipe", "ipc"] });
		let executionError: unknown;
		let registered = false;
		let entry: OwnedProcess | undefined;
		let outcome: ProcessCompletion | undefined;
		let complete!: (result: ProcessCompletion) => void;
		const completed = new Promise<ProcessCompletion>(resolve => { complete = resolve; });
		const cancel = () => complete({ type: "completed", exitCode: 130 });
		const fail = (error: unknown) => { executionError ??= error; cancel(); };
		const closed = new Promise<void>(resolve => child.once("close", () => { if (!outcome) fail(new Error("PROCESS_HOST_EXITED")); resolve(); }));
		child.on("error", fail);
		child.on("message", (message: ProcessCompletion | ProcessStarted) => {
			if (message?.type === "completed") { outcome = message; complete(message); }
			if (message?.type === "started") {
				try { options.onReady?.({
					write: data => new Promise<void>((resolve, reject) => {
						if (signal.aborted || !child.stdin?.writable) { reject(new Error("PROCESS_INPUT_CLOSED")); return; }
						child.stdin.write(data, error => error ? reject(error) : resolve());
					}),
					end: () => { child.stdin?.end(); },
				}); } catch (error) { fail(error); }
			}
		});
		child.stdin?.on("error", fail);
		child.stdout!.setEncoding("utf8"); child.stderr!.setEncoding("utf8");
		child.stdout!.on("data", (data: string) => { try { options.onStdout(data); } catch (error) { fail(error); } });
		child.stderr!.on("data", (data: string) => { try { options.onStderr(data); } catch (error) { fail(error); } });
		signal.addEventListener("abort", cancel, { once: true });
		try {
			if (!child.pid) throw new Error("PROCESS_HOST_START_FAILED");
			const identity = await processIdentity(child.pid);
			if (!identity) throw new Error("PROCESS_HOST_EXITED");
			entry = { ...identity, id: randomUUID(), ...owner };
			this.entries.set(entry.id, entry);
			try { this.save(); registered = true; } catch (error) { this.entries.delete(entry.id); throw error; }
			signal.throwIfAborted(); if (executionError) throw executionError;
			options.onStarted?.(entry);
			signal.throwIfAborted();
			child.send(command, error => { if (error) fail(error); });
			const result = await completed;
			if (result.error) throw new Error(`PROCESS_EXEC_FAILED: ${result.error}`);
			if (signal.aborted) throw new Error("PROCESS_ABORTED: 调用已取消");
			if (executionError) throw executionError;
			return result.exitCode;
		} finally {
			signal.removeEventListener("abort", cancel);
			try {
				if (entry) {
					const reason = signal.aborted ? "cancelled" : outcome ? "completed" : "error";
					if (registered) await this.stop(entry, reason, signal.aborted ? options.abortGraceMs?.() : undefined);
					else await stopProcessTree(entry, 0);
				} else { child.kill("SIGKILL"); }
				await closed;
			} catch (error) { this.failures.push(error); throw error; }
			if (executionError && outcome) throw executionError;
		}
	}

	private async stop(entry: OwnedProcess, reason: "recovery" | "completed" | "cancelled" | "error", graceMs?: number): Promise<void> {
		this.options.assertWritable();
		const result = await stopProcessTree(entry, reason === "completed" ? 0 : graceMs ?? this.options.graceMs ?? 5000);
		// Keep the registry until the termination fact is committed. Repeating cleanup is safe.
		this.options.onStopped?.(entry, reason, result);
		this.entries.delete(entry.id);
		try { this.save(); } catch (error) { this.entries.set(entry.id, entry); throw error; }
	}

	private save(): void {
		this.options.assertWritable(); mkdirSync(dirname(this.file), { recursive: true });
		const temporary = `${this.file}.${randomUUID()}.tmp`; let fd: number | undefined;
		try {
			fd = openSync(temporary, "wx", 0o600);
			writeFileSync(fd, JSON.stringify({ version: 1, processes: [...this.entries.values()] })); fsyncSync(fd); closeSync(fd); fd = undefined;
			renameSync(temporary, this.file);
		} finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
	}
}

function validEntry(entry: unknown): entry is OwnedProcess {
	if (!entry || typeof entry !== "object") return false;
	const item = entry as Partial<OwnedProcess>;
	return typeof item.id === "string" && /^[a-f0-9-]{36}$/.test(item.id) && Number.isSafeInteger(item.pid) && item.pid! > 0
		&& typeof item.created === "string" && /^(?:win:\d+|linux:[a-f0-9-]+:\d+)$/.test(item.created)
		&& ["git", "github", "job", "service", "mcp", "search", "config"].includes(item.kind ?? "") && (item.taskId === undefined || typeof item.taskId === "string")
		&& (item.jobId === undefined || (typeof item.jobId === "string" && /^J-\d+$/.test(item.jobId)))
		&& (item.serviceId === undefined || (typeof item.serviceId === "string" && /^S-\d+$/.test(item.serviceId)));
}
