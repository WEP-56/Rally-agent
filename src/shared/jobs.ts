/** Durable job facts. Output stays in state/jobs/<id>.log, never in task snapshots. */
export interface JobRecord {
	id: string;
	taskId: string;
	runId: string;
	shell: "bash" | "powershell" | "ssh";
	ssh?: { serverId: string; status: "running" | "exited" | "disconnected" | "closed"; exitSignal?: string; observed?: boolean };
	command: string;
	cwd: string;
	status: "running" | "exited" | "killed";
	startedAt: number;
	backgroundedAt?: number;
	endedAt?: number;
	exitCode?: number;
	reason?: "timeout" | "cancelled" | "task_ended" | "shutdown" | "interrupted" | "inactivity";
	error?: string;
}
