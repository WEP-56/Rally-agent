// Main-process IPC handlers. Every channel is declared in src/shared/ipc.ts.

import { app, BrowserWindow, dialog, shell, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron";
import { type AppInfo, type ChatEvent, IpcChannel, IpcEvent, type RallyPaths, type TaskEvent } from "../shared/ipc.ts";
import type { FetchModelsInput, ProviderEntry, SelectModelInput } from "../shared/models.ts";
import type { Supervisor } from "./supervisor/index.ts";
import type { WorkspacePatch, WorkspaceState } from "../shared/workspace.ts";
import { SkillStore } from "./skill-store.ts";
import { projectTrustState, setProjectTrust } from "./project-trust.ts";
import { McpStore } from "./mcp-store.ts";
import type { McpRiskTier } from "../shared/mcp.ts";
import type { ServicesState } from "../shared/services.ts";
import { BrowserManager } from "./browser.ts";
import type { BrowserLayout, BrowserAction } from "../shared/browser.ts";
import { httpAddress } from "../shared/browser.ts";
import type { TerminalSize } from "../shared/terminal.ts";
import { TerminalManager } from "./terminal.ts";

/** Register all IPC handlers. Call once after app ready. */
export function registerIpc(paths: RallyPaths, supervisor: Supervisor): () => Promise<void> {
	const browser = new BrowserManager();
	const terminals = new TerminalManager(taskId => {
		if (!taskId) return supervisor.workspace.base();
		const task = supervisor.store.get(taskId); if (!task) throw new Error("TERMINAL_TASK_NOT_FOUND"); return task.cwd;
	});
	const channels: string[] = [];
	const listeners: Array<{ channel: string; listener: Parameters<typeof ipcMain.on>[1] }> = [];
	const pending = new Set<Promise<unknown>>();
	let closing: Promise<void> | undefined;
	const stop = () => {
		if (closing) return closing;
		for (const channel of channels) ipcMain.removeHandler(channel);
		for (const item of listeners) ipcMain.removeListener(item.channel, item.listener);
		// Accepted requests can be stuck in a third-party provider. Close native views
		// and terminal trees concurrently so their lifetime never depends on that request.
		closing = Promise.allSettled([
			Promise.allSettled([...pending]),
			Promise.resolve().then(() => browser.dispose()),
			Promise.resolve().then(() => terminals.dispose()),
		]).then(results => {
			const failures = results.filter(result => result.status === "rejected");
			if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Rally view cleanup failed");
		});
		return closing;
	};
	const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => {
		ipcMain.handle(channel, (event, ...args) => {
			if (closing) throw new Error("Rally is shutting down");
			const request = Promise.resolve().then(() => listener(event, ...args));
			pending.add(request);
			return request.finally(() => pending.delete(request));
		});
		channels.push(channel);
	};
	const on = (channel: string, listener: Parameters<typeof ipcMain.on>[1]) => {
		ipcMain.on(channel, listener); listeners.push({ channel, listener });
	};
	try {
		handle(IpcChannel.terminalCreate, (event, id: string, size: TerminalSize, taskId?: string) => terminals.create(browser.owner(event), id, size, taskId));
		handle(IpcChannel.terminalWrite, (event, id: string, data: string) => terminals.write(browser.owner(event), id, data));
		handle(IpcChannel.terminalResize, (event, id: string, size: TerminalSize) => terminals.resize(browser.owner(event), id, size));
		handle(IpcChannel.terminalAck, (event, id: string, seq: number) => terminals.ack(browser.owner(event), id, seq));
		handle(IpcChannel.terminalClose, (event, id: string) => terminals.close(browser.owner(event), id));
		handle(IpcChannel.terminalOpenLink, (event, url: string) => { browser.owner(event); return shell.openExternal(httpAddress(url)); });
		handle(IpcChannel.browserCreate, (event, id: string, url?: string) => browser.create(browser.owner(event), id, url));
		handle(IpcChannel.browserNavigate, (event, id: string, url: string) => browser.navigate(browser.owner(event), id, url));
		handle(IpcChannel.browserAction, (event, id: string, action: BrowserAction) => browser.action(browser.owner(event), id, action));
		handle(IpcChannel.browserLayout, (event, layout: BrowserLayout) => browser.layout(browser.owner(event), layout));
		handle(IpcChannel.browserClose, (event, id: string) => browser.close(browser.owner(event), id));
		const chat = supervisor.main;
		handle(IpcChannel.servicesState, () => supervisor.services.state());
		handle(IpcChannel.servicesStop, async (_event, id: unknown) => {
			if (typeof id !== "string" || !/^S-\d+$/.test(id)) throw new Error("SERVICE_NOT_FOUND");
			await supervisor.services.stop(id, "user");
			return supervisor.services.state();
		});
		handle(IpcChannel.memoryState, () => supervisor.memory.state());
		handle(IpcChannel.memoryPath, (_event, path: unknown) => supervisor.memory.updatePath(path));
		handle(IpcChannel.memoryOpen, async () => {
			const error = await shell.openPath(supervisor.memory.prepareOpen());
			if (error) throw new Error(error);
		});
		handle(IpcChannel.memoryPick, async (event) => {
			const options = { title: "选择记忆文件", filters: [{ name: "Markdown", extensions: ["md"] }], properties: ["openFile"] as "openFile"[] };
			const win = senderWindow(event);
			const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
			return result.canceled ? null : result.filePaths[0] ?? null;
		});
		const mcp = new McpStore(paths.agentDir);
		handle(IpcChannel.mcpState, () => mcp.state());
		handle(IpcChannel.mcpSave, (_event, json: string) => mcp.save(json));
		handle(IpcChannel.mcpUpdate, (_event, name: string, enabled: boolean | null) => mcp.update(name, enabled));
		handle(IpcChannel.mcpTier, (_event, name: string, tier: McpRiskTier) => mcp.setTier(name, tier));
		handle(IpcChannel.gateDecide, (_event, id: string, decision: "allow" | "deny") => {
			supervisor.gates.decide(id, decision, "user", [], "用户点击确认卡片");
			return supervisor.board();
		});
		const skills = new SkillStore(paths.agentDir);
		const skillProjects = () => [paths.mainCwd, supervisor.workspace.base(), ...supervisor.workspace.state().recentProjects];
		const trustState = () => projectTrustState(paths.agentDir, [supervisor.workspace.base(), ...supervisor.workspace.state().recentProjects]);
		handle(IpcChannel.trustState, trustState);
		handle(IpcChannel.trustSet, (_event, path: string, trusted: boolean) => {
			setProjectTrust(paths.agentDir, path, trusted);
			return trustState();
		});
		handle(IpcChannel.skillsState, () => skills.state(skillProjects()));
		handle(IpcChannel.skillsImport, async (_event, path: string) => {
			skills.importDirectory(path);
			return skills.state(skillProjects());
		});
		handle(IpcChannel.skillsEnable, async (_event, path: string, enabled: boolean) => {
			await skills.setEnabled(path, enabled, skillProjects());
			return skills.state(skillProjects());
		});
		handle(
			IpcChannel.appInfo,
			(): AppInfo => ({
				name: app.getName(),
				version: app.getVersion(),
				platform: process.platform,
				versions: {
					electron: process.versions.electron,
					chrome: process.versions.chrome,
					node: process.versions.node,
				},
				paths,
			}),
		);

		on(IpcChannel.windowMinimize, (event) => senderWindow(event)?.minimize());
		on(IpcChannel.windowToggleMaximize, (event) => {
			const win = senderWindow(event);
			if (!win) return;
			if (win.isMaximized()) win.unmaximize();
			else win.maximize();
		});
		on(IpcChannel.windowClose, (event) => senderWindow(event)?.close());
		handle(IpcChannel.windowIsMaximized, (event) => senderWindow(event)?.isMaximized() ?? false);

		handle(IpcChannel.chatState, () => chat.state());
		handle(IpcChannel.chatSend, (_event, text: unknown) => chat.send(typeof text === "string" ? text : ""));
		handle(IpcChannel.chatAbort, () => chat.abort());
		handle(IpcChannel.chatReset, () => chat.reset());
		handle(IpcChannel.workspaceState, () => supervisor.workspace.state());
		handle(IpcChannel.workspaceUpdate, (_event, patch: WorkspacePatch) => {
			if (!patch || typeof patch !== "object" || Object.keys(patch).some((key) => key !== "defaultWorkspace") || (patch.defaultWorkspace !== undefined && typeof patch.defaultWorkspace !== "string")) throw new Error("只可设置主对话默认工作区");
			const state = supervisor.workspace.update(patch);
			for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcEvent.workspace, state);
			return state;
		});
		handle(IpcChannel.workspacePick, async (event) => {
			const win = senderWindow(event);
			const options = { title: "选择目录", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
			const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
			return result.canceled ? null : result.filePaths[0] ?? null;
		});

		handle(IpcChannel.tasksState, () => supervisor.board());
		handle(IpcChannel.tasksApprove, (_event, taskId: unknown) => supervisor.approve(String(taskId)));
		handle(IpcChannel.tasksCancel, (_event, taskId: unknown) => supervisor.cancel(String(taskId)));
		handle(IpcChannel.tasksAnswerOption, (_event, taskId: unknown, questionId: unknown, option: unknown) => {
			if (typeof taskId !== "string" || typeof questionId !== "string" || typeof option !== "string") throw new Error("ANSWER_INVALID: 回答参数无效");
			return supervisor.answerOption(taskId, questionId, option);
		});
		handle(IpcChannel.tasksApprovalMode, (_event, enabled: unknown) => supervisor.setAutoApprove(enabled === true));

		handle(IpcChannel.modelsState, () => supervisor.models.state());
		handle(IpcChannel.modelsSave, async (_event, providers: unknown) => {
			const state = await supervisor.models.save(Array.isArray(providers) ? (providers as ProviderEntry[]) : []);
			// Provider edits (URL/key) must reach the live session too, not just the next selection.
			await supervisor.main.reapplyActiveModel();
			return state;
		});
		handle(IpcChannel.modelsFetch, (_event, input: unknown) =>
			supervisor.models.fetchModels(input as FetchModelsInput),
		);
		handle(IpcChannel.modelsSelect, (_event, input: unknown) =>
			chat.selectModel(input as SelectModelInput),
		);
		handle(IpcChannel.modelsSelectWorker, (_event, input: unknown) => supervisor.models.selectWorker(input as SelectModelInput));
	} catch (error) { void stop(); throw error; }
	return stop;
}

/** Forward every chat event to the open windows. */
export function broadcastChat(event: ChatEvent): void {
	for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcEvent.chat, event);
}

/** Forward one task card (or a whole board snapshot) to the open windows. */
export function broadcastTask(event: TaskEvent): void {
	for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcEvent.task, event);
}

export function broadcastWorkspace(state: WorkspaceState): void {
	for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcEvent.workspace, state);
}

export function broadcastServices(state: ServicesState): void {
	for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcEvent.services, state);
}

/** Forward maximize/restore changes of a window to its renderer. */
export function forwardWindowState(win: BrowserWindow): void {
	const send = () => win.webContents.send(IpcEvent.windowMaximizedChanged, win.isMaximized());
	win.on("maximize", send);
	win.on("unmaximize", send);
}

function senderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
	return BrowserWindow.fromWebContents(event.sender);
}
