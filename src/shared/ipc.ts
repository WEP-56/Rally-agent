import type { ScheduledTask } from "./schedules.ts";
import type { ToolProviderState, ToolProviderUpdate } from "./tool-providers.ts";
import type { ResourceApi, ResourceRef } from "./resources.ts";
import type { CloseBehavior, DesktopSettings } from "./desktop.ts";
import type { FeishuConnectionState, FeishuCredentials, ImBotCredentials, ImBotState, ImSource, QqMailCredentials, QqMailState } from "./connections.ts";
import type { IdentityState, IdentityText } from "./identity.ts";
// IPC contract shared by main, preload and renderer: channel names and the typed API the preload exposes.

import type { NotificationSettings, NotificationTarget } from "./notifications.ts";
import type { FetchModelsInput, FetchModelsResult, ModelsState, ProviderEntry, SelectModelInput } from "./models.ts";
import type { TaskBoard, TaskView } from "./task.ts";
import type { WorkspacePatch, WorkspaceState } from "./workspace.ts";
import type { ToolCall } from "./tools.ts";
import type { AssistantBlock } from "./conversation.ts";
import type { SkillsState } from "./skills.ts";
import type { ProjectTrustState } from "./trust.ts";
import type { McpConfigurationState, McpExposure, McpRiskTier } from "./mcp.ts";
import type { CoachSettings } from "./coach.ts";
import type { MemoryFileKey, MemoryState } from "./memory.ts";
import type { ServicesState } from "./services.ts";
import type { BrowserState, BrowserLayout, BrowserAction, BrowserEvent } from "./browser.ts";
import type { CredentialState, CredentialSubmission } from "./credentials.ts";
import type { AgentBrowserWindow, BrowserFrame, BrowserUserInput } from "./agent-browser.ts";
import type { TerminalSize, TerminalState, TerminalEvent } from "./terminal.ts";

/** Basic facts about the running app, shown in the shell and used by smoke checks. */
export interface AppInfo {
	name: string;
	version: string;
	platform: string;
	versions: { electron: string; chrome: string; node: string };
	paths: RallyPaths;
}

/** Rally's on-disk layout (docs/superagent/04 section 1). */
export interface RallyPaths {
	/** ~/.rally: system-owned state. */
	home: string;
	/** ~/.rally/agent: Pi agent dir (settings, models, auth, mcp, skills, sessions). */
	agentDir: string;
	/** ~/.rally/agent/main: fixed cwd of the main session. */
	mainCwd: string;
	/** ~/.rally/agent/sessions: per-role session files. */
	sessionsDir: string;
	/** ~/.rally/agent/sessions/main: main-session segments. */
	sessionsMainDir: string;
	/** ~/.rally/agent/sessions/tasks: one session file per task. */
	sessionsTasksDir: string;
	/** ~/.rally/agent/rally-models.json: Rally's own provider/model config (never Pi's models.json). */
	modelsFile: string;
	/** ~/.rally/state: events, snapshot, audit, job logs. */
	stateDir: string;
	/** ~/.rally/state/events-0001.jsonl: first segment of the append-only event stream. */
	eventsFile: string;
	/** ~/.rally/state/snapshot.json: derived state rebuild cache. */
	snapshotFile: string;
	/** ~/.rally/state/audit.jsonl: tool / approval / gate audit trail. */
	auditFile: string;
	/** ~/.rally/state/jobs: background command logs. */
	jobsDir: string;
	/** ~/.rally/memory */
	memoryDir: string;
	/** ~/rally: default workspace. */
	workspaceDir: string;
}

/** Invoke channels (renderer -> main, request/response). */
export const IpcChannel = {
	agentBrowserState: "agent-browser:state",
	agentBrowserFrame: "agent-browser:frame",
	agentBrowserTake: "agent-browser:take",
	agentBrowserReturn: "agent-browser:return",
	agentBrowserInput: "agent-browser:input",
	agentBrowserDisconnect: "agent-browser:disconnect",
	agentBrowserHeartbeat: "agent-browser:heartbeat",
	credentialsState: "credentials:state",
	credentialsSubmit: "credentials:submit",
	credentialsCancel: "credentials:cancel",
	credentialsUpdate: "credentials:update",
	credentialsRemove: "credentials:remove",
	credentialsReplace: "credentials:replace",
	credentialsClearLogin: "credentials:clear-login",
	resourceBegin: "resources:begin",
	resourceStatus: "resources:status",
	resourceAppend: "resources:append",
	resourceComplete: "resources:complete",
	resourceCancel: "resources:cancel",
	resourceGet: "resources:get",
	resourcePreview: "resources:preview",
	resourceSave: "resources:save",
	resourceCancelSave: "resources:cancel-save",
	connectionUpload: "connection:upload",
	connectionSave: "connection:save-resource",
	connectionCancelSave: "connection:cancel-save",
	connectionState: "connection:state",
	connectionSelect: "connection:select",
	connectionRequest: "connection:request",
	qqMailState: "qqmail:state",
	qqMailSave: "qqmail:save",
	qqMailVerify: "qqmail:verify",
	qqMailDisconnect: "qqmail:disconnect",
	qqBotState: "qqbot:state",
	qqBotSave: "qqbot:save",
	qqBotRetry: "qqbot:retry",
	qqBotPair: "qqbot:pair",
	qqBotDisconnect: "qqbot:disconnect",
	feishuState: "feishu:state",
	feishuSave: "feishu:save",
	feishuRetry: "feishu:retry",
	feishuPair: "feishu:pair",
	feishuTools: "feishu:tools",
	feishuDisconnect: "feishu:disconnect",
	identityState: "identity:state",
	identityInitialize: "identity:initialize",
	identityUpdate: "identity:update",
	identityPickAvatar: "identity:pick-avatar",
	identityResetAvatar: "identity:reset-avatar",
	schedulesState: "schedules:state",
	schedulesUpdate: "schedules:update",
	notificationsState: "notifications:state",
	notificationsUpdate: "notifications:update",
	notificationsTarget: "notifications:target",
	browserCreate: "browser:create",
	terminalCreate: "terminal:create",
	terminalWrite: "terminal:write",
	terminalResize: "terminal:resize",
	terminalAck: "terminal:ack",
	terminalClose: "terminal:close",
	terminalOpenLink: "terminal:open-link",
	browserNavigate: "browser:navigate",
	browserAction: "browser:action",
	browserLayout: "browser:layout",
	browserClose: "browser:close",
	servicesState: "services:state",
	servicesStop: "services:stop",
	coachState: "coach:state",
	coachUpdate: "coach:update",
	userSeen: "user:seen",
	memoryState: "memory:state",
	memoryOpen: "memory:open",
	appInfo: "app:info",
	windowMinimize: "window:minimize",
	windowToggleMaximize: "window:toggle-maximize",
	windowClose: "window:close",
	windowIsMaximized: "window:is-maximized",
	desktopState: "desktop:state",
	desktopUpdate: "desktop:update",
	desktopSetOpenAtLogin: "desktop:setOpenAtLogin",
	chatState: "chat:state",
	chatSend: "chat:send",
	chatAbort: "chat:abort",
	chatReset: "chat:reset",
	chatNewConversation: "chat:newConversation",
	tasksState: "tasks:state",
	tasksApprove: "tasks:approve",
	tasksCancel: "tasks:cancel",
	tasksArchive: "tasks:archive",
	tasksDelete: "tasks:delete",
	tasksAnswerOption: "tasks:answer-option",
	tasksApprovalMode: "tasks:approval-mode",
	toolProvidersState: "tool-providers:state",
	toolProvidersSave: "tool-providers:save",
	modelsState: "models:state",
	modelsSave: "models:save",
	modelsFetch: "models:fetch",
	modelsSelect: "models:select",
	modelsSelectWorker: "models:select-worker",
	workspaceState: "workspace:state",
	workspaceUpdate: "workspace:update",
	workspacePick: "workspace:pick",
	skillsState: "skills:state",
	skillsImport: "skills:import",
	skillsEnable: "skills:enable",
	trustState: "trust:state",
	trustSet: "trust:set",
	mcpState: "mcp:state",
	mcpSave: "mcp:save",
	mcpSaveServer: "mcp:save-server",
	mcpUpdate: "mcp:update",
	mcpTier: "mcp:tier",
	mcpExposure: "mcp:exposure",
	gateDecide: "gate:decide",
} as const;

/** Event channels (main -> renderer). */
export const IpcEvent = {
	resourceSave: "resources:save-progress",
	identity: "identity:changed",
	notification: "notifications:event",
	browser: "browser:event",
	terminal: "terminal:event",
	services: "services:event",
	windowMaximizedChanged: "window:maximized-changed",
	chat: "chat:event",
	task: "task:event",
	workspace: "workspace:event",
} as const;

/** Frameless window controls; the title bar is drawn by the renderer. */
export interface WindowApi {
	minimize(): void;
	toggleMaximize(): void;
	close(): void;
	isMaximized(): Promise<boolean>;
	/** Subscribe to maximize/restore changes. Returns an unsubscribe function. */
	onMaximizedChange(listener: (maximized: boolean) => void): () => void;
}

/** A chat line shown in the main conversation. `id` is the global "#123" counter (docs 01 section 6). */
export type ChatRole = "user" | "assistant" | "system";

export interface ChatLine {
	attachments?: ResourceRef[];
	source?: ImSource;
	relayId?: string;
	blocks?: AssistantBlock[];
	toolCalls?: ToolCall[];
	id: string;
	role: ChatRole;
	text: string;
	at: number;
	streaming: boolean;
}

export type ChatActivity = "thinking" | "replying" | "querying" | "planning" | "orchestrating" | "compacting";

export interface ChatHeaderState {
	activity: ChatActivity | null;
	showCompact: boolean;
	showNewConversation: boolean;
}

/** Snapshot of the main conversation; sent on subscribe and after resets. */
export interface ChatState {
	messages: ChatLine[];
	header: ChatHeaderState;
	conversation?: { id: string; at: number };
	busy: boolean;
	/** "provider/model" of the main session, or null when no model is configured. */
	model: string | null;
	/** Active thinking level of the main session, or null without a model. */
	thinkingLevel: string | null;
	/** Levels the current model accepts; empty when it does not support thinking. */
	thinkingLevels: string[];
	/** Non-fatal startup warning, e.g. the saved model is gone. */
	notice: string | null;
}

/** Incremental updates pushed from main; `message` is an upsert keyed by id. */
export type ChatEvent =
	| { type: "snapshot"; state: ChatState }
	| { type: "message"; message: ChatLine }
	| { type: "busy"; busy: boolean }
	| { type: "header"; header: ChatHeaderState };

/** Main-conversation API. Only the main agent talks to the user (docs 01 section 4.6). */
export interface ChatApi {
	getState(): Promise<ChatState>;
	send(text: string, attachments?: string[]): Promise<void>;
	abort(): Promise<void>;
	/** Compact context without clearing the conversation. */
	reset(): Promise<boolean>;
	newConversation(): Promise<void>;
	onEvent(listener: (event: ChatEvent) => void): () => void;
}

/** Task board updates pushed from main; `task` upserts one card. */
export type TaskEvent = { type: "snapshot"; board: TaskBoard } | { type: "task"; task: TaskView } | { type: "deleted"; taskId: string; board: TaskBoard };

/** Task board and explicit user actions, including selected and typed question answers. */
export interface TasksApi {
	getState(): Promise<TaskBoard>;
	/** The user's explicit click on a dispatch card; no quote needed (docs 01 §4.1). */
	approve(taskId: string): Promise<TaskBoard>;
	cancel(taskId: string): Promise<TaskBoard>;
	archive(taskId: string, archived: boolean): Promise<TaskBoard>;
	deleteArchived(taskId: string): Promise<TaskBoard>;
	answerOption(taskId: string, questionId: string, option: string): Promise<TaskBoard>;
	setAutoApprove(enabled: boolean): Promise<TaskBoard>;
	onEvent(listener: (event: TaskEvent) => void): () => void;
}

/** Provider config + main-session model switching (M1-C). */
export interface ModelsApi {
	getState(): Promise<ModelsState>;
	/** Replace the whole provider list; returns what actually registered plus errors. */
	save(providers: ProviderEntry[], revision?: string): Promise<ModelsState>;
	/** Ask the provider for its model list; failures are returned, not thrown. */
	fetchModels(input: FetchModelsInput): Promise<FetchModelsResult>;
	/** Switch the main session model (and optionally its thinking level); persists the choice. */
	select(input: SelectModelInput): Promise<ChatState>;
	selectWorker(input: SelectModelInput): Promise<ModelsState>;
}

/** API exposed on `window.rally` by the preload script. */
export interface RallyApi {
	agentBrowser: {
		getState(): Promise<AgentBrowserWindow[]>;
		frame(id: string, preview?: boolean): Promise<BrowserFrame>;
		take(id: string): Promise<AgentBrowserWindow>;
		handBack(id: string): Promise<AgentBrowserWindow>;
		input(id: string, frame: Pick<BrowserFrame, "epoch" | "document" | "seq">, input: BrowserUserInput): Promise<void>;
		disconnect(id?: string): Promise<void>;
		heartbeat(id: string): Promise<void>;
	};
	credentials: {
		getState(): Promise<CredentialState>;
		submit(input: CredentialSubmission): Promise<CredentialState>;
		cancel(id: string): Promise<CredentialState>;
		update(id: string, enabled: boolean): Promise<CredentialState>;
		remove(id: string): Promise<CredentialState>;
		replace(id: string, input: { username: string; password: string }): Promise<CredentialState>;
		clearLogin(): Promise<void>;
	};
	resources: ResourceApi;
	qqMail: {
		getState(): Promise<QqMailState>;
		save(credentials: QqMailCredentials): Promise<QqMailState>;
		verify(): Promise<QqMailState>;
		disconnect(): Promise<QqMailState>;
	};
	qqBot: {
		getState(): Promise<ImBotState>;
		save(credentials: ImBotCredentials): Promise<ImBotState>;
		retry(): Promise<ImBotState>;
		pair(): Promise<ImBotState>;
		disconnect(): Promise<ImBotState>;
	};
	feishu: {
		getState(): Promise<FeishuConnectionState>;
		save(credentials: FeishuCredentials): Promise<FeishuConnectionState>;
		retry(): Promise<FeishuConnectionState>;
		pair(): Promise<FeishuConnectionState>;
		setTools(enabled: boolean): Promise<FeishuConnectionState>;
		disconnect(): Promise<FeishuConnectionState>;
	};
	identity: {
		getState(): Promise<IdentityState>;
		initialize(legacy: IdentityText): Promise<IdentityState>;
		update(patch: Partial<IdentityText>): Promise<IdentityState>;
		pickAvatar(): Promise<IdentityState | null>;
		resetAvatar(): Promise<IdentityState>;
		onChange(listener: (state: IdentityState) => void): () => void;
	};
	schedules: { getState(): Promise<ScheduledTask[]>; update(id: string, enabled: boolean | null): Promise<ScheduledTask[]> };
	notifications: {
		getState(): Promise<NotificationSettings>;
		update(value: NotificationSettings): Promise<NotificationSettings>;
		takeTarget(): Promise<NotificationTarget | null>;
		onClick(listener: () => void): () => void;
	};
	terminal: {
		create(id: string, size: TerminalSize, taskId?: string): Promise<TerminalState>;
		write(id: string, data: string): Promise<void>;
		resize(id: string, size: TerminalSize): Promise<void>;
		ack(id: string, seq: number): Promise<void>;
		close(id: string): Promise<void>;
		openLink(url: string): Promise<void>;
		onEvent(listener: (event: TerminalEvent) => void): () => void;
	};
	browser: {
		create(id: string, url?: string): Promise<BrowserState>;
		navigate(id: string, url: string): Promise<BrowserState>;
		action(id: string, action: BrowserAction): Promise<BrowserState>;
		layout(layout: BrowserLayout): Promise<void>;
		close(id: string): Promise<void>;
		onEvent(listener: (event: BrowserEvent) => void): () => void;
	};
	services: { getState(): Promise<ServicesState>; stop(id: string): Promise<ServicesState>; onChange(listener: (state: ServicesState) => void): () => void };
	coach: { getState(): Promise<CoachSettings>; update(patch: Partial<CoachSettings>): Promise<CoachSettings> };
	userSeen(): Promise<void>;
	memory: { getState(): Promise<MemoryState>; open(file?: MemoryFileKey): Promise<void> };
	gates: { decide(id: string, decision: "allow" | "deny"): Promise<TaskBoard> };
	mcp: {
		saveServer(name: string, json: string, originalName?: string, revision?: string): Promise<McpConfigurationState>;
		getState(): Promise<McpConfigurationState>;
		save(json: string, revision?: string): Promise<McpConfigurationState>;
		update(name: string, enabled: boolean | null): Promise<McpConfigurationState>;
		setTier(name: string, tier: McpRiskTier): Promise<McpConfigurationState>;
		setExposure(name: string, exposure: McpExposure | null, tool?: string): Promise<McpConfigurationState>;
	};
	trust: {
		getState(): Promise<ProjectTrustState>;
		set(path: string, trusted: boolean): Promise<ProjectTrustState>;
	};
	skills: {
		getState(): Promise<SkillsState>;
		importDirectory(path: string): Promise<SkillsState>;
		setEnabled(path: string, enabled: boolean): Promise<SkillsState>;
	};
	getAppInfo(): Promise<AppInfo>;
	desktop: { getState(): Promise<DesktopSettings>; update(behavior: CloseBehavior): Promise<DesktopSettings>; setOpenAtLogin(enabled: boolean): Promise<DesktopSettings> };
	window: WindowApi;
	chat: ChatApi;
	tasks: TasksApi;
	toolProviders: { getState(): Promise<ToolProviderState>; save(update: ToolProviderUpdate): Promise<ToolProviderState> };
	models: ModelsApi;
	workspace: {
		getState(): Promise<WorkspaceState>;
		update(patch: WorkspacePatch): Promise<WorkspaceState>;
		pickDirectory(): Promise<string | null>;
		onChange(listener: (state: WorkspaceState) => void): () => void;
	};
}
