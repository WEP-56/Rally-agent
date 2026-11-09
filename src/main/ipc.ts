// Main-process IPC handlers. Every channel is declared in src/shared/ipc.ts.

import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron";
import { type AppInfo, type ChatEvent, IpcChannel, IpcEvent, type RallyPaths, type TaskEvent } from "../shared/ipc";
import type { FetchModelsInput, ProviderEntry, SelectModelInput } from "../shared/models";
import type { Supervisor } from "./supervisor";

/** Register all IPC handlers. Call once after app ready. */
export function registerIpc(paths: RallyPaths, supervisor: Supervisor): void {
	const chat = supervisor.main;
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

	ipcMain.handle(IpcChannel.tasksState, () => supervisor.board());
	ipcMain.handle(IpcChannel.tasksApprove, (_event, taskId: unknown) => supervisor.approve(String(taskId)));
	ipcMain.handle(IpcChannel.tasksCancel, (_event, taskId: unknown) => supervisor.cancel(String(taskId)));
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

/** Forward maximize/restore changes of a window to its renderer. */
export function forwardWindowState(win: BrowserWindow): void {
	const send = () => win.webContents.send(IpcEvent.windowMaximizedChanged, win.isMaximized());
	win.on("maximize", send);
	win.on("unmaximize", send);
}

function senderWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
	return BrowserWindow.fromWebContents(event.sender);
}
