export interface TerminalSize { cols: number; rows: number }
export interface TerminalState { id: string; cwd: string; shell: string; status: "starting" | "running" | "exited" | "error"; exitCode?: number; error?: string }
export type TerminalEvent = { type: "state"; state: TerminalState } | { type: "data"; id: string; seq: number; data: string };
export function terminalSize(size: TerminalSize): TerminalSize {
	if (!size || !Number.isInteger(size.cols) || !Number.isInteger(size.rows) || size.cols < 2 || size.rows < 1 || size.cols > 500 || size.rows > 300) throw new Error("TERMINAL_SIZE_INVALID");
	return { cols: size.cols, rows: size.rows };
}
