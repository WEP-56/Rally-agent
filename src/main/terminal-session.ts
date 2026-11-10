import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TerminalSize } from "../shared/terminal.ts";
import type { TerminalCommand, TerminalMessage } from "./terminal-protocol.ts";
import { processIdentity, stopProcessTree, type ProcessIdentity } from "./supervisor/process-identity.ts";

export function terminalShell(env = process.env): string {
	if (process.platform !== "win32") throw new Error("TERMINAL_PLATFORM_UNSUPPORTED: 当前终端仅支持 Windows");
	const paths = (env.PATH || env.Path || "").split(delimiter).filter(Boolean).map(path => join(path.replace(/^"|"$/g, ""), "pwsh.exe"));
	paths.unshift(join(env.ProgramFiles || "C:\\Program Files", "PowerShell", "7", "pwsh.exe"));
	paths.push(join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
	const shell = paths.find(path => { try { return statSync(path).isFile(); } catch { return false; } });
	if (!shell) throw new Error("TERMINAL_SHELL_MISSING: 未找到 PowerShell 7 或 Windows PowerShell"); return shell;
}
export function terminalHostPath(): string {
	const source = fileURLToPath(new URL("./terminal-host.ts", import.meta.url));
	return existsSync(source) ? source : fileURLToPath(new URL("./terminal-host.js", import.meta.url));
}
export interface TerminalSessionOptions { cwd: string; size: TerminalSize; shell?: string; args?: string[]; env?: NodeJS.ProcessEnv; hostPath?: string; execPath?: string }
export class TerminalSession {
	readonly shell: string;
	private child?: ChildProcess;
	private identity?: ProcessIdentity;
	private stopping?: Promise<void>;
	private closed = false;
	private starting?: Promise<void>;
	private cancelStart?: () => void;
	private readonly options: TerminalSessionOptions;
	private readonly emit: (message: TerminalMessage) => void;
	constructor(options: TerminalSessionOptions, emit: (message: TerminalMessage) => void) { this.options = options; this.emit = emit; this.shell = options.shell ?? terminalShell(options.env); }
	start(): Promise<void> { return this.starting ??= this.launch(); }
	private async launch(): Promise<void> {
		if (!statSync(this.options.cwd).isDirectory()) throw new Error("TERMINAL_CWD_INVALID");
		const child = this.child = spawn(this.options.execPath ?? process.execPath, [this.options.hostPath ?? terminalHostPath()], { env: { ...this.options.env ?? process.env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
		const ready = new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("TERMINAL_START_TIMEOUT")), 15000);
			const done = (error?: Error) => { clearTimeout(timeout); if (error) reject(error); else resolve(); };
			this.cancelStart = () => done(new Error("TERMINAL_CLOSED"));
			child.on("message", (raw: TerminalMessage) => { if (this.closed) return; if (raw.type === "ready") done(); if (raw.type === "error") done(new Error(raw.error)); this.emit(raw); });
			child.once("error", error => { done(error); if (!this.closed) this.emit({ type: "error", error: error.message }); });
			child.once("exit", () => { done(new Error("TERMINAL_HOST_EXITED")); if (!this.closed) this.emit({ type: "error", error: "终端宿主意外退出" }); });
		});
		// Observe rejection even while OS identity lookup is in flight.
		void ready.catch(() => {});
		try {
			await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
			this.identity = await processIdentity(child.pid!); if (!this.identity) throw new Error("TERMINAL_HOST_MISSING");
			if (this.closed) throw new Error("TERMINAL_CLOSED");
			const env = { ...this.options.env ?? process.env }; delete env.ELECTRON_RUN_AS_NODE;
			this.send({ type: "start", shell: this.shell, args: this.options.args ?? ["-NoLogo"], cwd: this.options.cwd, env, size: this.options.size });
			await ready;
		} catch (error) { await this.stopHost(); throw error; }
		finally { this.cancelStart = undefined; }
	}
	write(data: string): void { this.send({ type: "write", data }); }
	resize(size: TerminalSize): void { this.send({ type: "resize", size }); }
	ack(seq: number): void { this.send({ type: "ack", seq }); }
	close(): Promise<void> {
		this.closed = true;
		this.cancelStart?.();
		if (this.stopping) return this.stopping;
		this.stopping = (async () => { await this.starting?.catch(() => {}); await this.stopHost(); })().catch(error => { this.stopping = undefined; throw error; });
		return this.stopping;
	}
	private send(message: TerminalCommand): void { if (!this.closed && this.child?.connected) this.child.send(message, error => { if (error && !this.closed) this.emit({ type: "error", error: error.message }); }); }
	private async stopHost(): Promise<void> {
		if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) return;
		if (this.identity) await stopProcessTree(this.identity, 0); else this.child.disconnect();
	}
	get label(): string { return basename(this.shell).toLowerCase() === "pwsh.exe" ? "PowerShell 7" : basename(this.shell); }
}
