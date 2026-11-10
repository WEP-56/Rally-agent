import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { BrowserWindow, IpcMainInvokeEvent, WebContents, WebPreferences } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserManager, BROWSER_PARTITION } from "../../../../src/main/browser.ts";
import { browserAddress, BROWSER_START } from "../../../../src/shared/browser.ts";
import { IpcChannel, IpcEvent } from "../../../../src/shared/ipc.ts";
import { registerIpc } from "../../../../src/main/ipc.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { createHarness, type Harness } from "./harness.ts";

const native = vi.hoisted(() => ({ views: [] as unknown[], owners: new Map<unknown, unknown>(), external: vi.fn(async () => {}), sessions: [] as string[] }));
const transport = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), listeners: new Map<string, unknown>() }));
class Contents extends EventEmitter {
	url = ""; title = ""; loading = false; destroyed = false; mainFrame = {}; sent: Array<{ channel: string; event: unknown }> = []; history: string[] = []; index = -1; zoom = 1;
	open?: (details: { url: string; postBody?: object }) => { action: string }; pending = new Map<string, { resolve(): void; reject(error: Error): void }>(); auto = true;
	closeOptions?: object; focused = false; reloads = 0;
	navigationHistory = { canGoBack: () => this.index > 0, canGoForward: () => this.index < this.history.length - 1, goBack: () => this.move(-1), goForward: () => this.move(1) };
	getURL() { return this.url; } getTitle() { return this.title; } isDestroyed() { return this.destroyed; } isLoading() { return this.loading; } getZoomFactor() { return this.zoom; }
	send(channel: string, event: unknown) { this.sent.push({ channel, event }); }
	focus() { this.focused = true; }
	setWindowOpenHandler(handler: Contents["open"]) { this.open = handler; }
	loadURL(url: string): Promise<void> {
		this.loading = true; this.emit("did-start-loading"); this.emit("did-start-navigation", {}, url, false, true);
		this.history = [...this.history.slice(0, this.index + 1), url]; this.index++;
		const promise = new Promise<void>((resolve, reject) => this.pending.set(url, { resolve, reject }));
		if (this.auto) this.complete(url); return promise;
	}
	complete(url: string) { this.url = url; this.title = `Title ${url}`; this.loading = false; this.emit("did-navigate", {}, url); this.emit("page-title-updated", {}, this.title); this.emit("did-stop-loading"); this.pending.get(url)?.resolve(); this.pending.delete(url); }
	move(delta: number) { this.index += delta; this.complete(this.history[this.index]); }
	reload() { this.reloads++; this.loading = true; this.emit("did-start-loading"); this.complete(this.url); }
	stop() { this.loading = false; this.emit("did-stop-loading"); }
	close(options: object) { this.closeOptions = options; this.destroyed = true; this.emit("destroyed"); }
}
class View {
	webContents = new Contents(); visible = false; bounds?: { x: number; y: number; width: number; height: number }; radius = 0; options: { webPreferences: WebPreferences };
	constructor(options: { webPreferences: WebPreferences }) { this.options = options; native.views.push(this); }
	setVisible(value: boolean) { this.visible = value; } setBounds(value: View["bounds"]) { this.bounds = value; } setBorderRadius(value: number) { this.radius = value; }
}
class Window extends EventEmitter {
	id: number; webContents = new Contents(); destroyed = false; children = new Set<View>();
	contentView = { addChildView: (view: View) => { this.children.add(view); }, removeChildView: (view: View) => { this.children.delete(view); } };
	constructor(id = 1) { super(); this.id = id; native.owners.set(this.webContents, this); }
	getContentSize() { return [1000, 800]; } isDestroyed() { return this.destroyed; }
}
class IsolatedSession extends EventEmitter {
	check?: (contents: unknown, permission: string, origin: string) => boolean;
	request?: (contents: Contents, permission: string, callback: (allowed: boolean) => void, details: { requestingUrl: string }) => void;
	setPermissionCheckHandler(handler: IsolatedSession["check"]) { this.check = handler; }
	setPermissionRequestHandler(handler: IsolatedSession["request"]) { this.request = handler; }
}
const isolated = new IsolatedSession();
vi.mock("electron", () => ({
	BrowserWindow: { fromWebContents: (contents: unknown) => native.owners.get(contents) ?? null, getAllWindows: () => [] },
	WebContentsView: class { constructor(options: { webPreferences: WebPreferences }) { return new View(options); } },
	session: { fromPartition: (partition: string) => { native.sessions.push(partition); return isolated; } },
	shell: { openExternal: native.external },
	app: {}, dialog: {}, ipcMain: {
		handle: (channel: string, listener: (...args: unknown[]) => unknown) => transport.handlers.set(channel, listener),
		removeHandler: (channel: string) => transport.handlers.delete(channel),
		on: (channel: string, listener: unknown) => transport.listeners.set(channel, listener),
		removeListener: (channel: string) => transport.listeners.delete(channel),
	},
}));
const owner = (window: Window) => window as unknown as BrowserWindow;
const event = (window: Window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) as unknown as IpcMainInvokeEvent;
const latest = (window: Window) => window.webContents.sent.filter(item => item.channel === IpcEvent.browser).at(-1)?.event;
const lastView = () => native.views.at(-1) as View;
const shown = (id: string) => ({ id, visible: true, x: 400, y: 90, width: 580, height: 690 });

describe("Rally native browser boundary (Electron substitutes, no UI/network)", () => {
	const managers: BrowserManager[] = []; const harnesses: Harness[] = [];
	afterEach(async () => { for (const manager of managers.splice(0)) await manager.dispose(); native.views.length = 0; native.sessions.length = 0; native.owners.clear(); native.external.mockClear(); isolated.removeAllListeners(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup() { harnesses.push(await createHarness()); const manager = new BrowserManager(); managers.push(manager); const window = new Window(); return { manager, window }; }
	it("normalizes addresses without treating unsafe schemes or credentials as searches", () => {
		expect(browserAddress("")).toBe(BROWSER_START); expect(browserAddress("localhost:5173/path")).toBe("http://localhost:5173/path"); expect(browserAddress("[::1]:3000")).toBe("http://[::1]:3000/");
		expect(browserAddress("example.test/a")).toBe("https://example.test/a"); expect(browserAddress("two words")).toContain("search?q=two%20words");
		for (const url of ["file:///a", "javascript:alert(1)", "data:text/html,x", "https://name:password@example.test", "rally://other"]) expect(() => browserAddress(url)).toThrow();
	});
	it("creates isolated native tabs without a preload and refuses guests, subframes and cross-window access", async () => {
		const { manager, window } = await setup(); expect(manager.owner(event(window))).toBe(window);
		manager.create(owner(window), "a", "http://localhost:5173"); const view = lastView();
		expect(native.sessions).toEqual([BROWSER_PARTITION]); expect(view.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, contextIsolation: true, webviewTag: false, webSecurity: true });
		expect(view.options.webPreferences.preload).toBeUndefined(); expect(window.children.has(view)).toBe(true);
		expect(() => manager.owner({ ...event(window), senderFrame: {} } as IpcMainInvokeEvent)).toThrow("BROWSER_NOT_ALLOWED");
		native.owners.set(view.webContents, window);
		expect(() => manager.owner({ sender: view.webContents, senderFrame: view.webContents.mainFrame } as unknown as IpcMainInvokeEvent)).toThrow("BROWSER_NOT_ALLOWED");
		expect(() => manager.navigate(owner(new Window(2)), "a", "https://example.test")).toThrow("BROWSER_NOT_FOUND");
		expect(() => manager.create(owner(window), "bad/id")).toThrow("BROWSER_ID_INVALID");
	});
	it("uses Chromium history for links, same-document navigation, home/back/forward and external open", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a"); const contents = lastView().webContents;
		manager.navigate(owner(window), "a", "http://localhost:5173");
		await contents.loadURL("http://localhost:5173/linked"); contents.title = "Linked page"; contents.emit("page-title-updated", {}, contents.title);
		expect(latest(window)).toMatchObject({ type: "state", state: { url: "http://localhost:5173/linked", title: "Linked page", canGoBack: true } });
		contents.url += "#part"; contents.emit("did-navigate-in-page", {}, contents.url, true);
		expect(latest(window)).toMatchObject({ state: { url: "http://localhost:5173/linked#part" } });
		manager.navigate(owner(window), "a", BROWSER_START); expect(latest(window)).toMatchObject({ state: { url: BROWSER_START, title: "新标签页" } });
		manager.action(owner(window), "a", "back"); expect(latest(window)).toMatchObject({ state: { url: "http://localhost:5173/linked", canGoForward: true } });
		manager.action(owner(window), "a", "external"); expect(native.external).toHaveBeenCalledWith("http://localhost:5173/linked");
		manager.action(owner(window), "a", "forward"); expect(latest(window)).toMatchObject({ state: { url: BROWSER_START } });
	});
	it("shows only the selected tab, clamps zoomed layout and preserves contents while obscured", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a", "https://a.test"); const a = lastView(); manager.create(owner(window), "b", "https://b.test"); const b = lastView();
		manager.layout(owner(window), shown("a")); expect(a.visible).toBe(true); expect(b.visible).toBe(false);
		manager.layout(owner(window), shown("b")); expect(a.visible).toBe(false); expect(b.visible).toBe(true);
		manager.layout(owner(window), { ...shown("b"), visible: false }); expect(b.visible).toBe(false); expect(b.webContents.destroyed).toBe(false);
		expect(manager.create(owner(window), "b", "https://ignored.test").url).toBe("https://b.test/"); expect(native.views).toHaveLength(2);
		window.webContents.zoom = 1.5; manager.layout(owner(window), shown("b")); expect(b.bounds).toEqual({ x: 600, y: 135, width: 400, height: 665 });
		expect(() => manager.layout(owner(window), { ...shown("b"), width: NaN })).toThrow("BROWSER_BOUNDS_INVALID");
	});
	it("reports loading, main-frame failure and crashes, ignores subframe errors, and supports retry", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a", "https://a.test"); const view = lastView(); manager.layout(owner(window), shown("a"));
		view.webContents.auto = false; manager.navigate(owner(window), "a", "https://fail.test/"); expect(latest(window)).toMatchObject({ state: { loading: true } });
		view.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://child.test/", false); expect(view.visible).toBe(true);
		view.webContents.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED", "https://fail.test/", true); expect(view.visible).toBe(false); expect(latest(window)).toMatchObject({ state: { error: "ERR_NAME_NOT_RESOLVED (-105)" } });
		view.webContents.emit("did-stop-loading"); expect(latest(window)).toMatchObject({ state: { url: "https://fail.test/", error: "ERR_NAME_NOT_RESOLVED (-105)" } });
		view.webContents.auto = true; manager.action(owner(window), "a", "reload"); expect(view.webContents.getURL()).toBe("https://fail.test/"); expect(view.visible).toBe(true);
		view.webContents.emit("render-process-gone", {}, { reason: "crashed" }); expect(view.visible).toBe(false); expect(latest(window)).toMatchObject({ state: { error: expect.stringContaining("crashed") } });
	});
	it("routes HTTP popups to app tabs, blocks unsupported schemes and forwards host shortcuts", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a", "https://a.test"); const contents = lastView().webContents;
		expect(contents.open?.({ url: "https://next.test" })).toEqual({ action: "deny" }); expect(latest(window)).toMatchObject({ type: "open", url: "https://next.test/" });
		contents.open?.({ url: "file:///secret" }); expect(latest(window)).toMatchObject({ type: "state", state: { notice: expect.any(String) } });
		const preventDefault = vi.fn(); contents.emit("will-frame-navigate", { url: "file:///secret", isMainFrame: true, preventDefault }); expect(preventDefault).toHaveBeenCalled();
		preventDefault.mockClear(); contents.emit("will-redirect", { preventDefault }, "javascript:bad"); expect(preventDefault).toHaveBeenCalled();
		contents.emit("before-input-event", { preventDefault }, { type: "keyDown", key: "L", control: true }); expect(latest(window)).toEqual({ type: "shortcut", key: "l" }); expect(window.webContents.focused).toBe(true);
	});
	it("keeps permissions and downloads in the isolated session with an actionable notice", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a", "http://localhost:5173"); const contents = lastView().webContents;
		expect(isolated.check?.(contents, "media", "http://localhost:5173")).toBe(false); expect(isolated.check?.(contents, "loopback-network", "http://localhost:5173")).toBe(true); expect(isolated.check?.(contents, "loopback-network", "https://remote.test")).toBe(false);
		const callback = vi.fn(); isolated.request?.(contents, "geolocation", callback, { requestingUrl: "http://localhost:5173" }); expect(callback).toHaveBeenCalledWith(false); expect(latest(window)).toMatchObject({ state: { notice: expect.stringContaining("geolocation") } });
		const preventDefault = vi.fn(); isolated.emit("will-download", { preventDefault }, {}, contents); expect(preventDefault).toHaveBeenCalled(); expect(latest(window)).toMatchObject({ state: { notice: expect.stringContaining("下载") } });
	});
	it("ignores stale navigation failures and waits for actual child destruction during shutdown", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a"); const contents = lastView().webContents; contents.auto = false;
		manager.navigate(owner(window), "a", "https://old.test"); manager.navigate(owner(window), "a", "https://new.test");
		contents.emit("did-fail-load", {}, -105, "OLD_FAILURE", "https://old.test/", true);
		expect(latest(window)).toMatchObject({ state: { url: "https://new.test/", error: undefined } });
		contents.pending.get("https://old.test/")?.reject(new Error("OLD_FAILURE")); await Promise.resolve();
		expect(latest(window)).toMatchObject({ state: { url: "https://new.test/", error: undefined } });
		vi.spyOn(contents, "close").mockImplementation(() => {});
		let disposed = false; const disposing = manager.dispose().then(() => { disposed = true; });
		await Promise.resolve(); expect(disposed).toBe(false); contents.destroyed = true; contents.emit("destroyed"); await disposing; expect(disposed).toBe(true);
	});
	it("removes a tab when its page closes itself and reports the closure to its owner", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a"); lastView().webContents.close({});
		expect(latest(window)).toEqual({ type: "closed", id: "a" }); expect(window.children.size).toBe(0); await manager.close(owner(window), "a");
	});
	it("closes child contents on tab close, UI reload, renderer crash and shutdown without beforeunload deadlocks", async () => {
		const { manager, window } = await setup(); manager.create(owner(window), "a"); const a = lastView(); await manager.close(owner(window), "a"); expect(a.webContents.destroyed).toBe(true); expect(a.webContents.closeOptions).toEqual({ waitForBeforeUnload: false }); expect(window.children.size).toBe(0);
		manager.create(owner(window), "b"); const b = lastView(); window.webContents.emit("did-start-navigation", {}, "file:///app", false, true); expect(b.webContents.destroyed).toBe(true);
		manager.create(owner(window), "c"); const c = lastView(); window.webContents.emit("render-process-gone", {}, {}); expect(c.webContents.destroyed).toBe(true);
		manager.create(owner(window), "d"); const d = lastView(); await manager.dispose(); expect(d.webContents.destroyed).toBe(true); expect(() => manager.create(owner(window), "e")).toThrow("BROWSER_CLOSED");
	});
	it("wires declared browser IPC to the owner and drains child closure during production IPC shutdown", async () => {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); const stop = registerIpc(paths, supervisor);
		const window = new Window(); const invoke = (channel: string, ...args: unknown[]) => Promise.resolve(transport.handlers.get(channel)!(event(window), ...args));
		try {
			expect(await invoke(IpcChannel.browserCreate, "a")).toMatchObject({ id: "a", url: BROWSER_START });
			expect(await invoke(IpcChannel.browserNavigate, "a", "http://localhost:5173")).toMatchObject({ url: "http://localhost:5173/" });
			await invoke(IpcChannel.browserLayout, shown("a")); expect(lastView().visible).toBe(true);
			await invoke(IpcChannel.browserAction, "a", "external"); expect(native.external).toHaveBeenCalledWith("http://localhost:5173/");
			const guest = { sender: lastView().webContents, senderFrame: lastView().webContents.mainFrame };
			await expect(transport.handlers.get(IpcChannel.browserCreate)!(guest, "guest")).rejects.toThrow("BROWSER_NOT_ALLOWED");
			await invoke(IpcChannel.browserClose, "a"); expect(lastView().webContents.destroyed).toBe(true);
			await invoke(IpcChannel.browserCreate, "b"); const child = lastView().webContents;
			await stop(); expect(child.destroyed).toBe(true); expect(transport.handlers.size).toBe(0); expect(transport.listeners.size).toBe(0);
		} finally { await stop(); await supervisor.dispose(); }
	});
});
