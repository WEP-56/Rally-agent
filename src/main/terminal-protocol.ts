import type { TerminalSize } from "../shared/terminal.ts";
export type TerminalCommand = { type: "start"; shell: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; size: TerminalSize } | { type: "write"; data: string } | { type: "resize"; size: TerminalSize } | { type: "ack"; seq: number };
export type TerminalMessage = { type: "ready"; pid: number } | { type: "data"; seq: number; data: string } | { type: "exit"; exitCode: number } | { type: "error"; error: string };
