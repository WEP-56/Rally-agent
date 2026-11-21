import { join } from "node:path";
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { createHarness, type Harness } from "./harness.ts";
import { desktopHost } from "../../../../src/main/desktop-host.ts";
import { showMainWindow } from "../../../../src/main/branding.ts";
import { DesktopPreferences } from "../../../../src/main/desktop-preferences.ts";
import { IpcChannel as C } from "../../../../src/shared/ipc.ts";

const native = vi.hoisted(() => ({
  directory: "", failTray: false, quit: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(), listeners: new Map<string, (event: unknown) => void>(),
  trays: [] as { tooltip: string; destroy: ReturnType<typeof vi.fn>; menu: Array<{ label?: string; click?: () => void }>; click?: () => void }[],
}));
vi.mock("electron", () => ({
  app: { getPath: () => native.directory, getAppPath: () => ".", quit: native.quit },
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
afterEach(() => { for (const stop of stops.splice(0)) stop(); for (const harness of fixtures.splice(0)) harness.cleanup(); native.quit.mockClear(); native.trays.length = 0; native.failTray = false; vi.restoreAllMocks(); });
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
  expect(get(event)).toEqual({ closeBehavior: "quit", trayAvailable: true });
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
  expect(native.handlers.get(C.desktopState)!(event)).toEqual({ closeBehavior: "quit", trayAvailable: false });
  expect(() => native.handlers.get(C.desktopUpdate)!(event, "tray")).toThrow("托盘暂不可用");
  window.close(); expect(native.quit).toHaveBeenCalledOnce(); expect(window.hide).not.toHaveBeenCalled();
});
