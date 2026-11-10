import { BrowserWindow, WebContentsView, session, shell, type IpcMainInvokeEvent, type WebContents, type Session, type Event as ElectronEvent, type DownloadItem } from "electron";
import { BROWSER_START, httpAddress, type BrowserState, type BrowserLayout, type BrowserAction, type BrowserEvent } from "../shared/browser.ts";
import { IpcEvent } from "../shared/ipc.ts";

export const BROWSER_PARTITION = "persist:rally-browser";
interface Tab { owner: BrowserWindow; view: WebContentsView; state: BrowserState; layout?: BrowserLayout; generation: number; closing?: Promise<void> }
interface Owner { window: BrowserWindow; tabs: Map<string, Tab>; unbind(): void }

/** Native tab contents. Lifecycle adapted from electron-browser-shell's tabs.js (MIT).
 * See THIRD_PARTY_NOTICES/electron-browser-shell-LICENSE.txt. Remote pages have no preload. */
export class BrowserManager {
	private readonly owners = new Map<number, Owner>();
	private readonly closing = new Set<Promise<void>>();
	private browserSession?: Session;
	private releaseSession?: () => void;
	private disposed = false;
	private revision = 0;

	owner(event: IpcMainInvokeEvent): BrowserWindow {
		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window || window.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame || window.isDestroyed()) throw new Error("BROWSER_NOT_ALLOWED");
		if (this.disposed) throw new Error("BROWSER_CLOSED");
		return window;
	}
	create(owner: BrowserWindow, id: string, initialUrl = BROWSER_START): BrowserState {
		this.validId(id); if (this.disposed) throw new Error("BROWSER_CLOSED");
		const url = initialUrl === BROWSER_START ? initialUrl : httpAddress(initialUrl);
		let group = this.owners.get(owner.id);
		if (!group) {
			const clear = () => { void this.closeOwner(owner.id); };
			const navigation = (_event: unknown, _url: string, inPlace: boolean, main: boolean) => { if (main && !inPlace) clear(); };
			owner.on("closed", clear); owner.webContents.on("render-process-gone", clear); owner.webContents.on("did-start-navigation", navigation);
			group = { window: owner, tabs: new Map(), unbind: () => { owner.off("closed", clear); owner.webContents.off("render-process-gone", clear); owner.webContents.off("did-start-navigation", navigation); } };
			this.owners.set(owner.id, group);
		}
		const existing = group.tabs.get(id); if (existing) return { ...existing.state };
		if (group.tabs.size >= 32) throw new Error("BROWSER_TAB_LIMIT: 最多打开 32 个浏览器标签");
		const view = new WebContentsView({ webPreferences: { session: this.getSession(), nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true, webviewTag: false, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false } });
		const tab: Tab = { owner, view, generation: 0, state: { id, revision: ++this.revision, url: BROWSER_START, title: "新标签页", loading: false, canGoBack: false, canGoForward: false } };
		group.tabs.set(id, tab); view.setVisible(false); owner.contentView.addChildView(view); view.setBorderRadius(10);
		this.bind(tab); this.load(tab, url); return { ...tab.state };
	}
	navigate(owner: BrowserWindow, id: string, input: string): BrowserState {
		const tab = this.require(owner, id); this.load(tab, input === BROWSER_START ? input : httpAddress(input)); return { ...tab.state };
	}
	action(owner: BrowserWindow, id: string, action: BrowserAction): BrowserState {
		const tab = this.require(owner, id); const contents = tab.view.webContents;
		if (["back", "forward", "reload", "stop"].includes(action)) tab.generation++;
		switch (action) {
			case "back": if (contents.navigationHistory.canGoBack()) { tab.state.error = undefined; contents.navigationHistory.goBack(); } break;
			case "forward": if (contents.navigationHistory.canGoForward()) { tab.state.error = undefined; contents.navigationHistory.goForward(); } break;
			case "reload": if (tab.state.error) this.load(tab, tab.state.url); else contents.reload(); break;
			case "stop": contents.stop(); tab.state.loading = false; break;
			case "external": if (tab.state.url !== BROWSER_START) void shell.openExternal(httpAddress(tab.state.url)).catch(error => this.notice(tab, String(error))); break;
			default: throw new Error("BROWSER_ACTION_INVALID");
		}
		this.publish(tab); return { ...tab.state };
	}
	layout(owner: BrowserWindow, value: BrowserLayout): void {
		if (!value || typeof value.visible !== "boolean" || ![value.x, value.y, value.width, value.height].every(n => Number.isFinite(n) && Math.abs(n) <= 100000)) throw new Error("BROWSER_BOUNDS_INVALID");
		const tab = this.require(owner, value.id);
		if (value.visible) for (const other of this.owners.get(owner.id)!.tabs.values()) if (other !== tab) { if (other.layout) other.layout.visible = false; other.view.setVisible(false); }
		// Renderer rectangles use CSS pixels; the native view expects device-independent pixels.
		const zoom = owner.webContents.getZoomFactor(); const [width, height] = owner.getContentSize();
		const x = Math.max(0, Math.min(width, Math.round(value.x * zoom))); const y = Math.max(0, Math.min(height, Math.round(value.y * zoom)));
		tab.layout = { ...value, x, y, width: Math.max(0, Math.min(width - x, Math.round(value.width * zoom))), height: Math.max(0, Math.min(height - y, Math.round(value.height * zoom))) };
		this.show(tab);
	}
	close(owner: BrowserWindow, id: string): Promise<void> {
		this.validId(id); const group = this.owners.get(owner.id); const tab = group?.tabs.get(id);
		if (!tab) return Promise.resolve(); group!.tabs.delete(id); return this.closeTab(tab);
	}
	async dispose(): Promise<void> {
		this.disposed = true; await Promise.all([...this.owners.keys()].map(id => this.closeOwner(id))); await Promise.all([...this.closing]);
		this.releaseSession?.(); this.releaseSession = undefined;
	}
	private async closeOwner(id: number): Promise<void> {
		const group = this.owners.get(id); if (!group) return;
		this.owners.delete(id); group.unbind(); await Promise.all([...group.tabs.values()].map(tab => this.closeTab(tab)));
	}
	private closeTab(tab: Tab): Promise<void> {
		if (tab.closing) return tab.closing;
		tab.generation++; tab.view.setVisible(false);
		if (!tab.owner.isDestroyed()) tab.owner.contentView.removeChildView(tab.view);
		const contents = tab.view.webContents;
		let resolve!: () => void; const pending = new Promise<void>(done => { resolve = done; });
		tab.closing = pending; this.closing.add(pending); void pending.then(() => this.closing.delete(pending));
		if (contents.isDestroyed()) resolve(); else { contents.once("destroyed", resolve); contents.close({ waitForBeforeUnload: false }); }
		return pending;
	}
	private bind(tab: Tab): void {
		const contents = tab.view.webContents;
		contents.once("destroyed", () => {
			if (tab.closing) return;
			this.owners.get(tab.owner.id)?.tabs.delete(tab.state.id);
			if (!tab.owner.isDestroyed()) tab.owner.contentView.removeChildView(tab.view);
			this.emit(tab.owner, { type: "closed", id: tab.state.id });
		});
		const refresh = () => {
			if (tab.closing || contents.isDestroyed()) return;
			const url = contents.getURL();
			if (url) tab.state.url = url === "about:blank" ? BROWSER_START : url;
			tab.state.title = tab.state.url === BROWSER_START ? "新标签页" : contents.getTitle() || tab.state.url;
			tab.state.loading = contents.isLoading(); this.publish(tab);
		};
		contents.on("did-start-loading", () => { tab.state.error = undefined; tab.state.notice = undefined; tab.state.loading = true; this.publish(tab); });
		contents.on("did-start-navigation", (_event, url, inPlace, main) => {
			if (!main || (!this.allowed(url) && url !== "about:blank")) return;
			tab.state.url = url === "about:blank" ? BROWSER_START : url;
			if (!inPlace) { tab.state.error = undefined; tab.state.loading = true; } this.publish(tab);
		});
		contents.on("did-stop-loading", () => { if (tab.state.error) { tab.state.loading = false; this.publish(tab); } else refresh(); });
		contents.on("did-navigate", refresh); contents.on("did-navigate-in-page", refresh); contents.on("page-title-updated", () => { if (!tab.state.error) refresh(); });
		contents.on("did-fail-load", (_event, code, description, url, main) => {
			if (!main || code === -3) return;
			if (url && url !== tab.state.url && !(url === "about:blank" && tab.state.url === BROWSER_START)) return;
			tab.state.url = url || tab.state.url; tab.state.error = `${description} (${code})`; tab.state.loading = false; this.publish(tab);
		});
		contents.on("render-process-gone", (_event, details) => { tab.state.error = `页面进程已退出（${details.reason}），可刷新重试`; tab.state.loading = false; this.publish(tab); });
		contents.on("will-frame-navigate", details => {
			if (!this.allowed(details.url, !details.isMainFrame)) { details.preventDefault(); this.notice(tab, "此链接类型不能在内嵌浏览器中打开"); }
		});
		contents.on("will-redirect", (event, url) => { if (!this.allowed(url)) { event.preventDefault(); this.notice(tab, "已阻止跳转到非 HTTP/HTTPS 网址"); } });
		contents.setWindowOpenHandler(details => {
			if (this.allowed(details.url) && !details.postBody) this.emit(tab.owner, { type: "open", url: httpAddress(details.url) });
			else this.notice(tab, details.postBody ? "此操作需要新窗口提交表单，请在系统浏览器中打开" : "此链接类型不能在内嵌浏览器中打开");
			return { action: "deny" };
		});
		contents.on("will-prevent-unload", event => event.preventDefault());
		contents.on("before-input-event", (event, input) => {
			if (input.type !== "keyDown") return;
			const key = input.key.toLowerCase();
			if ((input.control || input.meta) && ["b", "k", ",", "1", "2", "3", "l"].includes(key)) {
				event.preventDefault(); tab.owner.webContents.focus(); this.emit(tab.owner, { type: "shortcut", key: key as Extract<BrowserEvent, { type: "shortcut" }>["key"] });
			} else if (key === "f5" || ((input.control || input.meta) && key === "r")) { event.preventDefault(); this.action(tab.owner, tab.state.id, "reload"); }
			else if (input.alt && (key === "arrowleft" || key === "arrowright")) { event.preventDefault(); this.action(tab.owner, tab.state.id, key === "arrowleft" ? "back" : "forward"); }
		});
	}
	private load(tab: Tab, url: string): void {
		const generation = ++tab.generation; tab.state.url = url; tab.state.error = undefined; tab.state.notice = undefined; tab.state.loading = true; this.publish(tab);
		void tab.view.webContents.loadURL(url === BROWSER_START ? "about:blank" : url).catch(error => {
			if (tab.closing || tab.generation !== generation || String(error).includes("ERR_ABORTED")) return;
			tab.state.error = String(error); tab.state.loading = false; this.publish(tab);
		});
	}
	private show(tab: Tab): void {
		if (tab.closing) return;
		const box = tab.layout;
		if (box) tab.view.setBounds({ x: box.x, y: box.y, width: box.width, height: box.height });
		tab.view.setVisible(Boolean(box?.visible && box.width > 0 && box.height > 0 && tab.state.url !== BROWSER_START && !tab.state.error));
	}
	private publish(tab: Tab): void {
		if (tab.closing || tab.view.webContents.isDestroyed()) return;
		const history = tab.view.webContents.navigationHistory;
		tab.state.canGoBack = history.canGoBack(); tab.state.canGoForward = history.canGoForward(); tab.state.revision = ++this.revision;
		this.show(tab); this.emit(tab.owner, { type: "state", state: { ...tab.state } });
	}
	private notice(tab: Tab, notice: string): void { tab.state.notice = notice; this.publish(tab); }
	private emit(owner: BrowserWindow, event: BrowserEvent): void { if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) owner.webContents.send(IpcEvent.browser, event); }
	private validId(id: string): void { if (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id)) throw new Error("BROWSER_ID_INVALID"); }
	private require(owner: BrowserWindow, id: string): Tab {
		this.validId(id); const tab = this.owners.get(owner.id)?.tabs.get(id);
		if (this.disposed || !tab || tab.closing) throw new Error("BROWSER_NOT_FOUND"); return tab;
	}
	private allowed(url: string, child = false): boolean { try { if (child && (url === "about:blank" || url === "about:srcdoc")) return true; httpAddress(url); return true; } catch { return false; } }
	private getSession(): Session {
		if (this.browserSession) return this.browserSession;
		const isolated = this.browserSession = session.fromPartition(BROWSER_PARTITION);
		const permission = (name: string, origin: string) => {
			try { return ["local-network", "local-network-access", "loopback-network"].includes(name) && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname); } catch { return false; }
		};
		isolated.setPermissionCheckHandler((_contents, name, origin) => permission(name, origin));
		isolated.setPermissionRequestHandler((contents, name, callback, details) => {
			const allowed = permission(name, details.requestingUrl || contents.getURL()); callback(allowed);
			if (!allowed) this.forContents(contents, tab => this.notice(tab, `页面权限 ${name} 暂未开放，可在系统浏览器中使用`));
		});
		const download = (event: ElectronEvent, _item: DownloadItem, contents: WebContents) => { event.preventDefault(); this.forContents(contents, tab => this.notice(tab, "请在系统浏览器中下载文件")); };
		isolated.on("will-download", download);
		this.releaseSession = () => { isolated.off("will-download", download); isolated.setPermissionCheckHandler(null); isolated.setPermissionRequestHandler(null); };
		return isolated;
	}
	private forContents(contents: WebContents, action: (tab: Tab) => void): void { for (const group of this.owners.values()) for (const tab of group.tabs.values()) if (tab.view.webContents === contents) action(tab); }
}
