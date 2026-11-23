import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { createHarness, type Harness } from "./harness.ts";
import { desktopHost } from "../../../../src/main/desktop-host.ts";
import { APP_ID, applyWindowBranding, showMainWindow } from "../../../../src/main/branding.ts";
import { DesktopPreferences } from "../../../../src/main/desktop-preferences.ts";
import { IpcChannel as C } from "../../../../src/shared/ipc.ts";

const native = vi.hoisted(() => ({
  directory: "", appPath: ".", packaged: false, failTray: false, quit: vi.fn(),
  loginRegistered: false, loginEnabled: false, rejectLoginChange: false,
  setLogin: vi.fn<(settings: { openAtLogin: boolean; enabled: boolean }) => void>(), getLogin: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(), listeners: new Map<string, (event: unknown) => void>(),
  trays: [] as { tooltip: string; destroy: ReturnType<typeof vi.fn>; menu: Array<{ label?: string; click?: () => void }>; click?: () => void }[],
}));
vi.mock("electron", () => ({
  app: { getPath: () => native.directory, getAppPath: () => native.appPath, get isPackaged() { return native.packaged; }, quit: native.quit,
    getLoginItemSettings: native.getLogin, setLoginItemSettings: native.setLogin },
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => native.handlers.set(name, fn), removeHandler: (name: string) => native.handlers.delete(name),
    on: (name: string, fn: (event: unknown) => void) => native.listeners.set(name, fn), removeListener: (name: string) => native.listeners.delete(name),
  },
  Menu: { buildFromTemplate: (value: unknown) => value },
  Tray: class {
    tooltip = ""; menu = []; click?: () => void; destroy = vi.fn();
    constructor() { if (native.failTray) throw Error("tray unavailable"); native.trays.push(this); }
    setToolTip(value: string) { this.tooltip = value; } setContextMenu(value: []) { this.menu = value; }
    on(_event: string, fn: () => void) { this.click = fn; }
  },
}));
const fixtures: Harness[] = []; const stops: Array<() => void> = [];
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const resourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
beforeEach(() => {
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  Object.defineProperty(process, "resourcesPath", { configurable: true, value: join("Rally installed", "resources") });
  native.packaged = false; native.appPath = "."; native.loginRegistered = false; native.loginEnabled = false; native.rejectLoginChange = false;
  native.getLogin.mockReset().mockImplementation(() => ({
    openAtLogin: native.loginRegistered,
    launchItems: native.loginRegistered ? [{ name: APP_ID, scope: "user", enabled: native.loginEnabled }] : [],
  }));
  native.setLogin.mockReset().mockImplementation(settings => {
    if (native.rejectLoginChange) return;
    native.loginRegistered = settings.openAtLogin; native.loginEnabled = settings.enabled;
  });
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop(); for (const harness of fixtures.splice(0)) harness.cleanup();
  native.quit.mockClear(); native.trays.length = 0; native.failTray = false; vi.restoreAllMocks();
  Object.defineProperty(process, "platform", platform);
  if (resourcesPath) Object.defineProperty(process, "resourcesPath", resourcesPath); else Reflect.deleteProperty(process, "resourcesPath");
});
async function setup(mode: string) {
  const harness = await createHarness(); fixtures.push(harness); native.directory = harness.tempDir;
  let quitting = false;
  const window = Object.assign(new EventEmitter(), { webContents: { mainFrame: {} }, hide: vi.fn(), show: vi.fn(), focus: vi.fn(), restore: vi.fn(), minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(), isMinimized: () => true, isDestroyed: () => false, isMaximized: () => false, close: () => window.emit("close", { preventDefault: vi.fn() }) });
  const stop = desktopHost(window as unknown as BrowserWindow, () => quitting, mode); stops.push(stop);
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { window, event, stop, quit: () => { quitting = true; } };
}
it.each(["local", "cloud"])("%s uses persistent close behavior, restores a hidden window and explicitly quits from tray", async mode => {
  const { window, event, stop, quit } = await setup(mode);
  const get = native.handlers.get(C.desktopState)!; const update = native.handlers.get(C.desktopUpdate)!;
  expect(get(event)).toEqual({ closeBehavior: "quit", trayAvailable: true, openAtLogin: false, loginItemAvailable: false });
  window.close(); expect(native.quit).toHaveBeenCalledOnce(); expect(window.hide).not.toHaveBeenCalled();
  expect(() => update({ ...event, senderFrame: {} }, "tray")).toThrow("无效窗口");
  expect(() => update(event, "invalid")).toThrow("无效");
  update(event, "tray"); window.close(); expect(window.hide).toHaveBeenCalledOnce();
  expect(new DesktopPreferences(join(native.directory, "desktop-v1.json")).closeBehavior).toBe("tray");
  native.trays[0].click!(); expect(window.restore).toHaveBeenCalledOnce(); expect(window.show).toHaveBeenCalledOnce();
  showMainWindow(window as unknown as BrowserWindow); expect(window.show).toHaveBeenCalledTimes(2);
  native.trays[0].menu.find(item => item.label === "退出 Rally")!.click!(); expect(native.quit).toHaveBeenCalledTimes(2);
  quit(); const close = { preventDefault: vi.fn() }; window.emit("close", close); expect(close.preventDefault).not.toHaveBeenCalled();
  stop(); expect(native.trays[0].destroy).toHaveBeenCalledOnce(); expect(native.handlers.size).toBe(0); expect(native.listeners.size).toBe(0);
});
it("fails safely when a tray cannot be created", async () => {
  native.failTray = true; vi.spyOn(console, "error").mockImplementation(() => {});
  const { event, window } = await setup("cloud");
  expect(native.handlers.get(C.desktopState)!(event)).toEqual({ closeBehavior: "quit", trayAvailable: false, openAtLogin: false, loginItemAvailable: false });
  expect(() => native.handlers.get(C.desktopUpdate)!(event, "tray")).toThrow("托盘暂不可用");
  window.close(); expect(native.quit).toHaveBeenCalledOnce(); expect(window.hide).not.toHaveBeenCalled();
});
it.each(["local", "cloud"])("%s controls the current user's installed startup entry independently from close behavior", async mode => {
  native.packaged = true;
  const { event, stop } = await setup(mode);
  const update = native.handlers.get(C.desktopSetOpenAtLogin)!;
  expect(native.handlers.get(C.desktopState)!(event)).toMatchObject({ openAtLogin: false, loginItemAvailable: true });
  expect(native.setLogin).not.toHaveBeenCalled();
  expect(update(event, true)).toMatchObject({ openAtLogin: true, closeBehavior: "quit" });
  expect(native.setLogin).toHaveBeenLastCalledWith({ name: APP_ID, path: process.execPath, args: [], openAtLogin: true, enabled: true });
  native.handlers.get(C.desktopUpdate)!(event, "tray");
  expect(native.setLogin).toHaveBeenCalledOnce();
  stop(); const restored = await setup(mode === "local" ? "cloud" : "local");
  expect(native.handlers.get(C.desktopState)!(restored.event)).toMatchObject({ openAtLogin: true });
  expect(native.handlers.get(C.desktopSetOpenAtLogin)!(restored.event, false)).toMatchObject({ openAtLogin: false });
  expect(native.setLogin).toHaveBeenLastCalledWith({ name: APP_ID, path: process.execPath, args: [], openAtLogin: false, enabled: false });
});
it("reflects Task Manager disabling startup and reports when Windows rejects enabling it", async () => {
  native.packaged = true; native.loginRegistered = true; native.loginEnabled = false;
  const { event } = await setup("cloud");
  const get = native.handlers.get(C.desktopState)!; const update = native.handlers.get(C.desktopSetOpenAtLogin)!;
  expect(get(event)).toMatchObject({ openAtLogin: false });
  native.rejectLoginChange = true;
  expect(() => update(event, true)).toThrow("Windows 未应用");
  expect(get(event)).toMatchObject({ openAtLogin: false });
  native.rejectLoginChange = false;
  expect(update(event, true)).toMatchObject({ openAtLogin: true });
  native.loginEnabled = false;
  expect(get(event)).toMatchObject({ openAtLogin: false });
});
it("rejects invalid or foreign startup writes and never registers the development executable", async () => {
  const { event, quit } = await setup("local");
  const update = native.handlers.get(C.desktopSetOpenAtLogin)!;
  expect(() => update(event, "true")).toThrow("无效");
  expect(() => update(event, true)).toThrow("Windows 安装版");
  native.packaged = true;
  expect(() => update({ ...event, senderFrame: {} }, true)).toThrow("无效窗口");
  Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  expect(native.handlers.get(C.desktopState)!(event)).toMatchObject({ loginItemAvailable: false });
  expect(() => update(event, true)).toThrow("Windows 安装版");
  Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  quit(); expect(() => update(event, true)).toThrow("正在退出");
  expect(native.setLogin).not.toHaveBeenCalled();
  expect(native.getLogin).not.toHaveBeenCalled();
});
it.each([true, false])("uses Rally's window bitmap and matching taskbar identity (packaged=%s)", packaged => {
  native.packaged = packaged; native.appPath = join("Development folder", "Rally");
  const window = { setIcon: vi.fn(), setAppDetails: vi.fn() };
  applyWindowBranding(window as unknown as BrowserWindow);
  const root = packaged ? process.resourcesPath : native.appPath;
  expect(window.setIcon).toHaveBeenCalledWith(join(root, packaged ? "icon.png" : "docs/icon.png"));
  expect(window.setAppDetails).toHaveBeenCalledWith({
    appId: APP_ID, appIconPath: join(root, packaged ? "icon.ico" : "build/icon.ico"), appIconIndex: 0,
    relaunchCommand: `"${process.execPath}"${packaged ? "" : ` "${native.appPath}"`}`, relaunchDisplayName: "Rally",
  });
});
