import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { applicationIcon, createApplicationTray } from "../../../src/main/branding.ts";

const state = vi.hoisted(() => ({ packaged: false, quit: vi.fn(), destroy: vi.fn(), image: "", tooltip: "", menu: [] as { label?: string; click?: () => void }[], click: undefined as (() => void) | undefined }));
vi.mock("electron", () => ({
 app: { get isPackaged() { return state.packaged; }, getAppPath: () => "D:/fixture", quit: state.quit },
 Menu: { buildFromTemplate: (menu: typeof state.menu) => { state.menu = menu; return menu; } },
 Tray: class {
  constructor(image: string) { state.image = image; }
  setToolTip(value: string) { state.tooltip = value; }
  setContextMenu() {}
  on(_event: string, callback: () => void) { state.click = callback; }
  destroy() { state.destroy(); }
 },
}));
afterEach(() => { vi.clearAllMocks(); state.packaged = false; vi.unstubAllGlobals(); });
describe("application branding without native UI", () => {
 it("uses generated development assets and packaged extraResources", () => {
  expect(applicationIcon()).toBe(join("D:/fixture", process.platform === "win32" ? "build/icon.ico" : "icon.png"));
  state.packaged = true;
  vi.stubGlobal("process", { ...process, resourcesPath: "D:/installed/resources" });
  expect(applicationIcon()).toBe(join("D:/installed/resources", process.platform === "win32" ? "icon.ico" : "icon.png"));
 });
 it("restores/focuses the window and sends tray quit through the existing application exit path", () => {
  const window = { isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(), show: vi.fn(), focus: vi.fn() };
  const dispose = createApplicationTray(window as unknown as BrowserWindow);
  expect(state.image).toBe(applicationIcon()); expect(state.tooltip).toBe("Rally");
  state.click!(); expect(window.restore).toHaveBeenCalledOnce(); expect(window.show).toHaveBeenCalledOnce(); expect(window.focus).toHaveBeenCalledOnce();
  state.menu.find(item => item.label === "退出 Rally")!.click!(); expect(state.quit).toHaveBeenCalledOnce();
  dispose(); dispose(); expect(state.destroy).toHaveBeenCalledOnce();
  state.click!(); state.menu.find(item => item.label === "退出 Rally")!.click!();
  expect(window.show).toHaveBeenCalledOnce(); expect(state.quit).toHaveBeenCalledOnce();
 });
 it("ignores activation after its window has been destroyed", () => {
  const window = { isDestroyed: () => true, isMinimized: vi.fn(), show: vi.fn(), focus: vi.fn() };
  const dispose = createApplicationTray(window as unknown as BrowserWindow); state.click!();
  expect(window.isMinimized).not.toHaveBeenCalled(); expect(window.show).not.toHaveBeenCalled(); dispose();
 });
});
