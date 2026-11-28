// Electron main entry: single-instance lock, Rally paths, main window. `RALLY_SMOKE=1` runs the M0 smoke check and exits.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { registerClientBrowser } from "./browser.ts";
import { connectionHost } from "./connection-host.ts";
import { desktopHost } from "./desktop-host.ts";
import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog, nativeTheme, safeStorage, screen, shell } from "electron";
import { broadcastChat, broadcastTask, broadcastWorkspace, broadcastServices, forwardWindowState, registerIpc } from "./ipc.ts";
import { ensureRallyDirs, resolveRallyPaths } from "./paths.ts";
import { runSmoke } from "./smoke.ts";
import { Supervisor } from "./supervisor/index.ts";
import { StateDirectoryLock } from "./supervisor/state-lock.ts";
import { ApplicationShutdown } from "./application-shutdown.ts";
import { TaskNotifications } from "./notifications.ts";
import { applicationId, applicationIcon, applyWindowBranding, showMainWindow } from "./branding.ts";

if (process.platform === "win32") app.setAppUserModelId(applicationId());

const paths = resolveRallyPaths();

// Pi resolves ~/.rally/agent from piConfig; the env var pins it even for code paths that read it directly.
process.env.RALLY_CODING_AGENT_DIR = paths.agentDir;
process.env.RALLY_BUILTIN_SKILLS_DIR = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "skills");
process.env.RALLY_EXTERNAL_AGENTS_DIR = app.isPackaged
	? join(process.resourcesPath, "external-agents")
	: join(app.getAppPath(), "build", "external-agents");
if (app.isPackaged) process.env.RALLY_BROWSER_PATH = join(process.resourcesPath, "browser");

if (process.env.RALLY_SMOKE === "1") {
	void runSmokeAndExit();
} else if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		const win = BrowserWindow.getAllWindows()[0];
		if (!win) return;
		showMainWindow(win);
	});
	app.on("window-all-closed", () => app.quit());
	void app.whenReady().then(startApplication);
}

async function startApplication(): Promise<void> {
	let owner: BrowserWindow | undefined;
	const connection = connectionHost(existsSync(paths.agentDir), () => owner);
	let supervisor: Supervisor | undefined;
	let stopIpc: (() => Promise<void>) | undefined;
	let startupError: unknown;
	let notifications: TaskNotifications | undefined;
	let stopDesktop: (() => void) | undefined;
	const shutdown = new ApplicationShutdown({
		close: async () => {
			try { notifications?.dispose(); stopDesktop?.(); } finally {
				// Draining requests can depend on session cancellation, so start both together.
				const pending = Promise.all([stopIpc?.(), connection.close()]).then(() => {});
				if (supervisor) await supervisor.dispose(pending); else await pending;
			}
		},
		exit: code => {
			if (startupError) dialog.showErrorBox("Rally 无法启动", startupError instanceof Error ? startupError.message : String(startupError));
			app.exit(code);
		},
		report: error => console.error("Rally shutdown failed", error),
	});
	app.on("before-quit", event => { event.preventDefault(); void shutdown.run(); });
	try {
		if (connection.mode !== "local") {
			stopIpc = registerClientBrowser();
			owner = createMainWindow(connection.partition);
			stopDesktop = desktopHost(owner, () => shutdown.started, connection.mode);
			return;
		}
		// Supervisor locks the state directory before any recovery or state writes.
		supervisor = new Supervisor(paths, { emitChat: broadcastChat, emitTask: event => { broadcastTask(event); notifications?.observe(event); }, emitWorkspace: broadcastWorkspace, emitServices: broadcastServices,
			credentialVault: {
				encrypt(value) {
					if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) throw new Error("系统凭据加密不可用。");
					return safeStorage.encryptString(value);
				},
				decrypt(ciphertext) { return safeStorage.decryptString(ciphertext); },
			},
			onStartupFailure: async error => { startupError = error; await shutdown.prepare(); void shutdown.run(true); },
		});
		ensureRallyDirs(paths);
		notifications = new TaskNotifications(join(paths.home, "notifications.json"), () => BrowserWindow.getAllWindows().find(window => !window.isDestroyed()));
		stopIpc = registerIpc(paths, supervisor, notifications);
		await supervisor.start();
		if (!shutdown.started) {
			owner = createMainWindow();
			stopDesktop = desktopHost(owner, () => shutdown.started, connection.mode);
			notifications.start(supervisor.store.list().map(task => supervisor!.store.view(task)));
		}
	} catch (error) {
		startupError = error;
		await shutdown.run(true);
	}
}

async function runSmokeAndExit(): Promise<void> {
	await app.whenReady();
	let lock: StateDirectoryLock | undefined;
	let ok = false;
	try {
		lock = new StateDirectoryLock(paths.stateDir);
		ensureRallyDirs(paths);
		const result = await runSmoke(paths);
		process.stdout.write(`RALLY_SMOKE ${JSON.stringify(result, null, 2)}\n`);
		ok = result.ok;
	} catch (error) {
		process.stdout.write(`RALLY_SMOKE ${JSON.stringify({ ok: false, error: String(error) })}\n`);
	} finally { lock?.release(); }
	app.exit(ok ? 0 : 1);
}

function createMainWindow(partition?: string): BrowserWindow {
	const dark = nativeTheme.shouldUseDarkColors;
	// Frameless: the renderer draws the prototype's title bar and window controls (IPC in ipc.ts).
	const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
	const defaultWidth = Math.min(1360, Math.floor(workArea.width * 0.9));
	const defaultHeight = Math.min(860, Math.floor(workArea.height * 0.9));
	const savedSize = process.platform === "win32" ? readWindowSize() : null;
	const width = Math.min(savedSize?.width ?? defaultWidth, workArea.width);
	const height = Math.min(savedSize?.height ?? defaultHeight, workArea.height);
	const win = new BrowserWindow({
		width, height,
		x: workArea.x + Math.floor((workArea.width - width) / 2),
		y: workArea.y + Math.floor((workArea.height - height) / 2),
		minWidth: Math.min(960, width),
		minHeight: Math.min(600, height),
		show: false,
		frame: false,
		title: "Rally",
		icon: applicationIcon(),
		backgroundColor: dark ? "#1c1c1e" : "#f3f3f3",
		webPreferences: {
			partition,
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	if (process.platform === "win32") {
		let saveTimer: NodeJS.Timeout | undefined;
		const saveSize = () => {
			if (win.isDestroyed() || win.isMaximized() || win.isMinimized()) return;
			const [currentWidth, currentHeight] = win.getSize();
			if (saveTimer) clearTimeout(saveTimer);
			saveTimer = setTimeout(() => writeWindowSize(currentWidth, currentHeight), 250);
		};
		win.on("resize", saveSize);
		win.on("close", () => {
			if (saveTimer) clearTimeout(saveTimer);
			if (!win.isMaximized() && !win.isMinimized()) {
				const [currentWidth, currentHeight] = win.getSize();
				writeWindowSize(currentWidth, currentHeight);
			}
		});
	}

	applyWindowBranding(win);
	forwardWindowState(win);
	win.once("ready-to-show", () => {
		win.show();
	});

	// External links open in the system browser; the app window never navigates away.
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
		return { action: "deny" };
	});
	win.webContents.on("will-navigate", (event) => event.preventDefault());

	const devUrl = process.env.ELECTRON_RENDERER_URL;
	if (!app.isPackaged && devUrl) {
		void win.loadURL(devUrl);
	} else {
		void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
	}
	return win;
}

const windowSizeFile = join(app.getPath("userData"), "window-size-v1.json");

function readWindowSize(): { width: number; height: number } | null {
	try {
		const value: unknown = JSON.parse(readFileSync(windowSizeFile, "utf8"));
		if (typeof value !== "object" || value === null || !("width" in value) || !("height" in value)) return null;
		const { width, height } = value;
		if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height)) return null;
		if (width < 400 || height < 300) return null;
		return { width: Math.round(width), height: Math.round(height) };
	} catch { return null; }
}

function writeWindowSize(width: number, height: number): void {
	try {
		mkdirSync(dirname(windowSizeFile), { recursive: true });
		writeFileSync(`${windowSizeFile}.tmp`, JSON.stringify({ width, height }), { mode: 0o600 });
		renameSync(`${windowSizeFile}.tmp`, windowSizeFile);
	} catch (error) { console.error("Window size could not be saved", error); }
}
