import { join } from "node:path";
import { app, Menu, Tray, type BrowserWindow } from "electron";

/** Must match electron-builder.yml so installed shortcuts group with the window. */
export const APP_ID = "dev.rally.app";

/** Development shortcuts must not claim the installed app's taskbar identity. */
export function applicationId(): string {
 return app.isPackaged ? APP_ID : `${APP_ID}.development`;
}

export function applicationIcon(): string {
 const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
 return process.platform === "win32"
  ? join(root, app.isPackaged ? "icon.ico" : "build/icon.ico")
  : join(root, app.isPackaged ? "icon.png" : "docs/icon.png");
}

/** Bind the running window and its pinned taskbar entry to Rally before showing it. */
export function applyWindowBranding(window: BrowserWindow): void {
 const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
 // Use a decoded bitmap for the window; the ICO remains the shell/tray resource.
 window.setIcon(join(root, app.isPackaged ? "icon.png" : "docs/icon.png"));
 if (process.platform === "win32") {
  const command = [process.execPath, ...(!app.isPackaged ? [app.getAppPath()] : [])].map(path => `"${path}"`).join(" ");
  window.setAppDetails({ appId: applicationId(), appIconPath: applicationIcon(), appIconIndex: 0, relaunchCommand: command, relaunchDisplayName: "Rally" });
 }
}

export function showMainWindow(window: BrowserWindow): void {
 if (window.isDestroyed()) return;
 if (window.isMinimized()) window.restore();
 window.show(); window.focus();
}

export function createApplicationTray(window: BrowserWindow, mode = "local"): () => void {
 const tray = new Tray(applicationIcon());
 let disposed = false;
 const show = () => {
  if (disposed || window.isDestroyed()) return;
  showMainWindow(window);
 };
 tray.setToolTip(`Rally · ${mode === "cloud" ? "云端" : mode === "local" ? "本地" : "选择运行模式"}`);
 tray.setContextMenu(Menu.buildFromTemplate([
  { label: "显示 Rally", click: show },
  { type: "separator" },
  { label: "退出 Rally", click: () => { if (!disposed) app.quit(); } },
 ]));
 tray.on("click", show);
 return () => { if (!disposed) { disposed = true; tray.destroy(); } };
}
