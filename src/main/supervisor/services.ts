import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeSync } from "node:fs";
import { createConnection } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import type { ServiceRecord, ServicesState } from "../../shared/services.ts";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { AuditLog } from "./audit.ts";
import type { EventLog } from "./event-log.ts";
import { shellCommand } from "./job-tools.ts";
import type { ProcessCommand } from "./process-host.ts";
import type { ProcessRegistry } from "./process-registry.ts";
import type { TaskStore } from "./task-store.ts";
import { ReadyPattern } from "./ready-pattern.ts";

export interface ServiceStart {
	name: string; command: string; cwd?: string; port?: number; readyPattern?: string; env?: Record<string, string>;
}
interface LiveService {
	record: ServiceRecord; controller: AbortController; done: Promise<void>; fd: number; output: string;
	pattern?: ReadyPattern; reason?: ServiceRecord["reason"]; timer?: ReturnType<typeof setInterval>; checking: boolean; explicitPort: boolean;
	ready: Promise<void>; resolveReady(): void;
}
interface ServiceOptions {
	store: TaskStore; processes: ProcessRegistry; events: EventLog; audit: AuditLog; directory: string;
	onChange(state: ServicesState): void; onUserStop(service: ServiceRecord): void; onError(error: unknown): void;
	/** Offline test overrides only. */
	readyMs?: number; stopGraceMs?: number;
}
const OUTPUT_LIMIT = 64 * 1024;

/** Services outlive task runs. Only explicit stop, app shutdown or crash recovery ends them. */
export class ServiceManager {
	private readonly options: ServiceOptions;
	private readonly live = new Map<string, LiveService>();
	private readonly stopping = new Map<string, Promise<{ stopped: true }>>();
	private readonly failures: unknown[] = [];
	private sequence = 0;
	private disposed = false;
	private disposal?: Promise<void>;
	constructor(options: ServiceOptions) {
		this.options = options;
		for (const item of this.state().services) this.sequence = Math.max(this.sequence, Number(item.id.slice(2)) || 0);
		if (existsSync(options.directory)) for (const file of readdirSync(options.directory)) this.sequence = Math.max(this.sequence, Number(/^S-(\d+)\.log$/.exec(file)?.[1]) || 0);
	}
	state(): ServicesState { return { services: this.options.store.list().flatMap(task => task.services ?? []).map(item => structuredClone(item)).sort((a, b) => b.startedAt - a.startedAt) }; }
	recover(): void {
		for (const service of this.state().services) if (service.status === "running") {
			this.options.store.recordService({ ...service, status: "stopped", ready: false, endedAt: Date.now(), reason: "interrupted" }, "service_stopped");
		}
		this.changed();
	}

	async start(task: Task, run: TaskRun, params: ServiceStart, signal?: AbortSignal, invocation?: ProcessCommand) {
		this.assertStart(task, run, signal);
		if (!params.name.trim() || !params.command.trim()) throw new Error("SERVICE_INVALID: name 和 command 不能为空");
		if (params.port !== undefined && (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535)) throw new Error("SERVICE_PORT_INVALID");
		if (params.readyPattern && params.readyPattern.length > 256) throw new Error("SERVICE_PATTERN_INVALID: readyPattern 最多 256 字符");
		if (params.readyPattern) new RegExp(params.readyPattern); // Syntax only; matching runs off the main thread.
		const cwd = params.cwd ? (isAbsolute(params.cwd) ? params.cwd : resolve(task.cwd, params.cwd)) : task.cwd;
		if (!statSync(cwd).isDirectory()) throw new Error("SERVICE_CWD_INVALID");
		if (params.port && await listening(params.port)) throw new Error("SERVICE_PORT_IN_USE: 指定端口已被占用");
		this.assertStart(task, run, signal);
		const command = invocation ?? shellCommand(process.platform === "win32" ? "powershell" : "bash", params.command, { ...task, cwd });
		command.env = { ...command.env, ...params.env };
		const record: ServiceRecord = { id: `S-${++this.sequence}`, taskId: task.id, runId: run.id, name: params.name, command: params.command, cwd, status: "running", ready: false, startedAt: Date.now(),
			...(params.port ? { port: params.port, url: `http://localhost:${params.port}` } : {}) };
		mkdirSync(this.options.directory, { recursive: true });
		const fd = openSync(this.logPath(record.id), "wx", 0o600);
		try { this.options.store.recordService(record, "service_started"); } catch (error) { closeSync(fd); throw error; }
		let resolveReady!: () => void;
		const ready = new Promise<void>(resolve => { resolveReady = resolve; });
		const active: LiveService = { record, fd, controller: new AbortController(), done: Promise.resolve(), output: "", ready, resolveReady, checking: false, explicitPort: params.port !== undefined };
		this.live.set(record.id, active);
		// Cancellation can prevent a not-yet-started service; an established service belongs to the host.
		const abort = () => { if (!active.record.pid) this.requestStop(active, "cancelled"); else active.resolveReady(); };
		signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
		active.done = this.options.processes.run(command, { kind: "service", taskId: task.id, serviceId: record.id }, {
			signal: active.controller.signal,
			onStarted: entry => {
				this.assertStart(task, run, signal);
				this.update(active, { pid: entry.pid });
			},
			onStdout: text => this.output(active, text), onStderr: text => this.output(active, text),
			abortGraceMs: () => this.options.stopGraceMs ?? 5000,
		}).then(code => this.finish(active, code), error => this.finish(active, undefined, error))
			.finally(async () => { clearInterval(active.timer); signal?.removeEventListener("abort", abort); closeSync(fd); this.live.delete(record.id); await active.pattern?.close(); });
		void active.done.catch(error => this.failure(error));
		if (params.readyPattern) {
			const updatePattern = (patch: Partial<ServiceRecord>) => {
				if (active.record.status !== "running" || active.controller.signal.aborted) return;
				try { this.update(active, patch); active.resolveReady(); }
				catch (error) { this.failure(error); this.requestStop(active, "cancelled"); }
			};
			try { active.pattern = new ReadyPattern(params.readyPattern, () => updatePattern({ ready: true }), error => updatePattern({ error: error.message })); }
			catch (error) { this.requestStop(active, "cancelled"); await active.done; throw error; }
		}
		active.timer = setInterval(() => { void this.checkReady(active).catch(error => { this.failure(error); this.requestStop(active, "cancelled"); }); }, 250);
		this.changed();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([active.ready, active.done, new Promise<void>(resolve => { timer = setTimeout(resolve, this.options.readyMs ?? 30000); })]);
			if (!active.record.pid) { this.requestStop(active, "cancelled"); await active.done; throw new Error(`SERVICE_START_FAILED: ${active.record.error ?? "未能启动进程"}`); }
			return { serviceId: record.id, pid: active.record.pid, ...this.status(task.id, record.id) };
		} finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
	}

	status(taskId: string, id: string, tail = 200) {
		if (!Number.isInteger(tail) || tail < 1 || tail > 2000) throw new Error("SERVICE_TAIL_INVALID: tail 必须为 1–2000 行");
		const record = this.require(id, taskId);
		const output = this.live.get(id)?.output ?? this.readOutput(id);
		return { status: record.status, ready: record.ready, port: record.port, url: record.url, exitCode: record.exitCode, error: record.error,
			output: output.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").slice(-tail).join("\n"), logPath: this.logPath(id) };
	}
	stop(id: string, source: "user" | "worker", taskId?: string): Promise<{ stopped: true }> {
		const service = this.require(id, source === "worker" ? taskId ?? "" : undefined);
		const pending = this.stopping.get(id); if (pending) return pending;
		if (service.status !== "running") return Promise.resolve({ stopped: true });
		const active = this.live.get(id); if (!active) return Promise.reject(new Error("SERVICE_STATE_UNKNOWN: 等待恢复核验"));
		this.options.audit.append("stop", { target: "service", source, taskId: service.taskId, serviceId: id, stage: "requested" });
		this.options.events.append("stop", { target: "service", source, taskId: service.taskId, serviceId: id });
		this.requestStop(active, source);
		const stopped = active.done.then(() => {
			if (source === "user") this.options.onUserStop(active.record);
			return { stopped: true as const };
		}).finally(() => this.stopping.delete(id));
		this.stopping.set(id, stopped); return stopped;
	}
	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		for (const active of this.live.values()) this.requestStop(active, "shutdown");
		this.disposal = Promise.allSettled([...this.live.values()].map(active => active.done)).then(() => {
			if (this.failures.length) throw new AggregateError(this.failures, "SERVICES_SHUTDOWN_FAILED");
		}); return this.disposal;
	}
	private assertStart(task: Task, run: TaskRun, signal?: AbortSignal): void {
		signal?.throwIfAborted();
		if (this.disposed || task.ended || run.endedAt) throw new Error("TASK_ENDED: 不能启动服务");
		if (this.failures.length) throw new Error("SERVICE_STATE_UNAVAILABLE: 请重启恢复");
	}
	private require(id: string, taskId?: string): ServiceRecord {
		const service = this.options.store.list().flatMap(task => task.services ?? []).find(item => item.id === id && (taskId === undefined || item.taskId === taskId));
		if (!service || !/^S-\d+$/.test(id)) throw new Error("SERVICE_NOT_FOUND: 服务不存在或不属于本任务");
		return service;
	}
	private requestStop(active: LiveService, reason: ServiceRecord["reason"]): void { active.reason ??= reason; active.controller.abort(); }
	private update(active: LiveService, patch: Partial<ServiceRecord>): void {
		const record = { ...active.record, ...patch };
		this.options.store.recordService(record, "service_updated"); active.record = record;
		if (record.ready) { clearInterval(active.timer); void active.pattern?.close(); }
		this.changed();
	}
	private output(active: LiveService, text: string): void {
		const chunk = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
		const buffer = Buffer.from(chunk); let offset = 0;
		while (offset < buffer.length) { const written = writeSync(active.fd, buffer, offset); if (!written) throw new Error("SERVICE_LOG_WRITE_FAILED"); offset += written; }
		active.output = (active.output + chunk).slice(-OUTPUT_LIMIT);
		if (!active.explicitPort && (!active.record.ready || !active.record.port)) {
			const match = /(?:(https?):\/\/)?(localhost|127\.0\.0\.1):(\d{1,5})(?=[\s/\u001b]|$)/.exec(active.output);
			const port = Number(match?.[3]);
			if (port > 0 && port <= 65535 && active.record.port !== port) this.update(active, { port, url: `${match?.[1] ?? "http"}://${match?.[2]}:${port}` });
		}
		if (!active.record.ready && active.record.pid && !active.controller.signal.aborted) active.pattern?.test(active.output);
	}
	private async checkReady(active: LiveService): Promise<void> {
		if (active.checking || active.record.status !== "running" || active.controller.signal.aborted || !active.record.pid || active.record.ready || !active.record.port) return;
		active.checking = true;
		try {
			if (await listening(active.record.port) && !this.disposed && this.live.has(active.record.id) && active.record.status === "running" && !active.controller.signal.aborted) { this.update(active, { ready: true }); active.resolveReady(); }
		} finally { active.checking = false; }
	}
	private finish(active: LiveService, code?: number, error?: unknown): void {
		if (this.options.processes.failed) throw new Error("SERVICE_CLEANUP_FAILED: 保留服务恢复记录", { cause: error });
		fsyncSync(active.fd);
		const stopped = active.controller.signal.aborted;
		const record: ServiceRecord = { ...active.record, status: stopped ? "stopped" : "exited", ready: false, endedAt: Date.now(), exitCode: stopped ? 130 : code ?? 1, reason: active.reason,
			...(!stopped && error ? { error: String(error) } : {}) };
		this.options.store.recordService(record, stopped ? "service_stopped" : "service_exited"); active.record = record; this.changed();
	}
	private failure(error: unknown): void { this.failures.push(error); this.options.onError(error); }
	private changed(): void { this.options.onChange(this.state()); }
	private logPath(id: string): string { return join(this.options.directory, `${id}.log`); }
	private readOutput(id: string): string {
		const file = this.logPath(id); if (!existsSync(file)) return "（服务日志缺失）";
		const size = statSync(file).size; const start = Math.max(0, size - OUTPUT_LIMIT); const buffer = Buffer.alloc(size - start); const fd = openSync(file, "r");
		try { const count = readSync(fd, buffer, 0, buffer.length, start); const text = buffer.subarray(0, count).toString("utf8"); return start ? text.slice(text.indexOf("\n") + 1) : text; }
		finally { closeSync(fd); }
	}
}

async function listening(port: number): Promise<boolean> {
	const results = await Promise.all(["127.0.0.1", "::1"].map(host => new Promise<boolean>(resolve => {
		const socket = createConnection({ host, port });
		const done = (open: boolean) => { socket.destroy(); resolve(open); };
		socket.setTimeout(200); socket.once("connect", () => done(true)); socket.once("timeout", () => done(false)); socket.once("error", () => done(false));
	})));
	return results.some(Boolean);
}
