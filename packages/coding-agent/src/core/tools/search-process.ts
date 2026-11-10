import type { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

/** Optional host-owned execution for the local search tools, preserving Pi's parsing and limits. */
export interface SearchProcess extends EventEmitter {
	stdout: Readable;
	stderr: Readable;
	readonly killed: boolean;
	kill(signal?: NodeJS.Signals | number): boolean;
}

export interface SearchExecution {
	resolveTool?(tool: "rg" | "fd", signal?: AbortSignal): Promise<string | undefined>;
	spawn(executable: string, args: string[], cwd?: string): SearchProcess;
}
