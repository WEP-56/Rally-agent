// Preload (sandboxed, CommonJS output): exposes the typed Rally API on window.rally.

import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { IpcChannel, IpcEvent, type RallyApi } from "../shared/ipc";

const api: RallyApi = {
	getAppInfo: () => ipcRenderer.invoke(IpcChannel.appInfo),
	window: {
		minimize: () => ipcRenderer.send(IpcChannel.windowMinimize),
		toggleMaximize: () => ipcRenderer.send(IpcChannel.windowToggleMaximize),
		close: () => ipcRenderer.send(IpcChannel.windowClose),
		isMaximized: () => ipcRenderer.invoke(IpcChannel.windowIsMaximized),
		onMaximizedChange: (listener) => {
			const handler = (_event: IpcRendererEvent, maximized: boolean) => listener(maximized);
			ipcRenderer.on(IpcEvent.windowMaximizedChanged, handler);
			return () => ipcRenderer.off(IpcEvent.windowMaximizedChanged, handler);
		},
	},
};

contextBridge.exposeInMainWorld("rally", api);
