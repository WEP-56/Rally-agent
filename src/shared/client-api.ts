import { type ChatEvent, IpcChannel, IpcEvent, type RallyApi, type TaskEvent } from "./ipc.ts";
import type { WorkspaceState } from "./workspace.ts";
import type { ServicesState } from "./services.ts";
import type { BrowserEvent } from "./browser.ts";
import type { TerminalEvent } from "./terminal.ts";
import type { IdentityState } from "./identity.ts";
import type { ResourceSaveProgress } from "./resources.ts";

export interface ClientTransport {
	invoke<T>(channel: string, ...args: unknown[]): Promise<T>;
	send(channel: string): void;
	on<T>(channel: string, handler: (event: unknown, data: T) => void): void;
	off<T>(channel: string, handler: (event: unknown, data: T) => void): void;
}
export function createApi(ipcRenderer: ClientTransport): RallyApi {
	return {
		agentBrowser: {
			getState: () => ipcRenderer.invoke(IpcChannel.agentBrowserState),
			frame: (id, preview) => ipcRenderer.invoke(IpcChannel.agentBrowserFrame, id, preview),
			take: id => ipcRenderer.invoke(IpcChannel.agentBrowserTake, id),
			handBack: id => ipcRenderer.invoke(IpcChannel.agentBrowserReturn, id),
			input: (id, { epoch, document, seq }, input) => ipcRenderer.invoke(IpcChannel.agentBrowserInput, id, { epoch, document, seq }, input),
			disconnect: id => ipcRenderer.invoke(IpcChannel.agentBrowserDisconnect, id),
			heartbeat: id => ipcRenderer.invoke(IpcChannel.agentBrowserHeartbeat, id),
		},
		credentials: {
			getState: () => ipcRenderer.invoke(IpcChannel.credentialsState),
			submit: input => ipcRenderer.invoke(IpcChannel.credentialsSubmit, input),
			cancel: id => ipcRenderer.invoke(IpcChannel.credentialsCancel, id),
			update: (id, enabled) => ipcRenderer.invoke(IpcChannel.credentialsUpdate, id, enabled),
			remove: id => ipcRenderer.invoke(IpcChannel.credentialsRemove, id),
			replace: (id, input) => ipcRenderer.invoke(IpcChannel.credentialsReplace, id, input),
			clearLogin: () => ipcRenderer.invoke(IpcChannel.credentialsClearLogin),
		},
		desktop: { getState: () => ipcRenderer.invoke(IpcChannel.desktopState), update: value => ipcRenderer.invoke(IpcChannel.desktopUpdate, value), setOpenAtLogin: value => ipcRenderer.invoke(IpcChannel.desktopSetOpenAtLogin, value) },
		resources: {
			begin: input => ipcRenderer.invoke(IpcChannel.resourceBegin, input),
			status: id => ipcRenderer.invoke(IpcChannel.resourceStatus, id),
			append: (id, offset, bytes) => ipcRenderer.invoke(IpcChannel.resourceAppend, id, offset, bytes),
			complete: id => ipcRenderer.invoke(IpcChannel.resourceComplete, id),
			cancel: id => ipcRenderer.invoke(IpcChannel.resourceCancel, id),
			get: id => ipcRenderer.invoke(IpcChannel.resourceGet, id),
			preview: (id, thumbnail) => ipcRenderer.invoke(IpcChannel.resourcePreview, id, thumbnail),
			save: (id, downloadId) => ipcRenderer.invoke(IpcChannel.resourceSave, id, downloadId),
			cancelSave: id => ipcRenderer.invoke(IpcChannel.resourceCancelSave, id),
			onSave: listener => {
				const handler = (_event: unknown, progress: ResourceSaveProgress) => listener(progress);
				ipcRenderer.on(IpcEvent.resourceSave, handler); return () => ipcRenderer.off(IpcEvent.resourceSave, handler);
			},
		},
		connectorTools: {
			getState: connector => ipcRenderer.invoke(IpcChannel.connectorToolsState, connector),
			setTier: (connector, name, tier) => ipcRenderer.invoke(IpcChannel.connectorToolsTier, connector, name, tier),
		},
		ssh: {
			getState: () => ipcRenderer.invoke(IpcChannel.sshState),
			save: input => ipcRenderer.invoke(IpcChannel.sshSave, input),
			verify: (id, fingerprint) => fingerprint === undefined ? ipcRenderer.invoke(IpcChannel.sshVerify, id) : ipcRenderer.invoke(IpcChannel.sshVerify, id, fingerprint),
			update: (id, enabled) => ipcRenderer.invoke(IpcChannel.sshUpdate, id, enabled),
			remove: id => ipcRenderer.invoke(IpcChannel.sshRemove, id),
		},
		qqMail: {
			getState: () => ipcRenderer.invoke(IpcChannel.qqMailState),
			save: (credentials) => ipcRenderer.invoke(IpcChannel.qqMailSave, credentials),
			verify: () => ipcRenderer.invoke(IpcChannel.qqMailVerify),
			disconnect: () => ipcRenderer.invoke(IpcChannel.qqMailDisconnect),
		},
		qqBot: {
			getState: () => ipcRenderer.invoke(IpcChannel.qqBotState),
			save: (input) => ipcRenderer.invoke(IpcChannel.qqBotSave, input),
			retry: () => ipcRenderer.invoke(IpcChannel.qqBotRetry),
			pair: () => ipcRenderer.invoke(IpcChannel.qqBotPair),
			disconnect: () => ipcRenderer.invoke(IpcChannel.qqBotDisconnect),
		},
		feishu: {
			getState: () => ipcRenderer.invoke(IpcChannel.feishuState),
			save: (input) => ipcRenderer.invoke(IpcChannel.feishuSave, input),
			retry: () => ipcRenderer.invoke(IpcChannel.feishuRetry),
			pair: () => ipcRenderer.invoke(IpcChannel.feishuPair),
			setTools: (enabled) => ipcRenderer.invoke(IpcChannel.feishuTools, enabled),
			disconnect: () => ipcRenderer.invoke(IpcChannel.feishuDisconnect),
		},
		identity: {
			getState: () => ipcRenderer.invoke(IpcChannel.identityState),
			initialize: (legacy) => ipcRenderer.invoke(IpcChannel.identityInitialize, legacy),
			update: (patch) => ipcRenderer.invoke(IpcChannel.identityUpdate, patch),
			pickAvatar: () => ipcRenderer.invoke(IpcChannel.identityPickAvatar),
			resetAvatar: () => ipcRenderer.invoke(IpcChannel.identityResetAvatar),
			onChange: (listener) => {
				const handler = (_event: unknown, state: IdentityState) => listener(state);
				ipcRenderer.on(IpcEvent.identity, handler);
				return () => ipcRenderer.off(IpcEvent.identity, handler);
			},
		},
		schedules: {
			getState: () => ipcRenderer.invoke(IpcChannel.schedulesState),
			update: (id, enabled) => ipcRenderer.invoke(IpcChannel.schedulesUpdate, id, enabled),
		},
		notifications: {
			getState: () => ipcRenderer.invoke(IpcChannel.notificationsState),
			update: (value) => ipcRenderer.invoke(IpcChannel.notificationsUpdate, value),
			takeTarget: () => ipcRenderer.invoke(IpcChannel.notificationsTarget),
			onClick: (listener) => {
				const handler = () => listener();
				ipcRenderer.on(IpcEvent.notification, handler);
				return () => ipcRenderer.off(IpcEvent.notification, handler);
			},
		},
		terminal: {
			create: (id, size, taskId) => ipcRenderer.invoke(IpcChannel.terminalCreate, id, size, taskId),
			write: (id, data) => ipcRenderer.invoke(IpcChannel.terminalWrite, id, data),
			resize: (id, size) => ipcRenderer.invoke(IpcChannel.terminalResize, id, size),
			ack: (id, seq) => ipcRenderer.invoke(IpcChannel.terminalAck, id, seq),
			close: (id) => ipcRenderer.invoke(IpcChannel.terminalClose, id),
			openLink: (url) => ipcRenderer.invoke(IpcChannel.terminalOpenLink, url),
			onEvent: (listener) => {
				const handler = (_event: unknown, event: TerminalEvent) => listener(event);
				ipcRenderer.on(IpcEvent.terminal, handler);
				return () => ipcRenderer.off(IpcEvent.terminal, handler);
			},
		},
		browser: {
			create: (id, url) => ipcRenderer.invoke(IpcChannel.browserCreate, id, url),
			navigate: (id, url) => ipcRenderer.invoke(IpcChannel.browserNavigate, id, url),
			action: (id, action) => ipcRenderer.invoke(IpcChannel.browserAction, id, action),
			layout: (layout) => ipcRenderer.invoke(IpcChannel.browserLayout, layout),
			close: (id) => ipcRenderer.invoke(IpcChannel.browserClose, id),
			onEvent: (listener) => {
				const handler = (_event: unknown, event: BrowserEvent) => listener(event);
				ipcRenderer.on(IpcEvent.browser, handler);
				return () => ipcRenderer.off(IpcEvent.browser, handler);
			},
		},
		services: {
			getState: () => ipcRenderer.invoke(IpcChannel.servicesState),
			stop: (id) => ipcRenderer.invoke(IpcChannel.servicesStop, id),
			onChange: (listener) => {
				const handler = (_event: unknown, state: ServicesState) => listener(state);
				ipcRenderer.on(IpcEvent.services, handler);
				return () => ipcRenderer.off(IpcEvent.services, handler);
			},
		},
		coach: { getState: () => ipcRenderer.invoke(IpcChannel.coachState), update: patch => ipcRenderer.invoke(IpcChannel.coachUpdate, patch) },
		userSeen: () => ipcRenderer.invoke(IpcChannel.userSeen),
		memory: {
			getState: () => ipcRenderer.invoke(IpcChannel.memoryState),
			open: (file) => ipcRenderer.invoke(IpcChannel.memoryOpen, file),
		},
		gates: { decide: (id, decision) => ipcRenderer.invoke(IpcChannel.gateDecide, id, decision) },
		mcp: {
			getState: () => ipcRenderer.invoke(IpcChannel.mcpState),
			save: (json, revision) => ipcRenderer.invoke(IpcChannel.mcpSave, json, revision),
			saveServer: (name, json, originalName, revision) =>
				ipcRenderer.invoke(IpcChannel.mcpSaveServer, name, json, originalName, revision),
			update: (name, enabled) => ipcRenderer.invoke(IpcChannel.mcpUpdate, name, enabled),
			setTier: (name, tier) => ipcRenderer.invoke(IpcChannel.mcpTier, name, tier),
			setExposure: (name, exposure, tool) => ipcRenderer.invoke(IpcChannel.mcpExposure, name, exposure, tool),
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
				const handler = (_event: unknown, maximized: boolean) => listener(maximized);
				ipcRenderer.on(IpcEvent.windowMaximizedChanged, handler);
				return () => ipcRenderer.off(IpcEvent.windowMaximizedChanged, handler);
			},
		},
		chat: {
			getState: () => ipcRenderer.invoke(IpcChannel.chatState),
			send: (text, attachments) => ipcRenderer.invoke(IpcChannel.chatSend, text, attachments),
			abort: () => ipcRenderer.invoke(IpcChannel.chatAbort),
			inbox: input => ipcRenderer.invoke(IpcChannel.chatInbox, input),
			reset: () => ipcRenderer.invoke(IpcChannel.chatReset),
			newConversation: () => ipcRenderer.invoke(IpcChannel.chatNewConversation),
			onEvent: (listener) => {
				const handler = (_event: unknown, event: ChatEvent) => listener(event);
				ipcRenderer.on(IpcEvent.chat, handler);
				return () => ipcRenderer.off(IpcEvent.chat, handler);
			},
		},
		tasks: {
			getState: () => ipcRenderer.invoke(IpcChannel.tasksState),
			approve: (taskId) => ipcRenderer.invoke(IpcChannel.tasksApprove, taskId),
			cancel: (taskId) => ipcRenderer.invoke(IpcChannel.tasksCancel, taskId),
			archive: (taskId, archived) => ipcRenderer.invoke(IpcChannel.tasksArchive, taskId, archived),
			deleteArchived: (taskId) => ipcRenderer.invoke(IpcChannel.tasksDelete, taskId),
			answerOption: (taskId, questionId, option) =>
				ipcRenderer.invoke(IpcChannel.tasksAnswerOption, taskId, questionId, option),
			setAutoApprove: (enabled) => ipcRenderer.invoke(IpcChannel.tasksApprovalMode, enabled),
			onEvent: (listener) => {
				const handler = (_event: unknown, event: TaskEvent) => listener(event);
				ipcRenderer.on(IpcEvent.task, handler);
				return () => ipcRenderer.off(IpcEvent.task, handler);
			},
		},
		toolProviders: {
			getState: () => ipcRenderer.invoke(IpcChannel.toolProvidersState),
			save: update => ipcRenderer.invoke(IpcChannel.toolProvidersSave, update),
		},
		models: {
			getState: () => ipcRenderer.invoke(IpcChannel.modelsState),
			save: (providers, revision) => ipcRenderer.invoke(IpcChannel.modelsSave, providers, revision),
			fetchModels: (input) => ipcRenderer.invoke(IpcChannel.modelsFetch, input),
			select: (input) => ipcRenderer.invoke(IpcChannel.modelsSelect, input),
			selectWorker: (input) => ipcRenderer.invoke(IpcChannel.modelsSelectWorker, input),
		},
		roleWorkers: {
			getState: () => ipcRenderer.invoke(IpcChannel.roleWorkersState),
			getAgentModels: executor => ipcRenderer.invoke(IpcChannel.roleWorkersAgentModels, executor),
			save: role => ipcRenderer.invoke(IpcChannel.roleWorkersSave, role),
			delete: id => ipcRenderer.invoke(IpcChannel.roleWorkersDelete, id),
		},
		workspace: {
			getState: () => ipcRenderer.invoke(IpcChannel.workspaceState),
			update: (patch) => ipcRenderer.invoke(IpcChannel.workspaceUpdate, patch),
			pickDirectory: () => ipcRenderer.invoke(IpcChannel.workspacePick),
			onChange: (listener) => {
				const handler = (_event: unknown, state: WorkspaceState) => listener(state);
				ipcRenderer.on(IpcEvent.workspace, handler);
				return () => ipcRenderer.off(IpcEvent.workspace, handler);
			},
		},
	};
}
