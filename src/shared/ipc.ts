// IPC contract shared by main, preload and renderer: channel names and the typed API the preload exposes.

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
	/** ~/.rally/state: events, snapshot, audit, job logs. */
	stateDir: string;
	/** ~/.rally/memory/MEMORY.md */
	memoryFile: string;
	/** ~/rally: default workspace. */
	workspaceDir: string;
}

/** Invoke channels (renderer -> main, request/response). */
export const IpcChannel = {
	appInfo: "app:info",
	windowMinimize: "window:minimize",
	windowToggleMaximize: "window:toggle-maximize",
	windowClose: "window:close",
	windowIsMaximized: "window:is-maximized",
} as const;

/** Event channels (main -> renderer). */
export const IpcEvent = {
	windowMaximizedChanged: "window:maximized-changed",
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

/** API exposed on `window.rally` by the preload script. */
export interface RallyApi {
	getAppInfo(): Promise<AppInfo>;
	window: WindowApi;
}
