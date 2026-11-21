import { join } from "node:path";
import { app, Menu, Tray, type BrowserWindow } from "electron";

/** Must match electron-builder.yml so installed shortcuts group with the window. */
export const APP_ID = "dev.rally.app";

export function applicationIcon(): string {
 const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
 return process.platform === "win32"
  ? join(root, app.isPackaged ? "icon.ico" : "build/icon.ico")
  : join(root, "icon.png");
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
