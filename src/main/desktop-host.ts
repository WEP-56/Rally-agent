import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type IpcMainEvent } from "electron";
import { join } from "node:path";
import { IpcChannel as C } from "../shared/ipc.ts";
import { DesktopPreferences } from "./desktop-preferences.ts";
import { createApplicationTray } from "./branding.ts";
import { loginItemState, setOpenAtLogin } from "./desktop-startup.ts";

/** Both local and cloud windows use the same native shell and the same orderly exit path. */
export function desktopHost(window: BrowserWindow, quitting: () => boolean, mode: string): () => void {
  const preferences = new DesktopPreferences(join(app.getPath("userData"), "desktop-v1.json"));
  let tray: (() => void) | undefined;
  try { tray = createApplicationTray(window, mode); } catch (error) { console.error("Tray unavailable; close will quit", error); }
  const state = () => ({ closeBehavior: preferences.closeBehavior, trayAvailable: Boolean(tray), ...loginItemState() });
  const owns = (event: IpcMainEvent | IpcMainInvokeEvent) => !quitting() && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const guard = (event: IpcMainInvokeEvent) => { if (!owns(event)) throw Error("无效窗口或应用正在退出"); };
  const close = (event: Electron.Event) => {
    if (quitting()) return;
    event.preventDefault();
    if (preferences.closeBehavior === "tray" && tray) window.hide(); else app.quit();
  };
  window.on("close", close);
  const listeners = [
    [C.windowClose, (event: IpcMainEvent) => { if (owns(event)) window.close(); }],
    [C.windowMinimize, (event: IpcMainEvent) => { if (owns(event)) window.minimize(); }],
    [C.windowToggleMaximize, (event: IpcMainEvent) => { if (owns(event)) { if (window.isMaximized()) window.unmaximize(); else window.maximize(); } }],
  ] as const;
  const dispose = () => {
    for (const [name, listener] of listeners) ipcMain.removeListener(name, listener);
    for (const name of [C.windowIsMaximized, C.desktopState, C.desktopUpdate, C.desktopSetOpenAtLogin]) ipcMain.removeHandler(name);
    window.removeListener("close", close); tray?.(); tray = undefined;
  };
  try {
    for (const [name, listener] of listeners) ipcMain.on(name, listener);
    ipcMain.handle(C.windowIsMaximized, event => { guard(event); return window.isMaximized(); });
    ipcMain.handle(C.desktopState, event => { guard(event); return state(); });
    ipcMain.handle(C.desktopUpdate, (event, value: unknown) => {
      guard(event);
      if (value === "tray" && !tray) throw Error("系统托盘暂不可用，请保留退出应用");
      preferences.update(value); return state();
    });
    ipcMain.handle(C.desktopSetOpenAtLogin, (event, value: unknown) => { guard(event); setOpenAtLogin(value); return state(); });
    return dispose;
  } catch (error) { dispose(); throw error; }
}
