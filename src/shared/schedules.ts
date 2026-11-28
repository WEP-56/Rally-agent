import type { Quote, TaskContext, TaskDisplayStatus, TaskMode } from "./task.ts";

/** Local window, start inclusive / end exclusive; weekdays belong to its opening day. */
export interface ScheduleWindow {
	start: string;
	end: string;
	timezone: string;
	/** ISO weekdays: 1 = Monday, 7 = Sunday. Omitted means every day. */
	weekdays?: number[];
}

export type ScheduleTiming =
	| { kind: "once"; at: number }
	| { kind: "interval"; minutes: number; window?: ScheduleWindow }
	| { kind: "daily"; time: string; timezone: string; weekdays?: number[] };
export interface ScheduledTask {
	id: string;
	title: string;
	cwd: string;
	mode: TaskMode;
	quotes: Quote[];
	context?: TaskContext[];
	note?: string;
	/** Configuration version; old saved plans default to 1. Dispatch checkpoints do not increment it. */
	revision?: number;
	timing: ScheduleTiming;
	enabled: boolean;
	nextAt: number;
	lastTaskId?: string;
	/** Derived from the task store; removing a past worker does not remove its plan. */
	lastTaskDeleted?: boolean;
	/** Derived on demand, never injected into the model's scheduling context. */
	waitingFor?: { taskId: string; status: TaskDisplayStatus; statusText: string };
	lastAt?: number;
	error?: string;
}
