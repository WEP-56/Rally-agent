// Preload (sandboxed, CommonJS output): exposes the typed Rally API on window.rally.

import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";
import { type ChatEvent, IpcChannel, IpcEvent, type RallyApi, type TaskEvent } from "../shared/ipc";
import type { WorkspaceState } from "../shared/workspace";

const api: RallyApi = {
	memory: {
		getState: () => ipcRenderer.invoke(IpcChannel.memoryState),
		setPath: (path) => ipcRenderer.invoke(IpcChannel.memoryPath, path),
		open: () => ipcRenderer.invoke(IpcChannel.memoryOpen),
		pickFile: () => ipcRenderer.invoke(IpcChannel.memoryPick),
	},
	gates: { decide: (id, decision) => ipcRenderer.invoke(IpcChannel.gateDecide, id, decision) },
	mcp: {
		getState: () => ipcRenderer.invoke(IpcChannel.mcpState),
		save: (json) => ipcRenderer.invoke(IpcChannel.mcpSave, json),
		update: (name, enabled) => ipcRenderer.invoke(IpcChannel.mcpUpdate, name, enabled),
		setTier: (name, tier) => ipcRenderer.invoke(IpcChannel.mcpTier, name, tier),
	},
	trust: {
		getState: () => ipcRenderer.invoke(IpcChannel.trustState),
		set: (path, trusted) => ipcRenderer.invoke(IpcChannel.trustSet, path, trusted),
	},
	skills: {
		getState: () => ipcRenderer.invoke(IpcChannel.skillsState),
		importDirectory: (path) => ipcRenderer.invoke(IpcChannel.skillsImport, path),
		setEnabled: (path, enabled) => ipcRenderer.invoke(IpcChannel.skillsEnable, path, enabled),
	},
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
		answerOption: (taskId, questionId, option) => ipcRenderer.invoke(IpcChannel.tasksAnswerOption, taskId, questionId, option),
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
	workspace: {
		getState: () => ipcRenderer.invoke(IpcChannel.workspaceState),
		update: (patch) => ipcRenderer.invoke(IpcChannel.workspaceUpdate, patch),
		pickDirectory: () => ipcRenderer.invoke(IpcChannel.workspacePick),
		onChange: (listener) => {
			const handler = (_event: IpcRendererEvent, state: WorkspaceState) => listener(state);
			ipcRenderer.on(IpcEvent.workspace, handler);
			return () => ipcRenderer.off(IpcEvent.workspace, handler);
		},
	},
};

contextBridge.exposeInMainWorld("rally", api);
