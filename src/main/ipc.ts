import { businessHandlers } from "./business.ts";
import { AGENT_BROWSER_COMMANDS, browserCommand } from "./agent-browser/commands.ts";
import { ResourcePreviewHost } from "./resource-preview.ts";
import { createReadStream } from "node:fs";
import { ResourceDownloads, saveResource } from "./resource-download.ts";
import type { UploadRequest } from "../shared/resources.ts";
import type { WorkspaceState } from "../shared/workspace.ts";
// Main-process IPC handlers. Every channel is declared in src/shared/ipc.ts.

import { app, BrowserWindow, dialog, shell, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron";
import { type AppInfo, type ChatEvent, IpcChannel, IpcEvent, type RallyPaths, type TaskEvent } from "../shared/ipc.ts";
import type { Supervisor } from "./supervisor/index.ts";
import type { ServicesState } from "../shared/services.ts";
import { BrowserManager } from "./browser.ts";
import type { BrowserLayout, BrowserAction } from "../shared/browser.ts";
import { httpAddress } from "../shared/browser.ts";
import type { TerminalSize } from "../shared/terminal.ts";
import { TerminalManager } from "./terminal.ts";
import type { TaskNotifications } from "./notifications.ts";
import type { IdentityState } from "../shared/identity.ts";
import { readAvatar } from "./identity-avatar.ts";

/** Register all IPC handlers. Call once after app ready. */
export function registerIpc(paths: RallyPaths, supervisor: Supervisor, notifications?: TaskNotifications): () => Promise<void> {
	const browser = new BrowserManager();
	const resourcePreview = new ResourcePreviewHost(supervisor.resources);
	const downloads = new ResourceDownloads();
	const terminals = new TerminalManager(taskId => {
		if (!taskId) return supervisor.workspace.base();
		const task = supervisor.store.get(taskId); if (!task) throw new Error("TERMINAL_TASK_NOT_FOUND"); return task.cwd;
	});
	const channels: string[] = [];
	const browserOwners = new Set<number>();
	const pending = new Set<Promise<unknown>>();
	let closing: Promise<void> | undefined;
	const stop = () => {
		if (closing) return closing;
		for (const channel of channels) ipcMain.removeHandler(channel);
		// Accepted requests can be stuck in a third-party provider. Close native views
		// and terminal trees concurrently so their lifetime never depends on that request.
		closing = Promise.allSettled([
			Promise.allSettled([...pending]),
			Promise.resolve().then(() => browser.dispose()),
			Promise.resolve().then(() => terminals.dispose()),
			Promise.resolve().then(() => resourcePreview.close()),
			downloads.close(),
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
	try {
		for (const channel of AGENT_BROWSER_COMMANDS) handle(channel, (event, ...args: unknown[]) => {
			const owner = browser.owner(event);
			if (!browserOwners.has(owner.id)) {
				browserOwners.add(owner.id);
				owner.webContents.on("render-process-gone", () => supervisor.agentBrowser.disconnect(`desktop:${owner.id}`));
				owner.once("closed", () => { supervisor.agentBrowser.disconnect(`desktop:${owner.id}`); browserOwners.delete(owner.id); });
			}
			return browserCommand(supervisor.agentBrowser, `desktop:${owner.id}`, channel, args);
		});
		handle(IpcChannel.resourceBegin, (event, input: UploadRequest) => { browser.owner(event); return supervisor.resources.begin("desktop", input); });
		handle(IpcChannel.resourceStatus, (event, id: string) => { browser.owner(event); return supervisor.resources.status("desktop", id); });
		handle(IpcChannel.resourceAppend, (event, id: string, offset: number, bytes: Uint8Array) => { browser.owner(event); return supervisor.resources.append("desktop", id, offset, bytes); });
		handle(IpcChannel.resourceComplete, (event, id: string) => { browser.owner(event); return supervisor.resources.complete("desktop", id); });
		handle(IpcChannel.resourceCancel, (event, id: string) => { browser.owner(event); return supervisor.resources.cancel("desktop", id); });
		handle(IpcChannel.resourceGet, (event, id: string) => { browser.owner(event); return supervisor.resources.get(id, "desktop"); });
		handle(IpcChannel.resourcePreview, async (event, id: string, thumbnail?: boolean) => { browser.owner(event); return resourcePreview.url(thumbnail ? (await supervisor.resources.thumbnail(id, "desktop")).id : id); });
		handle(IpcChannel.resourceSave, (event, id: string, downloadId: string) => {
			const owner = browser.owner(event);
			const resource = supervisor.resources.get(id, "desktop");
			return downloads.start(downloadId, async signal => {
				const result = await dialog.showSaveDialog(owner, { title: "保存附件", defaultPath: resource.name.replace(/[<>:"/\\|?*]/g, "_") });
				if (result.canceled || !result.filePath) return false;
				signal.throwIfAborted();
				const source = createReadStream(supervisor.resources.path(id, "desktop"), { signal });
				await saveResource(source, result.filePath, resource, signal, received => {
					if (!owner.isDestroyed()) owner.webContents.send(IpcEvent.resourceSave, { id: downloadId, received, size: resource.size });
				});
				return true;
			});
		});
		handle(IpcChannel.resourceCancelSave, (event, id: string) => { browser.owner(event); downloads.cancel(id); });
		if (notifications) {
			handle(IpcChannel.notificationsState, event => { browser.owner(event); return notifications.state(); });
			handle(IpcChannel.notificationsUpdate, (event, value: unknown) => { browser.owner(event); return notifications.update(value); });
			handle(IpcChannel.notificationsTarget, event => { browser.owner(event); return notifications.takeTarget(); });
		}
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
		const needsOwner = new Set<string>([IpcChannel.credentialsState, IpcChannel.credentialsSubmit, IpcChannel.credentialsCancel, IpcChannel.credentialsUpdate, IpcChannel.credentialsRemove, IpcChannel.credentialsReplace, IpcChannel.credentialsClearLogin, IpcChannel.qqMailState, IpcChannel.qqMailSave, IpcChannel.qqMailVerify, IpcChannel.qqMailDisconnect, IpcChannel.qqBotState, IpcChannel.qqBotSave, IpcChannel.qqBotRetry, IpcChannel.qqBotPair, IpcChannel.qqBotDisconnect, IpcChannel.feishuState, IpcChannel.feishuSave, IpcChannel.feishuRetry, IpcChannel.feishuPair, IpcChannel.feishuTools, IpcChannel.feishuDisconnect, IpcChannel.identityState, IpcChannel.identityInitialize, IpcChannel.identityUpdate, IpcChannel.identityResetAvatar, IpcChannel.roleWorkersState, IpcChannel.roleWorkersSave, IpcChannel.roleWorkersDelete, IpcChannel.roleWorkersAgentModels, IpcChannel.schedulesState, IpcChannel.schedulesUpdate, IpcChannel.mcpSaveServer, IpcChannel.mcpExposure, IpcChannel.gateDecide, IpcChannel.chatNewConversation, IpcChannel.tasksArchive, IpcChannel.tasksDelete]);
		needsOwner.add(IpcChannel.connectorToolsState);
		for (const channel of [IpcChannel.sshState, IpcChannel.sshSave, IpcChannel.sshVerify, IpcChannel.sshUpdate, IpcChannel.sshRemove]) needsOwner.add(channel);
		needsOwner.add(IpcChannel.connectorToolsTier);
		needsOwner.add(IpcChannel.chatInbox);
		for (const [channel, handler] of Object.entries(businessHandlers(paths, supervisor, (name, data) => {
			for (const win of BrowserWindow.getAllWindows()) win.webContents.send(name, data);
		}))) handle(channel, (event, ...args) => { if(needsOwner.has(channel)) browser.owner(event); return Reflect.apply(handler, undefined, args); });
		const publishIdentity = (state: IdentityState) => {
			for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(IpcEvent.identity, state);
			return state;
		};
		handle(IpcChannel.identityPickAvatar, async event => {
			const owner = browser.owner(event);
			const selected = await dialog.showOpenDialog(owner, { title: "选择头像", filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }], properties: ["openFile"] });
			if (selected.canceled || !selected.filePaths[0]) return null;
			if (closing) throw new Error("Rally is shutting down");
			browser.owner(event);
			return publishIdentity(supervisor.identity.setAvatar(readAvatar(selected.filePaths[0])));
		});
		handle(IpcChannel.memoryOpen, async (_event, file?: unknown) => {
			const error = await shell.openPath(supervisor.memory.prepareOpen(file));
			if (error) throw new Error(error);
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

		handle(IpcChannel.workspacePick, async (event) => {
			const win = senderWindow(event);
			const options = { title: "选择目录", properties: ["openDirectory", "createDirectory"] as ("openDirectory" | "createDirectory")[] };
			const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
			return result.canceled ? null : result.filePaths[0] ?? null;
		});

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
