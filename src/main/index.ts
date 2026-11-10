// Electron main entry: single-instance lock, Rally paths, main window. `RALLY_SMOKE=1` runs the M0 smoke check and exits.

import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, shell } from "electron";
import { broadcastChat, broadcastTask, broadcastWorkspace, forwardWindowState, registerIpc } from "./ipc";
import { ensureRallyDirs, resolveRallyPaths } from "./paths";
import { runSmoke } from "./smoke";
import { Supervisor } from "./supervisor";

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
	void app.whenReady().then(() => {
		ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: broadcastChat, emitTask: broadcastTask, emitWorkspace: broadcastWorkspace });
		registerIpc(paths, supervisor);
		let shutdownStarted = false;
		let shutdownFinished = false;
		app.on("before-quit", (event) => {
			if (shutdownFinished) return;
			event.preventDefault();
			if (shutdownStarted) return;
			shutdownStarted = true;
			void supervisor.dispose().catch((error: unknown) => console.error("Rally shutdown failed", error)).finally(() => {
				shutdownFinished = true;
				app.quit();
			});
		});
		void supervisor.start();
		createMainWindow();
	});
}

async function runSmokeAndExit(): Promise<void> {
	await app.whenReady();
	ensureRallyDirs(paths);
	const result = await runSmoke(paths);
	process.stdout.write(`RALLY_SMOKE ${JSON.stringify(result, null, 2)}\n`);
	app.exit(result.ok ? 0 : 1);
}

function createMainWindow(): void {
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
}
