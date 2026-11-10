import { EventEmitter } from "node:events";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerIpc } from "../../../../src/main/ipc.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { IpcChannel, IpcEvent } from "../../../../src/shared/ipc.ts";
import type { TerminalMessage } from "../../../../src/main/terminal-protocol.ts";
import type { TerminalSize } from "../../../../src/shared/terminal.ts";
import { createHarness, type Harness } from "./harness.ts";

const transport = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), owners: new Map<unknown, unknown>(), external: vi.fn(async () => {}) }));
class Session {
	static all: Session[] = []; static holdStart = false; static holdClose = false;
	options: { cwd: string; size: TerminalSize }; emit: (event: TerminalMessage) => void; label = "Fixture shell"; closed = false; writes: string[] = []; acks: number[] = []; sizes: TerminalSize[] = [];
	releaseStart?: () => void; releaseClose?: () => void;
	constructor(options: Session["options"], emit: Session["emit"]) { this.options = options; this.emit = emit; Session.all.push(this); }
	async start() { if (Session.holdStart) await new Promise<void>(resolve => { this.releaseStart = resolve; }); if (!this.closed) this.emit({ type: "ready", pid: 123 }); }
	write(data: string) { this.writes.push(data); } resize(size: TerminalSize) { this.sizes.push(size); } ack(seq: number) { this.acks.push(seq); }
	async close() { this.closed = true; if (Session.holdClose) await new Promise<void>(resolve => { this.releaseClose = resolve; }); }
}
class Window extends EventEmitter {
	id: number; webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false, send: vi.fn() });
	constructor(id = 1) { super(); this.id = id; transport.owners.set(this.webContents, this); }
	isDestroyed() { return false; }
}
vi.mock("../../../../src/main/terminal-session.ts", () => ({ TerminalSession: class { constructor(options: Session["options"], emit: Session["emit"]) { return new Session(options, emit); } } }));
vi.mock("electron", () => ({
	ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => transport.handlers.set(channel, fn), removeHandler: (channel: string) => transport.handlers.delete(channel), on: () => {}, removeListener: () => {} },
	app: {}, dialog: {}, shell: { openExternal: transport.external }, BrowserWindow: { fromWebContents: (contents: unknown) => transport.owners.get(contents), getAllWindows: () => [] },
}));
describe("Rally user terminal IPC (faux harness, no native UI)", () => {
	const harnesses: Harness[] = []; const supervisors: Supervisor[] = []; const stops: Array<() => Promise<void>> = [];
	afterEach(async () => { Session.holdStart = false; Session.holdClose = false; for (const session of Session.all) { session.releaseStart?.(); session.releaseClose?.(); } await Promise.all(stops.splice(0).map(stop => stop())); await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose())); Session.all = []; transport.owners.clear(); transport.external.mockClear(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness); const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths); mkdirSync(paths.workspaceDir, { recursive: true });
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(supervisor);
		const stop = registerIpc(paths, supervisor); stops.push(stop); const window = new Window();
		const invoke = (channel: string, ...args: unknown[]) => Promise.resolve(transport.handlers.get(channel)!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args));
		return { harness, paths, supervisor, stop, window, invoke };
	}
	it("uses configured workspace or authoritative task cwd, preserves duplicates and keeps sessions independent", async () => {
		const { harness, paths, supervisor, invoke } = await setup(); const taskCwd = join(harness.tempDir, "project"); mkdirSync(taskCwd);
		const task = supervisor.store.create({ title: "Terminal cwd", quotes: [], cwd: taskCwd, scope: [], mode: "readonly", dependsOn: [], autoApprove: false }).task;
		const size = { cols: 80, rows: 24 };
		expect(await invoke(IpcChannel.terminalCreate, "a", size)).toMatchObject({ cwd: realpathSync(paths.workspaceDir), status: "running" });
		expect(await invoke(IpcChannel.terminalCreate, "b", size, task.id)).toMatchObject({ cwd: realpathSync(taskCwd), status: "running" });
		await invoke(IpcChannel.terminalCreate, "a", size); expect(Session.all.length).toBe(2);
		await invoke(IpcChannel.terminalClose, "a"); expect(Session.all[0].closed).toBe(true); expect(Session.all[1].closed).toBe(false);
	});
	it("rejects guests, subframes, cross-window IDs, invalid task/size/input and unsafe links", async () => {
		const { invoke, window } = await setup(); const size = { cols: 80, rows: 24 };
		const create = transport.handlers.get(IpcChannel.terminalCreate)!;
		await expect(create({ sender: {}, senderFrame: {} }, "a", size)).rejects.toThrow("BROWSER_NOT_ALLOWED");
		await expect(create({ sender: window.webContents, senderFrame: {} }, "a", size)).rejects.toThrow("BROWSER_NOT_ALLOWED");
		await expect(invoke(IpcChannel.terminalCreate, "a", size, "T-99999")).rejects.toThrow("TERMINAL_TASK_NOT_FOUND");
		await expect(invoke(IpcChannel.terminalCreate, "a", { cols: 1, rows: 1 })).rejects.toThrow("TERMINAL_SIZE_INVALID");
		await invoke(IpcChannel.terminalCreate, "a", size); const other = new Window(2);
		await expect(transport.handlers.get(IpcChannel.terminalWrite)!({ sender: other.webContents, senderFrame: other.webContents.mainFrame }, "a", "bad")).rejects.toThrow("TERMINAL_NOT_FOUND");
		await expect(invoke(IpcChannel.terminalWrite, "a", "x".repeat(65537))).rejects.toThrow("TERMINAL_INPUT_INVALID");
		await expect(invoke(IpcChannel.terminalOpenLink, "file:///secret")).rejects.toThrow("BROWSER_URL_INVALID");
		await invoke(IpcChannel.terminalOpenLink, "https://example.test"); expect(transport.external).toHaveBeenCalledWith("https://example.test/");
	});
	it("streams only to its owning UI and routes input, resize and acknowledgements without task facts", async () => {
		const { invoke, supervisor, window } = await setup(); await invoke(IpcChannel.terminalCreate, "a", { cols: 80, rows: 24 });
		const before = supervisor.events.all().length; const session = Session.all[0];
		await invoke(IpcChannel.terminalWrite, "a", "private user input"); await invoke(IpcChannel.terminalResize, "a", { cols: 100, rows: 30 });
		session.emit({ type: "data", seq: 1, data: "private output" }); await invoke(IpcChannel.terminalAck, "a", 1);
		expect(session.writes).toEqual(["private user input"]); expect(session.sizes).toEqual([{ cols: 100, rows: 30 }]); expect(session.acks).toEqual([1]);
		expect(window.webContents.send).toHaveBeenCalledWith(IpcEvent.terminal, { type: "data", id: "a", seq: 1, data: "private output" }); expect(supervisor.events.all().length).toBe(before);
		session.emit({ type: "exit", exitCode: 3 }); expect(session.closed).toBe(true); await expect(invoke(IpcChannel.terminalWrite, "a", "late")).rejects.toThrow("TERMINAL_NOT_RUNNING");
	});
	it("waits for startup and tree closure when a tab closes during creation", async () => {
		const { invoke } = await setup(); Session.holdStart = true; const creating = invoke(IpcChannel.terminalCreate, "a", { cols: 80, rows: 24 });
		await vi.waitFor(() => expect(Session.all.length).toBe(1)); const closing = invoke(IpcChannel.terminalClose, "a");
		await vi.waitFor(() => expect(Session.all[0].closed).toBe(true)); Session.all[0].releaseStart!(); await creating; await closing;
	});
	it("closes sessions on UI reload, renderer crash and IPC shutdown", async () => {
		const { invoke, window, stop } = await setup(); await invoke(IpcChannel.terminalCreate, "a", { cols: 80, rows: 24 });
		window.webContents.emit("did-start-navigation", {}, "file:///app", false, true); await vi.waitFor(() => expect(Session.all[0].closed).toBe(true));
		await invoke(IpcChannel.terminalCreate, "b", { cols: 80, rows: 24 }); window.webContents.emit("render-process-gone", {}, {}); await vi.waitFor(() => expect(Session.all[1].closed).toBe(true));
		await invoke(IpcChannel.terminalCreate, "c", { cols: 80, rows: 24 }); await stop(); expect(Session.all[2].closed).toBe(true); expect(transport.handlers.size).toBe(0);
	});
	it("keeps a failed close visible and permits a cleanup retry", async () => {
		const { invoke, window } = await setup(); await invoke(IpcChannel.terminalCreate, "a", { cols: 80, rows: 24 }); const session = Session.all[0];
		vi.spyOn(session, "close").mockRejectedValueOnce(new Error("fixture tree busy"));
		await expect(invoke(IpcChannel.terminalClose, "a")).rejects.toThrow("fixture tree busy");
		expect(window.webContents.send).toHaveBeenLastCalledWith(IpcEvent.terminal, expect.objectContaining({ type: "state", state: expect.objectContaining({ status: "error", error: expect.stringContaining("重试") }) }));
		await invoke(IpcChannel.terminalClose, "a"); expect(session.closed).toBe(true);
	});
});
