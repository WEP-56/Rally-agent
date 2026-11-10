import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IpcChannel, IpcEvent, type TaskEvent } from "../../../../src/shared/ipc.ts";
import type { BrowserWindow } from "electron";
import { registerIpc } from "../../../../src/main/ipc.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { createHarness, type Harness } from "./harness.ts";
import { BrowserManager } from "../../../../src/main/browser.ts";
import { TerminalManager } from "../../../../src/main/terminal.ts";
import { TaskNotifications } from "../../../../src/main/notifications.ts";
import { McpStore } from "../../../../src/main/mcp-store.ts";

const transport = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	listeners: new Map<string, unknown>(),
	rejectChannel: "",
	owner: vi.fn(),
	notices: [] as { title: string; click?: () => void; close: ReturnType<typeof vi.fn> }[],
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
	app: { getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [], fromWebContents: transport.owner }, dialog: {}, shell: {},
	Notification: class {
		title: string; click?: () => void; close = vi.fn();
		static isSupported() { return true; }
		constructor(options: { title: string }) { this.title = options.title; transport.notices.push(this); }
		on(event: string, callback: () => void) { if (event === "click") this.click = callback; }
		show() {}
	},
}));

describe("Rally IPC shutdown boundary (no Electron UI)", () => {
	const harnesses: Harness[] = [];
	const supervisors: Supervisor[] = [];
	const stops: Array<() => Promise<void>> = [];
	const notifications: TaskNotifications[] = [];
	afterEach(async () => {
		for (const manager of notifications.splice(0)) manager.dispose();
		await Promise.all(stops.splice(0).map(stop => stop()));
		await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose()));
		vi.restoreAllMocks(); transport.handlers.clear(); transport.listeners.clear(); transport.rejectChannel = ""; transport.owner.mockReset(); transport.notices = [];
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(emitTask: (event: TaskEvent) => void = () => {}) {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask }); supervisors.push(supervisor);
		return { paths, supervisor };
	}
	it("saves MCP search disclosure through owned-frame IPC without starting a connection", async () => {
		const { paths, supervisor } = await setup();
		const mcp = new McpStore(paths.agentDir); mcp.save(JSON.stringify({ mcpServers: { fixture: { command: "never-execute" } } }));
		stops.push(registerIpc(paths, supervisor));
		const sender = { mainFrame: {} }; transport.owner.mockReturnValue({ webContents: sender, isDestroyed: () => false });
		const event = { sender, senderFrame: sender.mainFrame }; const set = transport.handlers.get(IpcChannel.mcpExposure)!;
		await expect(set({ sender, senderFrame: {} }, "fixture", "deferred")).rejects.toThrow("BROWSER_NOT_ALLOWED");
		await expect(set(event, "fixture", "bad-mode")).rejects.toThrow("无效的 MCP 披露设置");
		expect(await set(event, "fixture", "deferred")).toMatchObject({ servers: [{ exposure: "deferred" }] });
		expect(await set(event, "fixture", "hidden", "delete_*")).toMatchObject({ servers: [{ toolExposure: { "delete_*": "hidden" } }] });
		expect(await set(event, "fixture", null, "delete_*")).toMatchObject({ servers: [{ toolExposure: {} }] });
		expect(mcp.state().servers[0].exposure).toBe("deferred");
		expect(supervisor.events.ofKind("process_stopped")).toHaveLength(0);
	});
	it("limits server editing and task archiving to the owning frame", async () => {
		const { paths, supervisor } = await setup();
		stops.push(registerIpc(paths, supervisor));
		const sender = { mainFrame: {} }; transport.owner.mockReturnValue({ webContents: sender, isDestroyed: () => false });
		const event = { sender, senderFrame: sender.mainFrame };
		const save = transport.handlers.get(IpcChannel.mcpSaveServer)!;
		await expect(save({ sender, senderFrame: {} }, "one", '{"command":"never-run"}')).rejects.toThrow("BROWSER_NOT_ALLOWED");
		await save(event, "one", '{"command":"never-run"}');
		await save(event, "two", '{"url":"https://example.invalid/mcp"}');
		expect(new McpStore(paths.agentDir).state().servers.map(server => server.name)).toEqual(["one", "two"]);
		const task = supervisor.store.create({ title: "Archive fixture", cwd: paths.workspaceDir, mode: "readonly", scope: [], quotes: [], dependsOn: [], autoApprove: false }).task;
		const archive = transport.handlers.get(IpcChannel.tasksArchive)!;
		await expect(archive({ sender, senderFrame: {} }, task.id, true)).rejects.toThrow("BROWSER_NOT_ALLOWED");
		await expect(archive(event, task.id, true)).rejects.toThrow("请先在主对话中结束任务");
		supervisor.cancel(task.id);
		await archive(event, task.id, true);
		expect(supervisor.store.get(task.id)?.archivedAt).toBeTypeOf("number");
		await archive(event, task.id, false);
		expect(supervisor.store.get(task.id)?.archivedAt).toBeUndefined();
	});
	it("projects real task escalation/completion and restricts notification settings and click targets to the main frame", async () => {
		let manager: TaskNotifications | undefined;
		const { paths, supervisor } = await setup(event => manager?.observe(event));
		const sender = { mainFrame: {}, isDestroyed: () => false, send: vi.fn() };
		const window = { webContents: sender, isDestroyed: () => false, isFocused: () => false, isVisible: () => true, isMinimized: () => false, show: vi.fn(), focus: vi.fn() };
		transport.owner.mockReturnValue(window);
		manager = new TaskNotifications(join(paths.home, "notifications.json"), () => window as unknown as BrowserWindow);
		notifications.push(manager); manager.start([]);
		stops.push(registerIpc(paths, supervisor, manager));
		const event = { sender, senderFrame: sender.mainFrame };
		const state = transport.handlers.get(IpcChannel.notificationsState)!;
		const update = transport.handlers.get(IpcChannel.notificationsUpdate)!;
		const target = transport.handlers.get(IpcChannel.notificationsTarget)!;
		expect(await state(event)).toEqual({ completed: true });
		await expect(update({ sender, senderFrame: {} }, { completed: false })).rejects.toThrow("BROWSER_NOT_ALLOWED");
		await expect(update(event, { completed: "false" })).rejects.toThrow("通知设置无效");
		const task = supervisor.store.create({ title: "通知接线", quotes: [], cwd: paths.workspaceDir, scope: [], mode: "write", dependsOn: [], autoApprove: false }).task;
		const run = supervisor.store.startRun(task.id, "dispatch", "fixture");
		const report = supervisor.store.report(task.id, run.id, "progress", "等待选项", "保留哪一个？", ["甲", "乙"]);
		expect(transport.notices).toHaveLength(0);
		supervisor.store.escalateAttention(task.id, report.attention!.id);
		expect(transport.notices).toHaveLength(1); transport.notices[0].click!();
		expect(sender.send).toHaveBeenCalledWith(IpcEvent.notification, undefined);
		await expect(target({ sender: { mainFrame: {} }, senderFrame: {} })).rejects.toThrow("BROWSER_NOT_ALLOWED");
		expect(await target(event)).toEqual({ taskId: task.id, cardId: `question-${report.attention!.id}` });
		expect(await target(event)).toBeNull(); expect(window.focus).toHaveBeenCalledOnce();
		supervisor.store.report(task.id, run.id, "ready", "完成");
		expect(transport.notices.map(item => item.title)).toEqual(["Rally · 需要回答", "Rally · 任务完成"]);
		expect(await update(event, { completed: false })).toEqual({ completed: false });
		expect(transport.notices[1].close).toHaveBeenCalledOnce();
		expect(JSON.parse(readFileSync(join(paths.home, "notifications.json"), "utf8"))).toEqual({ completed: false });
	});
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
