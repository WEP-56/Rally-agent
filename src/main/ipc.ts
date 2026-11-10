// Main-process IPC handlers. Every channel is declared in src/shared/ipc.ts.

import { app, BrowserWindow, dialog, shell, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron";
import { type AppInfo, type ChatEvent, IpcChannel, IpcEvent, type RallyPaths, type TaskEvent } from "../shared/ipc";
import type { FetchModelsInput, ProviderEntry, SelectModelInput } from "../shared/models";
import type { Supervisor } from "./supervisor";
import type { WorkspacePatch, WorkspaceState } from "../shared/workspace";
import { SkillStore } from "./skill-store";
import { projectTrustState, setProjectTrust } from "./project-trust";
import { McpStore } from "./mcp-store";
import type { McpRiskTier } from "../shared/mcp";

/** Register all IPC handlers. Call once after app ready. */
export function registerIpc(paths: RallyPaths, supervisor: Supervisor): void {
	const chat = supervisor.main;
	ipcMain.handle(IpcChannel.memoryState, () => supervisor.memory.state());
	ipcMain.handle(IpcChannel.memoryPath, (_event, path: unknown) => supervisor.memory.updatePath(path));
	ipcMain.handle(IpcChannel.memoryOpen, async () => {
		const error = await shell.openPath(supervisor.memory.prepareOpen());
		if (error) throw new Error(error);
	});
	ipcMain.handle(IpcChannel.memoryPick, async (event) => {
		const options = { title: "选择记忆文件", filters: [{ name: "Markdown", extensions: ["md"] }], properties: ["openFile"] as "openFile"[] };
		const win = senderWindow(event);
		const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
		return result.canceled ? null : result.filePaths[0] ?? null;
	});
	const mcp = new McpStore(paths.agentDir);
	ipcMain.handle(IpcChannel.mcpState, () => mcp.state());
	ipcMain.handle(IpcChannel.mcpSave, (_event, json: string) => mcp.save(json));
	ipcMain.handle(IpcChannel.mcpUpdate, (_event, name: string, enabled: boolean | null) => mcp.update(name, enabled));
	ipcMain.handle(IpcChannel.mcpTier, (_event, name: string, tier: McpRiskTier) => mcp.setTier(name, tier));
	ipcMain.handle(IpcChannel.gateDecide, (_event, id: string, decision: "allow" | "deny") => {
		supervisor.gates.decide(id, decision, "user", [], "用户点击确认卡片");
		return supervisor.board();
	});
	const skills = new SkillStore(paths.agentDir);
	const skillProjects = () => [paths.mainCwd, supervisor.workspace.base(), ...supervisor.workspace.state().recentProjects];
	const trustState = () => projectTrustState(paths.agentDir, [supervisor.workspace.base(), ...supervisor.workspace.state().recentProjects]);
	ipcMain.handle(IpcChannel.trustState, trustState);
	ipcMain.handle(IpcChannel.trustSet, (_event, path: string, trusted: boolean) => {
		setProjectTrust(paths.agentDir, path, trusted);
		return trustState();
	});
	ipcMain.handle(IpcChannel.skillsState, () => skills.state(skillProjects()));
	ipcMain.handle(IpcChannel.skillsImport, async (_event, path: string) => {
		skills.importDirectory(path);
		return skills.state(skillProjects());
	});
	ipcMain.handle(IpcChannel.skillsEnable, async (_event, path: string, enabled: boolean) => {
		await skills.setEnabled(path, enabled, skillProjects());
		return skills.state(skillProjects());
	});
	ipcMain.handle(
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

	ipcMain.on(IpcChannel.windowMinimize, (event) => senderWindow(event)?.minimize());
	ipcMain.on(IpcChannel.windowToggleMaximize, (event) => {
		const win = senderWindow(event);
		if (!win) return;
		if (win.isMaximized()) win.unmaximize();
		else win.maximize();
	});
	ipcMain.on(IpcChannel.windowClose, (event) => senderWindow(event)?.close());
	ipcMain.handle(IpcChannel.windowIsMaximized, (event) => senderWindow(event)?.isMaximized() ?? false);

	ipcMain.handle(IpcChannel.chatState, () => chat.state());
	ipcMain.handle(IpcChannel.chatSend, (_event, text: unknown) => chat.send(typeof text === "string" ? text : ""));
	ipcMain.handle(IpcChannel.chatAbort, () => chat.abort());
	ipcMain.handle(IpcChannel.chatReset, () => chat.reset());
	ipcMain.handle(IpcChannel.workspaceState, () => supervisor.workspace.state());
	ipcMain.handle(IpcChannel.workspaceUpdate, (_event, patch: WorkspacePatch) => {
		if (!patch || typeof patch !== "object" || Object.keys(patch).some((key) => key !== "defaultWorkspace") || (patch.defaultWorkspace !== undefined && typeof patch.defaultWorkspace !== "string")) throw new Error("只可设置主对话默认工作区");
		const state = supervisor.workspace.update(patch);
		for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IpcEvent.workspace, state);
		return state;
	});
	ipcMain.handle(IpcChannel.workspacePick, async (event) => {
		const win = senderWindow(event);
		const options = { title: "选择目录", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
		const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
		return result.canceled ? null : result.filePaths[0] ?? null;
	});

	ipcMain.handle(IpcChannel.tasksState, () => supervisor.board());
	ipcMain.handle(IpcChannel.tasksApprove, (_event, taskId: unknown) => supervisor.approve(String(taskId)));
	ipcMain.handle(IpcChannel.tasksCancel, (_event, taskId: unknown) => supervisor.cancel(String(taskId)));
	ipcMain.handle(IpcChannel.tasksAnswerOption, (_event, taskId: unknown, questionId: unknown, option: unknown) => {
		if (typeof taskId !== "string" || typeof questionId !== "string" || typeof option !== "string") throw new Error("ANSWER_INVALID: 回答参数无效");
		return supervisor.answerOption(taskId, questionId, option);
	});
	ipcMain.handle(IpcChannel.tasksApprovalMode, (_event, enabled: unknown) => supervisor.setAutoApprove(enabled === true));

	ipcMain.handle(IpcChannel.modelsState, () => supervisor.models.state());
	ipcMain.handle(IpcChannel.modelsSave, async (_event, providers: unknown) => {
		const state = await supervisor.models.save(Array.isArray(providers) ? (providers as ProviderEntry[]) : []);
		// Provider edits (URL/key) must reach the live session too, not just the next selection.
		await supervisor.main.reapplyActiveModel();
		return state;
	});
	ipcMain.handle(IpcChannel.modelsFetch, (_event, input: unknown) =>
		supervisor.models.fetchModels(input as FetchModelsInput),
	);
	ipcMain.handle(IpcChannel.modelsSelect, (_event, input: unknown) =>
		chat.selectModel(input as SelectModelInput),
	);
	ipcMain.handle(IpcChannel.modelsSelectWorker, (_event, input: unknown) => supervisor.models.selectWorker(input as SelectModelInput));
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

/** Forward maximize/restore changes of a window to its renderer. */
export function forwardWindowState(win: BrowserWindow): void {
	const send = () => win.webContents.send(IpcEvent.windowMaximizedChanged, win.isMaximized());
	win.on("maximize", send);
	win.on("unmaximize", send);
}

function senderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
	return BrowserWindow.fromWebContents(event.sender);
}
