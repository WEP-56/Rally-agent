// Electron main entry: single-instance lock, Rally paths, main window. `RALLY_SMOKE=1` runs the M0 smoke check and exits.

import { join } from "node:path";
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import { broadcastChat, broadcastTask, broadcastWorkspace, broadcastServices, forwardWindowState, registerIpc } from "./ipc.ts";
import { ensureRallyDirs, resolveRallyPaths } from "./paths.ts";
import { runSmoke } from "./smoke.ts";
import { Supervisor } from "./supervisor/index.ts";
import { StateDirectoryLock } from "./supervisor/state-lock.ts";
import { ApplicationShutdown } from "./application-shutdown.ts";
import { TaskNotifications } from "./notifications.ts";
import { APP_ID, applicationIcon, createApplicationTray } from "./branding.ts";

const paths = resolveRallyPaths();

// Pi resolves ~/.rally/agent from piConfig; the env var pins it even for code paths that read it directly.
process.env.RALLY_CODING_AGENT_DIR = paths.agentDir;

if (process.env.RALLY_SMOKE === "1") {
	void runSmokeAndExit();
} else if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on("second-instance", () => {
		const win = BrowserWindow.getAllWindows()[0];
		if (!win) return;
		if (win.isMinimized()) win.restore();
		win.focus();
	});
	app.on("window-all-closed", () => app.quit());
	void app.whenReady().then(startApplication);
}

async function startApplication(): Promise<void> {
	let supervisor: Supervisor | undefined;
	let stopIpc: (() => Promise<void>) | undefined;
	let startupError: unknown;
	let notifications: TaskNotifications | undefined;
	let destroyTray: (() => void) | undefined;
	const shutdown = new ApplicationShutdown({
		close: async () => {
			try { notifications?.dispose(); destroyTray?.(); } finally {
				// Draining requests can depend on session cancellation, so start both together.
				const pending = stopIpc?.();
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
		// Supervisor locks the state directory before any recovery or state writes.
		supervisor = new Supervisor(paths, { emitChat: broadcastChat, emitTask: event => { broadcastTask(event); notifications?.observe(event); }, emitWorkspace: broadcastWorkspace, emitServices: broadcastServices,
			onStartupFailure: async error => { startupError = error; await shutdown.prepare(); void shutdown.run(true); },
		});
		ensureRallyDirs(paths);
		notifications = new TaskNotifications(join(paths.home, "notifications.json"), () => BrowserWindow.getAllWindows().find(window => !window.isDestroyed()));
		stopIpc = registerIpc(paths, supervisor, notifications);
		await supervisor.start();
		if (!shutdown.started) {
			destroyTray = createApplicationTray(createMainWindow());
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

function createMainWindow(): BrowserWindow {
	if (process.platform === "win32") app.setAppUserModelId(APP_ID);
	const dark = nativeTheme.shouldUseDarkColors;
	// Frameless: the renderer draws the prototype's title bar and window controls (IPC in ipc.ts).
	const win = new BrowserWindow({
		width: 1360,
		height: 860,
		minWidth: 960,
		minHeight: 600,
		show: false,
		frame: false,
		title: "Rally",
		icon: applicationIcon(),
		backgroundColor: dark ? "#1c1c1e" : "#f3f3f3",
		webPreferences: {
			preload: join(import.meta.dirname, "../preload/index.cjs"),
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	forwardWindowState(win);
	win.once("ready-to-show", () => {
		win.maximize();
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
