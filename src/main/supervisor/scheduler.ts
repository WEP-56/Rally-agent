// Slot scheduler: approval + dependencies + capacity, no locks (docs 04 §3).
// It only decides when a run starts; all task facts are written through TaskStore.

import type { QueueReason, Task, TaskRun } from "../../shared/task.ts";
import type { EventLog } from "./event-log.ts";
import type { TaskStore } from "./task-store.ts";

export interface SchedulerOptions {
	store: TaskStore;
	events: EventLog;
	limit?: number;
	/** Slots already occupied by streaming workers (docs 04 §3.2). */
	activeIds(): string[];
	/** Idle workers must acquire a slot before consuming pending input. */
	wakePending(available: number): void;
	start(task: Task, run: TaskRun): Promise<void>;
	/** Wake the main agent once when a dependency fails (docs 01 §4.8). */
	onDependencyFailed(task: Task, upstreamId: string): void;
}

export class Scheduler {
	readonly limit: number;
	private readonly options: SchedulerOptions;
	private readonly reserved = new Set<string>();
	private ticking = false;
	private rerun = false;
	private readonly queued = new Map<string, QueueReason>();
	private readonly dependencyNotified = new Set<string>();
	private lastCapacity = "";
	private disposed = false;

	constructor(options: SchedulerOptions) {
		this.options = options;
		this.limit = options.limit ?? 2;
	}

	/** Re-evaluate every open task. Safe to call from anywhere; overlapping calls collapse. */
	tick(): void {
		if (this.disposed) return;
		if (this.ticking) {
			this.rerun = true;
			return;
		}
		this.ticking = true;
		try {
			this.run();
		} finally {
			this.ticking = false;
		}
		if (this.rerun) {
			this.rerun = false;
			this.tick();
		}
	}

	dispose(): void {
		this.disposed = true;
	}

	private run(): void {
		const { store, events } = this.options;
		const open = store
			.list()
			.filter((task) => !task.ended && task.approval.state === "approved")
			.sort((a, b) => a.createdAt - b.createdAt);
		const openIds = new Set(open.map((task) => task.id));
		for (const id of [...this.queued.keys()]) if (!openIds.has(id)) this.queued.delete(id);

		let active = new Set([...this.options.activeIds(), ...this.reserved]).size;
		this.options.wakePending(Math.max(0, this.limit - active));
		active = new Set([...this.options.activeIds(), ...this.reserved]).size;
		for (const task of open) {
			const lastRun = task.runs[task.runs.length - 1];
			const interruptedAt = lastRun?.endReason === "interrupted" ? lastRun.endedAt : undefined;
			// An interrupted run waits for the user's decision: resume or cancel (docs 01 §4.9).
			if (interruptedAt && !task.inputs.some((input) => input.kind === "resume" && !input.deliveredAt && input.at >= interruptedAt)) continue;
			if (task.runs.some((run) => !run.endedAt)) {
				// A run is already open (running, or idle after blocked): it holds no new slot.
				if (task.queue?.reason !== "capacity" || this.options.activeIds().includes(task.id)) this.setQueue(task, null);
				continue;
			}
			const dependency = this.dependencyReason(task);
			if (dependency) {
				this.setQueue(task, dependency.reason, dependency.holder);
				if (
					dependency.reason === "dependency_failed" &&
					dependency.holder &&
					!this.dependencyNotified.has(task.id)
				) {
					this.dependencyNotified.add(task.id);
					this.options.onDependencyFailed(task, dependency.holder);
				}
				continue;
			}
			this.dependencyNotified.delete(task.id);
			if (active >= this.limit) {
				this.setQueue(task, "capacity");
				continue;
			}
			this.setQueue(task, null);
			const trigger: TaskRun["trigger"] = task.runs.length === 0 ? "dispatch" : "resume";
			const run = store.startRun(task.id, trigger, "task-agent");
			this.reserved.add(task.id);
			active++;
			events.append("capacity", { active, limit: this.limit, waiting: this.waitingCount() });
			void this.options.start(task, run).finally(() => {
				this.reserved.delete(task.id);
				this.tick();
			});
		}
		this.capacityEvent(active);
	}

	/** Facts that block a first run; a resume skips dependency checks (docs 01 §4.6). */
	private dependencyReason(task: Task): { reason: QueueReason; holder?: string } | null {
		if (task.runs.length > 0) return null;
		const { store } = this.options;
		let failedId: string | undefined;
		let waitingId: string | undefined;
		for (const id of task.dependsOn) {
			const upstream = store.get(id);
			if (!upstream) {
				failedId ??= id;
				continue;
			}
			if (upstream.ended) {
				if (upstream.ended.outcome !== "done") failedId ??= id;
			} else {
				waitingId ??= id;
			}
		}
		if (failedId) return { reason: "dependency_failed", holder: failedId };
		if (waitingId) return { reason: "dependency", holder: waitingId };
		return null;
	}

	private setQueue(task: Task, reason: QueueReason | null, holder?: string): void {
		const before = this.queued.get(task.id);
		this.options.store.setQueue(task.id, reason, holder);
		if (!reason) {
			this.queued.delete(task.id);
			return;
		}
		this.queued.set(task.id, reason);
		if (before !== reason) {
			this.options.events.append("waiting", { taskId: task.id, reason, holder });
		}
	}

	private waitingCount(): number {
		let count = 0;
		for (const reason of this.queued.values()) if (reason === "capacity") count++;
		return count;
	}

	private capacityEvent(active: number): void {
		const waiting = this.waitingCount();
		const key = `${active}/${this.limit}/${waiting}`;
		if (key === this.lastCapacity) return;
		this.lastCapacity = key;
		this.options.events.append("capacity", { active, limit: this.limit, waiting });
	}
}
