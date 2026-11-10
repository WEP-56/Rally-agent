import { ProcessShutdownGuard, type ShutdownGuard } from "./shutdown-guard.ts";

export const APPLICATION_SHUTDOWN_MS = 60000;

/** One exit path for quit and failed startup. The supervisor retains its lock until all writers stop. */
export class ApplicationShutdown {
	private pending?: Promise<void>;
	private finished = false;
	private failure = false;
	private preparation?: Promise<void>;
	private guard?: ShutdownGuard;
	private fallback?: ReturnType<typeof setTimeout>;
	private readonly options: {
		close(): Promise<void>;
		exit(code: number): void;
		report(error: unknown): void;
		guard?: ShutdownGuard;
		/** Test injection; production allows one minute for native cleanup and credential writes. */
		timeoutMs?: number;
	};
	constructor(options: ApplicationShutdown["options"]) { this.options = options; }
	get started(): boolean { return this.preparation !== undefined || this.pending !== undefined; }
	/** Arm before invoking cleanup that may synchronously block, including startup error cleanup. */
	prepare(): Promise<void> {
		if (this.preparation) return this.preparation;
		this.guard = this.options.guard ?? new ProcessShutdownGuard();
		const timeoutMs = this.options.timeoutMs ?? APPLICATION_SHUTDOWN_MS;
		this.fallback = setTimeout(() => {
			this.finished = true;
			this.options.report(new Error("APPLICATION_SHUTDOWN_TIMEOUT: forcing exit with recovery state retained"));
			this.options.exit(1);
		}, timeoutMs + 15000);
		this.preparation = Promise.resolve().then(() => this.guard!.arm(timeoutMs)).catch(error => { this.options.report(error); });
		return this.preparation;
	}
	run(failed = false): Promise<void> {
		this.failure ||= failed;
		return this.pending ??= this.close();
	}
	private async close(): Promise<void> {
		// If the helper cannot start or dies, still bound asynchronous shutdown. A blocked
		// main loop requires the independent helper; neither path releases the state lock early.
		await this.prepare();
		try {
			try { await this.options.close(); } catch (error) { this.failure = true; this.options.report(error); }
			try { await this.guard!.cancel(); } catch (error) { this.failure = true; this.options.report(error); }
			if (!this.finished) { this.finished = true; this.options.exit(this.failure ? 1 : 0); }
		} finally { clearTimeout(this.fallback); }
	}
}
