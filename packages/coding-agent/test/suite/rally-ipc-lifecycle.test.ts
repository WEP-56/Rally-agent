import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IpcChannel } from "../../../../src/shared/ipc.ts";
import { registerIpc } from "../../../../src/main/ipc.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { createHarness, type Harness } from "./harness.ts";
import { BrowserManager } from "../../../../src/main/browser.ts";
import { TerminalManager } from "../../../../src/main/terminal.ts";

const transport = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	listeners: new Map<string, unknown>(),
	rejectChannel: "",
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, listener: (...args: unknown[]) => unknown) => {
			if (transport.rejectChannel === channel) throw new Error("fixture registration failure");
			transport.handlers.set(channel, listener);
		},
		removeHandler: (channel: string) => transport.handlers.delete(channel),
		on: (channel: string, listener: unknown) => transport.listeners.set(channel, listener),
		removeListener: (channel: string) => transport.listeners.delete(channel),
	},
	app: {}, BrowserWindow: { getAllWindows: () => [] }, dialog: {}, shell: {},
}));

describe("Rally IPC shutdown boundary (no Electron UI)", () => {
	const harnesses: Harness[] = [];
	const supervisors: Supervisor[] = [];
	const stops: Array<() => Promise<void>> = [];
	afterEach(async () => {
		await Promise.all(stops.splice(0).map(stop => stop()));
		await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose()));
		vi.restoreAllMocks(); transport.handlers.clear(); transport.listeners.clear(); transport.rejectChannel = "";
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(supervisor);
		return { paths, supervisor };
	}
	it("lists real services and directly stops one through declared IPC without changing its task", async () => {
		const { paths, supervisor } = await setup(); mkdirSync(paths.workspaceDir, { recursive: true });
		const stop = registerIpc(paths, supervisor); stops.push(stop);
		const task = supervisor.store.create({ title: "IPC service", quotes: [], cwd: paths.workspaceDir, scope: [], mode: "write", dependsOn: [], autoApprove: false }).task;
		const run = supervisor.store.startRun(task.id, "dispatch", "fixture");
		const env = { ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" };
		await supervisor.services.start(task, run, { name: "IPC service", command: "fixture", readyPattern: "READY" }, undefined, { executable: process.execPath, args: ["-e", "console.log('READY');setInterval(()=>{},1000)"], cwd: task.cwd, env });
		const list = transport.handlers.get(IpcChannel.servicesState)!;
		expect(await list({})).toMatchObject({ services: [{ id: "S-1", status: "running" }] });
		const stopService = transport.handlers.get(IpcChannel.servicesStop)!;
		await expect(stopService({}, "../bad")).rejects.toThrow("SERVICE_NOT_FOUND");
		expect(await stopService({}, "S-1")).toMatchObject({ services: [{ id: "S-1", status: "stopped", reason: "user" }] });
		expect(task.ended).toBeUndefined(); expect(task.inputs).toEqual([]);
		expect(supervisor.events.ofKind("stop").at(-1)?.data).toMatchObject({ target: "service", source: "user" });
	}, 15000);
	it("rejects new requests and drains an accepted settings write before shutdown completes", async () => {
		const { paths, supervisor } = await setup();
		const stop = registerIpc(paths, supervisor); stops.push(stop);
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const save = supervisor.models.save.bind(supervisor.models);
		vi.spyOn(supervisor.models, "save").mockImplementationOnce(async input => { await gate; return save(input); });
		vi.spyOn(supervisor.main, "reapplyActiveModel").mockResolvedValueOnce();
		const handler = transport.handlers.get(IpcChannel.modelsSave)!;
		const request = handler({}, []);
		const closing = stop(); let closed = false; void closing.then(() => { closed = true; });
		const shutdown = supervisor.dispose(closing);
		try {
			expect(transport.handlers.size).toBe(0); expect(transport.listeners.size).toBe(0);
			expect(() => handler({}, [])).toThrow("shutting down");
			await Promise.resolve(); expect(closed).toBe(false); expect(existsSync(paths.modelsFile)).toBe(false);
			expect(() => new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} })).toThrow("STATE_DIRECTORY_LOCKED");
		} finally { release(); }
		await request; await closing; await shutdown;
		expect(existsSync(paths.modelsFile)).toBe(true); expect(closed).toBe(true); expect(stop()).toBe(closing);
	});
	it("closes views and terminal trees before a hung accepted request finishes draining", async () => {
		const { paths, supervisor } = await setup(); const stop = registerIpc(paths, supervisor); stops.push(stop);
		const browsers = vi.spyOn(BrowserManager.prototype, "dispose"); const terminals = vi.spyOn(TerminalManager.prototype, "dispose");
		let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; }); vi.spyOn(supervisor.main, "abort").mockImplementationOnce(() => hold);
		const request = transport.handlers.get(IpcChannel.chatAbort)!({}); let done = false; const closing = stop().then(() => { done = true; });
		try { await vi.waitFor(() => { expect(browsers).toHaveBeenCalledOnce(); expect(terminals).toHaveBeenCalledOnce(); }); expect(done).toBe(false); }
		finally { release(); }
		await request; await closing;
	});
	it("drains rejected requests and removes partially registered handlers on setup failure", async () => {
		const { paths, supervisor } = await setup();
		transport.rejectChannel = IpcChannel.tasksState;
		expect(() => registerIpc(paths, supervisor)).toThrow("fixture registration failure");
		expect(transport.handlers.size).toBe(0); expect(transport.listeners.size).toBe(0);
		transport.rejectChannel = "";
		const stop = registerIpc(paths, supervisor); stops.push(stop);
		vi.spyOn(supervisor.main, "send").mockRejectedValueOnce(new Error("fixture request failure"));
		const request = transport.handlers.get(IpcChannel.chatSend)!({}, "hello");
		const expected = expect(request).rejects.toThrow("fixture request failure");
		await expect(stop()).resolves.toBeUndefined(); await expected;
	});
	it("closes sessions while an accepted abort request drains, then releases ownership", async () => {
		const { paths, supervisor } = await setup();
		const stop = registerIpc(paths, supervisor); stops.push(stop);
		let release!: () => void;
		const transportClosed = new Promise<void>(resolve => { release = resolve; });
		// A hanging MCP abort needs session shutdown to close its transport first.
		vi.spyOn(supervisor.main, "abort").mockImplementationOnce(() => transportClosed);
		const dispose = supervisor.workers.dispose.bind(supervisor.workers);
		vi.spyOn(supervisor.workers, "dispose").mockImplementationOnce(async () => { release(); return dispose(); });
		const request = transport.handlers.get(IpcChannel.chatAbort)!({});
		const closing = supervisor.dispose(stop());
		try { await closing; await request; } finally { release(); }
		const recovered = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(recovered);
	});
});
