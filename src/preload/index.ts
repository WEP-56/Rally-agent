// Preload (sandboxed, CommonJS output): exposes the typed Rally API on window.rally.

import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { type ChatEvent, IpcChannel, IpcEvent, type RallyApi, type TaskEvent } from "../shared/ipc";

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
	chat: {
		getState: () => ipcRenderer.invoke(IpcChannel.chatState),
		send: (text) => ipcRenderer.invoke(IpcChannel.chatSend, text),
		abort: () => ipcRenderer.invoke(IpcChannel.chatAbort),
		reset: () => ipcRenderer.invoke(IpcChannel.chatReset),
		onEvent: (listener) => {
			const handler = (_event: IpcRendererEvent, event: ChatEvent) => listener(event);
			ipcRenderer.on(IpcEvent.chat, handler);
			return () => ipcRenderer.off(IpcEvent.chat, handler);
		},
	},
	tasks: {
		getState: () => ipcRenderer.invoke(IpcChannel.tasksState),
		approve: (taskId) => ipcRenderer.invoke(IpcChannel.tasksApprove, taskId),
		cancel: (taskId) => ipcRenderer.invoke(IpcChannel.tasksCancel, taskId),
		setAutoApprove: (enabled) => ipcRenderer.invoke(IpcChannel.tasksApprovalMode, enabled),
		onEvent: (listener) => {
			const handler = (_event: IpcRendererEvent, event: TaskEvent) => listener(event);
			ipcRenderer.on(IpcEvent.task, handler);
			return () => ipcRenderer.off(IpcEvent.task, handler);
		},
	},
	models: {
		getState: () => ipcRenderer.invoke(IpcChannel.modelsState),
		save: (providers) => ipcRenderer.invoke(IpcChannel.modelsSave, providers),
		fetchModels: (input) => ipcRenderer.invoke(IpcChannel.modelsFetch, input),
		select: (input) => ipcRenderer.invoke(IpcChannel.modelsSelect, input),
		selectWorker: (input) => ipcRenderer.invoke(IpcChannel.modelsSelectWorker, input),
	},
};

contextBridge.exposeInMainWorld("rally", api);
