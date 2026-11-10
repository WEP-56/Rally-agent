import type { BrowserWindow } from "electron";
import { realpathSync, statSync } from "node:fs";
import { IpcEvent } from "../shared/ipc.ts";
import { terminalSize, type TerminalState, type TerminalSize, type TerminalEvent } from "../shared/terminal.ts";
import { TerminalSession } from "./terminal-session.ts";

interface Entry { owner: BrowserWindow; state: TerminalState; session?: TerminalSession; starting?: Promise<TerminalState>; closing?: Promise<void> }
interface Owner { window: BrowserWindow; entries: Map<string, Entry>; unbind(): void }
/** User-only sessions. No transcript, command or environment enters Supervisor or task history. */
export class TerminalManager {
	private readonly owners = new Map<number, Owner>();
	private readonly closing = new Set<Promise<void>>();
	private disposed = false;
	private readonly cwd: (taskId?: string) => string;
	constructor(cwd: (taskId?: string) => string) { this.cwd = cwd; }
	create(owner: BrowserWindow, id: string, size: TerminalSize, taskId?: string): Promise<TerminalState> {
		this.id(id); terminalSize(size); if (this.disposed) throw new Error("TERMINAL_CLOSED");
		let group = this.owners.get(owner.id);
		if (!group) {
			const close = () => { void this.closeOwner(owner.id).catch(error => console.error("Terminal cleanup failed", error)); };
			const navigate = (_event: unknown, _url: string, inPlace: boolean, main: boolean) => { if (main && !inPlace) close(); };
			owner.on("closed", close); owner.webContents.on("render-process-gone", close); owner.webContents.on("did-start-navigation", navigate);
			group = { window: owner, entries: new Map(), unbind: () => { owner.off("closed", close); owner.webContents.off("render-process-gone", close); owner.webContents.off("did-start-navigation", navigate); } }; this.owners.set(owner.id, group);
		}
		const existing = group.entries.get(id); if (existing) return existing.starting!.then(() => ({ ...existing.state }));
		if (group.entries.size >= 16) throw new Error("TERMINAL_LIMIT: 最多打开 16 个终端");
		if (taskId !== undefined && (typeof taskId !== "string" || !/^T-\d+$/.test(taskId))) throw new Error("TERMINAL_TASK_INVALID");
		const cwd = realpathSync(this.cwd(taskId)); if (!statSync(cwd).isDirectory()) throw new Error("TERMINAL_CWD_INVALID");
		const entry: Entry = { owner, state: { id, cwd, shell: "PowerShell", status: "starting" } };
		group.entries.set(id, entry);
		entry.starting = Promise.resolve().then(async () => {
			if (entry.closing) throw new Error("TERMINAL_CLOSED");
			const session = entry.session = new TerminalSession({ cwd, size }, message => {
				if (entry.closing) return;
				if (message.type === "data") this.emit(owner, { ...message, id });
				else if (message.type === "ready") { entry.state.status = "running"; this.publish(entry); }
				else { entry.state.status = message.type === "exit" ? "exited" : "error"; if (message.type === "exit") entry.state.exitCode = message.exitCode; else entry.state.error = message.error; this.publish(entry); void session.close().catch(error => { entry.state.error = String(error); this.publish(entry); }); }
			});
			entry.state.shell = session.label;
			try { await session.start(); } catch (error) { entry.state.status = "error"; entry.state.error = String(error); this.publish(entry); }
			return { ...entry.state };
		});
		return entry.starting;
	}
	write(owner: BrowserWindow, id: string, data: string): void {
		const entry = this.require(owner, id); if (typeof data !== "string" || data.length > 65536) throw new Error("TERMINAL_INPUT_INVALID");
		if (entry.state.status !== "running") throw new Error("TERMINAL_NOT_RUNNING"); entry.session!.write(data);
	}
	resize(owner: BrowserWindow, id: string, size: TerminalSize): void { const entry = this.require(owner, id); terminalSize(size); if (entry.state.status === "running") entry.session!.resize(size); }
	ack(owner: BrowserWindow, id: string, seq: number): void { if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("TERMINAL_ACK_INVALID"); this.require(owner, id).session?.ack(seq); }
	async close(owner: BrowserWindow, id: string): Promise<void> {
		this.id(id); const group = this.owners.get(owner.id); const entry = group?.entries.get(id); if (!entry) return;
		try { await this.closeEntry(entry); group!.entries.delete(id); }
		catch (error) { if (entry.closing) this.closing.delete(entry.closing); entry.closing = undefined; entry.state.status = "error"; entry.state.error = `终端关闭失败，可重试关闭：${String(error)}`; this.publish(entry); throw error; }
	}
	async dispose(): Promise<void> { this.disposed = true; await Promise.all([...this.owners.keys()].map(id => this.closeOwner(id))); await Promise.all([...this.closing]); }
	private async closeOwner(id: number): Promise<void> { const group = this.owners.get(id); if (!group) return; this.owners.delete(id); group.unbind(); await Promise.all([...group.entries.values()].map(entry => this.closeEntry(entry))); }
	private closeEntry(entry: Entry): Promise<void> {
		if (entry.closing) return entry.closing;
		const pending = entry.closing = (async () => { const stop = entry.session?.close(); void stop?.catch(() => {}); await entry.starting?.catch(() => {}); await stop; await entry.session?.close(); })();
		this.closing.add(pending); void pending.then(() => this.closing.delete(pending), () => {}); return pending;
	}
	private publish(entry: Entry): void { this.emit(entry.owner, { type: "state", state: { ...entry.state } }); }
	private emit(owner: BrowserWindow, event: TerminalEvent): void { if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send(IpcEvent.terminal, event); }
	private id(id: string): void { if (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id)) throw new Error("TERMINAL_ID_INVALID"); }
	private require(owner: BrowserWindow, id: string): Entry { this.id(id); const entry = this.owners.get(owner.id)?.entries.get(id); if (this.disposed || !entry || entry.closing) throw new Error("TERMINAL_NOT_FOUND"); return entry; }
}
