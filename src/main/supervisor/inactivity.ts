import type { InactivityState } from "../../shared/ipc.ts";
import type { EventLog } from "./event-log.ts";

export const INACTIVITY_TIMEOUT = 72 * 60 * 60 * 1000;
export const INACTIVITY_MESSAGE = "闲置保护已暂停 Agent 活动，请发送一条消息恢复。";

interface InactivityOptions {
	now?(): number;
	pause(): Promise<void>;
	changed(): void;
}

/** Host admission control. Only genuine user input resets this durable clock. */
export class InactivityProtection {
	private readonly events: EventLog;
	private readonly options: InactivityOptions;
	private readonly now: () => number;
	private lastUserAt: number;
	private pausedAt?: number;
	private stopping?: Promise<void>;
	private timer?: ReturnType<typeof setInterval>;
	private started = false;
	private disposed = false;

	constructor(events: EventLog, options: InactivityOptions) {
		this.events = events;
		this.options = options;
		this.now = options.now ?? Date.now;
		const saved = events.ofKind("inactivity_changed").at(-1)?.data;
		const lastUser = events.ofKind("chat_message").findLast(event => event.data.role === "user");
		this.lastUserAt = typeof saved?.lastUserAt === "number" ? saved.lastUserAt
			: lastUser ? Number(lastUser.data.at ?? lastUser.at) : this.now();
		this.pausedAt = typeof saved?.pausedAt === "number" ? saved.pausedAt : undefined;
		if (!saved) this.save(); // A fresh installation must not reset its clock on every restart.
	}

	state(): InactivityState { return { lastUserAt: this.lastUserAt, pausedAt: this.pausedAt }; }

	async start(): Promise<void> {
		if (this.started || this.disposed) return;
		this.started = true;
		if (this.pausedAt !== undefined) this.stopActivities();
		this.check();
		// Also catches wall-clock changes and machines resuming from sleep.
		this.timer = setInterval(() => this.check(), 1000);
		this.timer.unref();
		await this.stopping;
	}

	canRun(): boolean {
		this.check();
		return this.started && !this.disposed && this.pausedAt === undefined;
	}

	check(): void {
		if (!this.started || this.disposed || this.pausedAt !== undefined || this.now() - this.lastUserAt < INACTIVITY_TIMEOUT) return;
		// Close admission synchronously, before aborting sessions can trigger callbacks.
		this.pausedAt = this.now();
		this.stopActivities();
		this.save();
		this.options.changed();
	}

	/** Await cleanup before reopening admission; a cleanup failure leaves protection engaged. */
	async userMessage(): Promise<boolean> {
		if (this.disposed) return false;
		this.check();
		await this.stopping;
		if (this.disposed) return false;
		const resumed = this.pausedAt !== undefined;
		this.lastUserAt = this.now();
		this.pausedAt = undefined;
		this.save();
		if (resumed) this.options.changed();
		return resumed;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		clearInterval(this.timer);
		await this.stopping;
	}

	private stopActivities(): void {
		// Defer cleanup so a provider/tool admission check can unwind first.
		this.stopping = Promise.resolve().then(() => this.options.pause());
		void this.stopping.catch(error => console.error("Rally inactivity cleanup failed", error));
	}

	private save(): void { this.events.append("inactivity_changed", { ...this.state() }); }
}
