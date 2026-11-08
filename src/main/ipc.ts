// Main-process IPC handlers. Every channel is declared in src/shared/ipc.ts.

import { app, BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain } from "electron";
import { type AppInfo, IpcChannel, IpcEvent, type RallyPaths } from "../shared/ipc";

/** Register all IPC handlers. Call once after app ready. */
export function registerIpc(paths: RallyPaths): void {
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
