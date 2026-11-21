import type { Quote, TaskMode } from "./task.ts";

export type ScheduleTiming = { kind: "once"; at: number } | { kind: "interval"; minutes: number } | { kind: "daily"; time: string; timezone: string };
export interface ScheduledTask {
	id: string;
	title: string;
	cwd: string;
	mode: TaskMode;
	quotes: Quote[];
	timing: ScheduleTiming;
	enabled: boolean;
	nextAt: number;
	lastTaskId?: string;
	/** Derived from the task store; removing a past worker does not remove its plan. */
	lastTaskDeleted?: boolean;
	lastAt?: number;
	error?: string;
}
