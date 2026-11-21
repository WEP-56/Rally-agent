import { app } from "electron";
import type { DesktopSettings } from "../shared/desktop.ts";
import { APP_ID } from "./branding.ts";

/** Windows owns this setting, including changes made in Task Manager. */
export function loginItemState(): Pick<DesktopSettings, "openAtLogin" | "loginItemAvailable"> {
  if (process.platform !== "win32" || !app.isPackaged) return { openAtLogin: false, loginItemAvailable: false };
  const settings = app.getLoginItemSettings({ path: process.execPath, args: [] });
  return {
    openAtLogin: settings.openAtLogin && settings.launchItems.some(item => item.name === APP_ID && item.scope === "user" && item.enabled),
    loginItemAvailable: true,
  };
}

export function setOpenAtLogin(value: unknown): void {
  if (typeof value !== "boolean") throw Error("无效的开机自启设置");
  if (process.platform !== "win32" || !app.isPackaged) throw Error("开机自启仅适用于 Windows 安装版");
  // NSIS keeps Rally.exe at a stable path; never register the development Electron executable.
  app.setLoginItemSettings({ name: APP_ID, path: process.execPath, args: [], openAtLogin: value, enabled: value });
  if (loginItemState().openAtLogin !== value) throw Error("Windows 未应用开机自启设置，请检查系统的启动应用权限");
}
