import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { JobRecord } from "../../shared/jobs.ts";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { ProcessCommand } from "./process-host.ts";
import type { ProcessRegistry } from "./process-registry.ts";
import type { TaskStore } from "./task-store.ts";

const OUTPUT_LIMIT = 64 * 1024;
export interface JobOutput { status: JobRecord["status"]; exitCode?: number; output: string; durationMs: number; logPath: string; error?: string }
interface RunningJob {
	record: JobRecord;
	controller: AbortController;
	done: Promise<JobRecord>;
	buffer: string;
	fd: number;
	timeout?: ReturnType<typeof setTimeout>;
	reason?: JobRecord["reason"];
}
export interface JobsOptions {
	store: TaskStore;
	processes: ProcessRegistry;
	directory: string;
	settingsFile: string;
	/** Runtime overrides are for offline tests; production reads jobs.foregroundSeconds. */
	foregroundSeconds?: number;
	stopGraceMs?: number;
	onDone(job: JobRecord, text: string): void;
	onBusyChange(): void;
	onActivity?(taskId: string): void;
	onError(error: unknown): void;
}

export class JobManager {
	private readonly options: JobsOptions;
	private readonly running = new Map<string, RunningJob>();
	private readonly taskStops = new Map<string, Promise<number>>();
	private readonly failures: unknown[] = [];
	private sequence = 0;
	private disposed = false;
	private disposal?: Promise<void>;
	constructor(options: JobsOptions) {
		this.options = options;
		for (const task of options.store.list()) for (const job of task.jobs ?? []) this.sequence = Math.max(this.sequence, Number(job.id.slice(2)) || 0);
		// A crash between creating the log and committing job_started must not reuse its ID.
		if (existsSync(options.directory)) for (const file of readdirSync(options.directory)) this.sequence = Math.max(this.sequence, Number(/^J-(\d+)\.log$/.exec(file)?.[1]) || 0);
	}

	/** Call only after the registry has finished orphan cleanup, before scheduling. */
	recover(): void {
		for (const task of this.options.store.list()) for (const job of task.jobs ?? []) {
			if (job.status === "running") this.options.store.recordJob({ ...job, status: "killed", endedAt: Date.now(), reason: "interrupted" }, "job_exited");
			else if (job.backgroundedAt && job.reason !== "task_ended" && job.reason !== "shutdown" && job.reason !== "interrupted") this.options.store.jobDone(job, this.completionText(job));
		}
	}

	activeTaskIds(): string[] {
		return this.options.store.list().filter(task => !task.ended && task.jobs?.some(job => job.status === "running" && task.runs.some(run => run.id === job.runId && !run.endedAt))).map(task => task.id);
	}

	hasRunning(taskId: string): boolean { return this.activeTaskIds().includes(taskId); }

	hasBackground(taskId: string): boolean {
		const task = this.options.store.get(taskId);
		return Boolean(task && !task.ended && task.jobs?.some(job => job.status === "running" && job.backgroundedAt !== undefined && task.runs.some(run => run.id === job.runId && !run.endedAt)));
	}

	async execute(task: Task, run: TaskRun, shell: JobRecord["shell"], command: string, invocation: ProcessCommand, timeout?: number, signal?: AbortSignal) {
		if (this.disposed || task.ended || run.endedAt) throw new Error("TASK_ENDED: 任务或运行已结束");
		if (this.failures.length) throw new Error("JOB_STATE_UNAVAILABLE: 上次作业收尾失败，请重启恢复");
		signal?.throwIfAborted();
		if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483)) throw new Error("JOB_TIMEOUT_INVALID: timeout 必须是正秒数，且不超过 2147483");
		const foregroundSeconds = this.foregroundSeconds();
		const record: JobRecord = { id: `J-${++this.sequence}`, taskId: task.id, runId: run.id, shell, command, cwd: task.cwd, status: "running", startedAt: Date.now() };
		mkdirSync(this.options.directory, { recursive: true });
		const fd = openSync(this.logPath(record.id), "wx", 0o600);
		try { this.options.store.recordJob(record, "job_started"); } catch (error) { closeSync(fd); throw error; }
		const active: RunningJob = { record, controller: new AbortController(), done: Promise.resolve(record), buffer: "", fd };
		this.running.set(record.id, active);
		const abort = () => this.stop(active, "cancelled");
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		if (timeout) active.timeout = setTimeout(() => this.stop(active, "timeout"), timeout * 1000);
		const output = (text: string) => {
			// Keep a bounded in-memory tail and the full UTF-8 log on disk.
			const chunk = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
			const data = Buffer.from(chunk); let offset = 0;
			while (offset < data.length) { const written = writeSync(fd, data, offset); if (!written) throw new Error("JOB_LOG_WRITE_FAILED"); offset += written; }
			active.buffer = (active.buffer + chunk).slice(-OUTPUT_LIMIT);
			if (chunk) this.options.onActivity?.(task.id);
		};
		active.done = this.options.processes.run(invocation, { kind: "job", taskId: task.id, jobId: record.id }, {
			signal: active.controller.signal, onStdout: output, onStderr: output,
			abortGraceMs: () => active.reason === "timeout" ? 0 : this.options.stopGraceMs ?? 5000,
		}).then(code => this.finish(active, code), error => this.finish(active, undefined, error))
			.finally(() => { clearTimeout(active.timeout); closeSync(fd); this.running.delete(record.id); });
		void active.done.catch(error => { this.failures.push(error); this.options.onError(error); });
		this.options.onBusyChange();
		let foregroundTimer: ReturnType<typeof setTimeout> | undefined;
		try {
			const completed = await Promise.race([active.done.then(() => true), new Promise<false>(resolve => { foregroundTimer = setTimeout(() => resolve(false), foregroundSeconds * 1000); })]);
			if (completed || active.record.status !== "running" || active.controller.signal.aborted) {
				await active.done;
				const result = this.output(task.id, record.id);
				return { exitCode: result.exitCode ?? 130, output: result.output, durationMs: result.durationMs, logPath: result.logPath, ...(result.error ? { error: result.error } : {}) };
			}
			// Tool cancellation ceases to own this process as soon as it becomes a job.
			signal?.removeEventListener("abort", abort);
			const background = { ...active.record, backgroundedAt: Date.now() };
			this.options.store.recordJob(background, "job_backgrounded");
			active.record = background;
			this.options.onBusyChange();
			return { jobId: record.id, background: true as const, output: this.tail(active.buffer, 200), logPath: this.logPath(record.id), note: `已转为后台作业 ${record.id}，结束后会通知你；继续其他工作或结束本轮，不要轮询。` };
		} catch (error) { this.stop(active, "cancelled"); await active.done.catch(() => {}); throw error; }
		finally { clearTimeout(foregroundTimer); signal?.removeEventListener("abort", abort); }
	}

	output(taskId: string, jobId: string, tail = 200): JobOutput {
		if (!Number.isInteger(tail) || tail < 1 || tail > 2000) throw new Error("JOB_TAIL_INVALID: tail 必须为 1–2000 行");
		const job = this.require(taskId, jobId);
		const buffer = this.running.get(jobId)?.buffer ?? this.readTail(jobId);
		return { status: job.status, exitCode: job.exitCode, output: this.tail(buffer, tail), durationMs: Math.max(0, (job.endedAt ?? Date.now()) - job.startedAt), logPath: this.logPath(jobId), ...(job.error ? { error: job.error } : {}) };
	}

	async kill(taskId: string, jobId: string): Promise<{ killed: true }> {
		const job = this.require(taskId, jobId); const active = this.running.get(jobId);
		if (active) { this.stop(active, "cancelled"); await active.done; }
		else if (job.status === "running") throw new Error("JOB_STATE_UNKNOWN: 作业状态待恢复核对");
		return { killed: true };
	}

	killTask(taskId: string): Promise<number> {
		const pending = this.taskStops.get(taskId); if (pending) return pending;
		const jobs = [...this.running.values()].filter(job => job.record.taskId === taskId && job.record.status === "running");
		for (const job of jobs) this.stop(job, "task_ended");
		const stopped = Promise.allSettled(jobs.map(job => job.done)).then(results => {
			const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
			if (errors.length) throw new AggregateError(errors, "JOB_STOP_FAILED");
			return jobs.filter(job => job.record.status === "killed").length;
		}).finally(() => this.taskStops.delete(taskId));
		this.taskStops.set(taskId, stopped);
		return stopped;
	}

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		for (const job of this.running.values()) this.stop(job, "shutdown");
		this.disposal = Promise.allSettled([...this.running.values()].map(job => job.done)).then(() => {
			if (this.failures.length) throw new AggregateError(this.failures, "JOBS_SHUTDOWN_FAILED");
		});
		return this.disposal;
	}

	private stop(job: RunningJob, reason: NonNullable<JobRecord["reason"]>): void {
		if (job.record.status !== "running") return;
		job.reason ??= reason; job.controller.abort();
	}

	private finish(active: RunningJob, exitCode?: number, error?: unknown): JobRecord {
		clearTimeout(active.timeout);
		if (this.options.processes.failed) throw new Error("JOB_CLEANUP_FAILED: 进程清理未确认，保留作业恢复记录", { cause: error });
		fsyncSync(active.fd);
		const killed = active.controller.signal.aborted;
		const job: JobRecord = { ...active.record, status: killed ? "killed" : "exited", endedAt: Date.now(), exitCode: killed ? active.reason === "timeout" ? 124 : 130 : exitCode ?? 1, reason: active.reason,
			...(!killed && error ? { error: String(error) } : {}) };
		this.options.store.recordJob(job, "job_exited");
		active.record = job;
		if (job.backgroundedAt && !this.disposed && job.reason !== "task_ended" && job.reason !== "shutdown") this.options.onDone(job, this.completionText(job));
		this.options.onBusyChange();
		return job;
	}

	private require(taskId: string, jobId: string): JobRecord {
		const job = this.options.store.get(taskId)?.jobs?.find(item => item.id === jobId);
		if (!job || !/^J-\d+$/.test(jobId)) throw new Error("JOB_NOT_FOUND: 作业不存在或不属于本任务");
		return job;
	}
	private logPath(id: string): string { return join(this.options.directory, `${id}.log`); }
	private tail(text: string, lines: number): string { return text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").slice(-lines).join("\n"); }
	private readTail(id: string): string {
		const file = this.logPath(id); if (!existsSync(file)) return "（作业日志缺失）";
		const size = statSync(file).size; const offset = Math.max(0, size - OUTPUT_LIMIT); const buffer = Buffer.alloc(size - offset); const fd = openSync(file, "r");
		try { const bytes = readSync(fd, buffer, 0, buffer.length, offset); const text = buffer.subarray(0, bytes).toString("utf8"); return offset ? text.slice(text.indexOf("\n") + 1) : text; }
		finally { closeSync(fd); }
	}
	private completionText(job: JobRecord): string {
		const result = this.output(job.taskId, job.id);
		return `<rally-job id="${job.id}" exit="${job.exitCode ?? "unknown"}" duration="${result.durationMs}ms">\nCommand: ${JSON.stringify(job.command)}\nStatus: ${job.status}${job.reason ? ` (${job.reason})` : ""}\nLast 200 lines of output (bounded; full log: ${result.logPath}):\n${result.output}${job.error ? `\nError: ${job.error}` : ""}\n</rally-job>`;
	}
	private foregroundSeconds(): number {
		if (this.options.foregroundSeconds !== undefined) return this.options.foregroundSeconds;
		if (!existsSync(this.options.settingsFile)) return 30;
		const settings: unknown = JSON.parse(readFileSync(this.options.settingsFile, "utf8").replace(/^\uFEFF/, ""));
		if (!settings || typeof settings !== "object" || !("jobs" in settings)) return 30;
		const jobs = settings.jobs;
		if (!jobs || typeof jobs !== "object" || !("foregroundSeconds" in jobs)) return 30;
		const value = jobs.foregroundSeconds;
		if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 3600) throw new Error("JOB_SETTINGS_INVALID: jobs.foregroundSeconds 必须在 0–3600 秒之间");
		return value;
	}
}
