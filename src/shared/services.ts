/** Persisted service facts. Environment values and output live outside task snapshots. */
export interface ServiceRecord {
	id: string;
	taskId: string;
	runId: string;
	name: string;
	command: string;
	cwd: string;
	/** PID of the registered process-tree host. */
	pid?: number;
	port?: number;
	url?: string;
	ready: boolean;
	status: "running" | "exited" | "stopped";
	startedAt: number;
	endedAt?: number;
	exitCode?: number;
	reason?: "user" | "worker" | "shutdown" | "interrupted" | "cancelled";
	error?: string;
}
export interface ServicesState { services: ServiceRecord[] }
