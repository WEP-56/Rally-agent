/// <reference lib="dom" />
import { randomUUID, createHash } from "node:crypto";
import { join, basename, dirname } from "node:path";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import type { ResourceStore } from "../resource-store.ts";
import { resourceRef, type ResourceRef } from "../../shared/resources.ts";
import { chromium, type BrowserContext, type Page, type Download, type Locator } from "playwright";
import { httpAddress } from "../../shared/browser.ts";
import type { AgentBrowserWindow, AgentBrowserAction, BrowserObservation, BrowserFrame, BrowserUserInput } from "../../shared/agent-browser.ts";
import type { WebsiteAccounts } from "../website-accounts.ts";
import type { ProcessRegistry } from "../supervisor/process-registry.ts";
import { managedContext } from "./managed-context.ts";

interface WindowState {
	view: AgentBrowserWindow;
	page: Page;
	pages: Map<string, Page>;
	downloads: Map<string, Download>;
	uploads: Set<string>;
	tail: Promise<unknown>;
	device?: string;
	lease?: ReturnType<typeof setTimeout>;
	frame?: BrowserFrame;
	frames: Map<number, { width: number; height: number }>;
	framePending?: Promise<BrowserFrame>;
	framePreview?: boolean;
	observed?: number;
}
interface Reservation { taskId: string; runId: string; signal?: AbortSignal; resolve(): void; reject(error: Error): void; abort(): void }

/** One Chromium process and persistent login profile, with separate task windows. */
export class AgentBrowserService {
	private readonly profile: string;
	private readonly accounts: WebsiteAccounts;
	private readonly processes?: ProcessRegistry;
	private readonly historyFile: string;
	private readonly history: AgentBrowserWindow[];
	private readonly staging: string;
	private recovery?: Promise<void>;
	private context?: Promise<BrowserContext>;
	private readonly windows = new Map<string, WindowState>();
	private readonly waiting: Reservation[] = [];
	private opening = 0;
	private closed = false;
	private clearing = false;
	private frameSeq = 0;
	private openingTail: Promise<unknown> = Promise.resolve();
	private readonly openingTasks = new Map<string, Promise<AgentBrowserWindow>>();
	private readonly openingControllers = new Map<string, AbortController>();
	private readonly secrets = new Set<string>();
	private readonly controlListeners = new Set<() => void>();
	private readonly maskAttribute = `data-rally-mask-${randomUUID()}`;

	async waitForAgent(id: string, signal?: AbortSignal): Promise<boolean> {
		const window = this.require(id); let waited = false;
		while (window.view.owner !== "agent") {
			signal?.throwIfAborted(); this.require(id); waited = true;
			await new Promise<void>((resolve, reject) => {
				const changed = () => { cleanup(); resolve(); };
				const abort = () => { cleanup(); reject(Error("浏览器等待已取消")); };
				const cleanup = () => { this.controlListeners.delete(changed); signal?.removeEventListener("abort", abort); };
				this.controlListeners.add(changed); signal?.addEventListener("abort", abort, { once: true });
				if (signal?.aborted) abort();
			});
		}
		return waited;
	}
	assertTask(id: string, taskId: string, runId: string): void {
		const window = this.require(id);
		if (window.view.taskId !== taskId || window.view.runId !== runId) throw Error("不能操作其他任务或运行的浏览器窗口");
	}
	accountsFor(id: string) {
		const window = this.require(id);
		return this.accounts.state().accounts.filter(account => account.enabled && account.kind !== "secret" && account.origin === window.view.origin);
	}

	constructor(profile: string, accounts: WebsiteAccounts, processes?: ProcessRegistry) {
		this.profile = profile; this.accounts = accounts; this.processes = processes;
		this.historyFile = join(dirname(profile), "browser-windows.json");
		this.staging = join(dirname(profile), "browser-files");
		this.history = existsSync(this.historyFile) ? JSON.parse(readFileSync(this.historyFile, "utf8")) : [];
		if (!Array.isArray(this.history) || this.history.some(item => typeof item.id !== "string" || typeof item.taskId !== "string" || typeof item.runId !== "string" || !Number.isFinite(item.createdAt))) throw Error("浏览器历史记录损坏");
		for (const item of this.history) { item.owner = "closed"; item.epoch++; item.operation = "浏览器已结束"; item.tabs = []; }
	}
	recover(): Promise<void> {
		return this.recovery ??= (async () => {
			await this.processes?.recover();
			await rm(this.staging, { recursive: true, force: true });
			await mkdir(this.staging, { recursive: true, mode: 0o700 });
		})();
	}
	state(): AgentBrowserWindow[] { return [...this.history.map(item => ({ ...item })), ...this.windows.values()].map(item => "view" in item ? ({ ...item.view, tabs: this.tabs(item) }) : item); }
	isWaiting(taskId: string): boolean {
		return this.waiting.some(item => item.taskId === taskId) || [...this.windows.values()].some(window => window.view.taskId === taskId && ["taking", "user", "waiting"].includes(window.view.owner));
	}

	open(taskId: string, runId: string, url: string, signal?: AbortSignal): Promise<AgentBrowserWindow> {
		if (this.clearing) return Promise.reject(Error("正在清除浏览器登录态，请稍后再打开"));
		const key = `${taskId}:${runId}`;
		const pending = this.openingTasks.get(key); if (pending) return pending;
		const controller = new AbortController(); this.openingControllers.set(key, controller);
		const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
		const next = this.openWindow(taskId, runId, url, combined).finally(() => { this.openingTasks.delete(key); this.openingControllers.delete(key); });
		this.openingTasks.set(key, next); return next;
	}

	private async openWindow(taskId: string, runId: string, url: string, signal?: AbortSignal): Promise<AgentBrowserWindow> {
		const address = httpAddress(url); signal?.throwIfAborted();
		const existing = [...this.windows.values()].find(window => window.view.taskId === taskId && window.view.runId === runId && window.view.owner !== "closed");
		if (existing) return { ...existing.view };
		await this.reserve(taskId, runId, signal);
		try {
			const create = this.openingTail.then(async () => {
				signal?.throwIfAborted(); if (this.closed) throw Error("浏览器服务已关闭");
				await this.recover();
				this.context ??= (this.processes ? managedContext(this.processes, this.profile) : chromium.launchPersistentContext(this.profile, { headless: true, viewport: { width: 1280, height: 800 }, acceptDownloads: true })).then(async context => {
					// Target.createTarget creates the actual task windows; discard Chromium's startup tab.
					for (const page of context.pages()) await page.close();
					context.once("close", () => {
						this.context = undefined;
						for (const window of this.windows.values()) { window.view.owner = "closed"; window.view.epoch++; window.view.operation = "浏览器已关闭或连接中断"; clearTimeout(window.lease); this.invalidate(window); }
						this.save();
						this.release();
					});
					return context;
				}).catch(error => { this.context = undefined; throw error; });
				const context = await this.context;
				context.setDefaultTimeout(15000);
				const control = await context.browser()!.newBrowserCDPSession();
				let target: Promise<{ targetId: string }>;
				const pagePromise = context.waitForEvent("page", { timeout: 15000, predicate: async page => {
					const session = await context.newCDPSession(page);
					try { return (await session.send("Target.getTargetInfo")).targetInfo.targetId === (await target).targetId; }
					finally { await session.detach(); }
				} });
				target = control.send("Target.createTarget", { url: "about:blank", newWindow: true });
				let page: Page;
				try { await target; page = await pagePromise; } finally { await control.detach(); }
				const window: WindowState = { view: { id: randomUUID(), taskId, runId, createdAt: Date.now(), owner: "agent", epoch: 1, document: 0, origin: "", operation: "打开网页" }, page, pages: new Map(), downloads: new Map(), uploads: new Set(), tail: Promise.resolve(), frames: new Map() };
				this.windows.set(window.view.id, window);
				this.save();
				this.attach(window, page);
				try {
					await this.enqueue(window, async () => { signal?.throwIfAborted(); await page.goto(address); signal?.throwIfAborted(); if (window.view.owner === "agent") window.view.operation = "等待操作"; });
				}
				catch (error) { await page.close(); throw error; }
				this.save();
				return { ...window.view };
			});
			this.openingTail = create.catch(() => {});
			return await create;
		} finally { this.opening--; this.release(); }
	}

	async snapshot(id: string): Promise<BrowserObservation> {
		const window = this.require(id), epoch = window.view.epoch;
		return this.enqueue(window, async () => {
			this.agent(window, epoch);
			const document = window.view.document;
			await this.capturePrivateValues(window);
			const snapshot = await window.page.ariaSnapshot({ mode: "ai" });
			this.agent(window, epoch);
			if (document !== window.view.document) throw Error("页面已导航，请重新观察");
			window.observed = document;
			return { windowId: id, epoch, document, snapshot: this.redact(snapshot), tabs: this.tabs(window), downloads: [...window.downloads].map(([id, download]) => ({ id, name: this.redact(download.suggestedFilename()) })) };
		});
	}
	async screenshot(id: string): Promise<string> {
		const window = this.require(id), epoch = window.view.epoch;
		this.agent(window, epoch);
		const frame = await this.frame(id, true);
		this.agent(window, epoch);
		return frame.data;
	}

	async navigate(id: string, url: string): Promise<void> {
		const window = this.require(id), epoch = window.view.epoch, address = httpAddress(url);
		await this.enqueue(window, async () => {
			this.agent(window, epoch); window.view.operation = "打开网页"; this.invalidate(window);
			await window.page.goto(address);
		});
	}

	async freeze(observation: Omit<BrowserObservation, "snapshot">, action: AgentBrowserAction): Promise<string> {
		const window = this.require(observation.windowId);
		return this.enqueue(window, async () => { this.agent(window, observation.epoch); this.reference(window, observation.document); return this.fingerprint(window.page, action); });
	}
	async action(observation: Omit<BrowserObservation, "snapshot">, action: AgentBrowserAction, frozen?: string): Promise<void> {
		const window = this.require(observation.windowId);
		await this.enqueue(window, async () => {
			this.agent(window, observation.epoch); this.reference(window, observation.document);
			if (frozen && frozen !== await this.fingerprint(window.page, action)) throw Error("待批准的页面目标或表单内容已改变，请重新观察并申请");
			window.view.operation = { click: "点击页面", fill: "填写页面", press: "按键操作", select: "选择选项", scroll: "滚动页面", tab: "切换标签页" }[action.kind];
			const page = window.page;
			if (action.kind === "tab") await this.selectTab(window, action.tabId, action.close);
			else if (action.kind === "scroll") await page.mouse.wheel(action.x, action.y);
			else {
				const element = page.getByRef(action.ref);
				if (action.kind === "click") await element.click();
				if (action.kind === "fill") {
					if (await element.getAttribute("type") === "password") throw Error("密码请通过 browser_login 填写");
					await element.fill(action.text);
				}
				if (action.kind === "press") await element.press(action.key);
				if (action.kind === "select") await element.selectOption(action.values);
			}
			this.invalidate(window);
		});
	}
	async upload(observation: Omit<BrowserObservation, "snapshot">, ref: string, path: string, name: string, frozen: string): Promise<void> {
		const window = this.require(observation.windowId);
		await this.enqueue(window, async () => {
			this.agent(window, observation.epoch); this.reference(window, observation.document);
			if (frozen !== await this.fingerprint(window.page, { kind: "click", ref })) throw Error("上传目标已改变，请重新申请");
			window.view.operation = "上传已授权文件";
			const directory = await mkdtemp(join(this.staging, "upload-"));
			window.uploads.add(directory);
			const target = join(directory, basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_"));
			await copyFile(path, target);
			await window.page.getByRef(ref).setInputFiles(target);
			window.view.operation = `已上传 ${this.redact(name)}`; this.invalidate(window);
		});
	}
	async download(observation: Omit<BrowserObservation, "snapshot">, id: string, store: ResourceStore, signal?: AbortSignal): Promise<ResourceRef> {
		const window = this.require(observation.windowId);
		return this.enqueue(window, async () => {
			this.agent(window, observation.epoch); this.reference(window, observation.document);
			const download = window.downloads.get(id); if (!download) throw Error("下载不存在或不属于当前任务");
			const abort = () => { void download.cancel(); };
			signal?.addEventListener("abort", abort, { once: true });
			const directory = await mkdtemp(join(this.staging, "download-"));
			try {
				signal?.throwIfAborted();
				const name = basename(this.redact(download.suggestedFilename())).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
				const path = join(directory, name && name !== "." && name !== ".." ? name : "download");
				await download.saveAs(path);
				this.agent(window, observation.epoch);
				const resource = await store.importFile(`task:${window.view.taskId}`, path, [this.staging], "generated", signal);
				return resourceRef(resource);
			} finally { signal?.removeEventListener("abort", abort); await download.delete(); window.downloads.delete(id); await rm(directory, { recursive: true, force: true }); }
		});
	}

	async login(observation: Omit<BrowserObservation, "snapshot">, accountId: string, usernameRef: string, passwordRef: string): Promise<void> {
		const window = this.require(observation.windowId);
		await this.enqueue(window, async () => {
			this.agent(window, observation.epoch); this.reference(window, observation.document);
			const site = this.origin(window.page.url());
			const credentials = this.accounts.forHost(accountId, site);
			this.secrets.add(credentials.username); this.secrets.add(credentials.password);
			window.frame = undefined; window.view.operation = "填写已授权账号";
			// One renderer operation checks both document origin and field origins immediately before setting either value.
			const username = await window.page.getByRef(usernameRef).elementHandle();
			const password = await window.page.getByRef(passwordRef).elementHandle();
			try {
				this.agent(window, observation.epoch); this.reference(window, observation.document);
				await window.page.evaluate(({ username, password, credentials, site }) => {
					if (location.origin !== site || !(username instanceof HTMLInputElement) || !(password instanceof HTMLInputElement) || !username.isConnected || !password.isConnected || username.ownerDocument !== document || password.ownerDocument !== document || password.type !== "password") throw Error("账号填写目标已失效");
					const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
					setter.call(username, credentials.username); setter.call(password, credentials.password);
					for (const element of [username, password]) { element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); }
				}, { username, password, credentials, site });
			} catch { throw Error("账号填写失败，请重新观察页面"); }
			finally { await username?.dispose(); await password?.dispose(); this.invalidate(window); }
		});
	}

	async take(id: string, device: string): Promise<AgentBrowserWindow> {
		const window = this.require(id);
		if (["taking", "user"].includes(window.view.owner)) throw Error("此窗口已被接管");
		window.view.owner = "taking"; window.device = device; window.view.epoch++; this.invalidate(window);
		await window.tail;
		if (window.view.owner !== "taking" || window.device !== device) throw Error("接管已失效");
		window.view.owner = "user"; window.view.operation = "用户接管中";
		this.heartbeat(id, device);
		return { ...window.view };
	}

	async handBack(id: string, device: string): Promise<AgentBrowserWindow> {
		const window = this.require(id);
		if (window.view.owner !== "user" || window.device !== device) throw Error("当前设备没有控制权");
		window.view.owner = "waiting"; const epoch = ++window.view.epoch; this.invalidate(window);
		await window.tail;
		this.require(id);
		if (window.device !== device || window.view.epoch !== epoch) throw Error("交还已失效，请重新接管");
		window.device = undefined; window.view.owner = "agent"; window.view.operation = "已交还，等待重新观察";
		clearTimeout(window.lease);
		for (const changed of this.controlListeners) changed();
		return { ...window.view };
	}

	heartbeat(id: string, device: string): void {
		const window = this.require(id);
		if (window.device !== device || window.view.owner !== "user") throw Error("当前设备没有控制权");
		clearTimeout(window.lease);
		window.lease = setTimeout(() => this.disconnect(device, id), 15000);
		window.lease.unref();
	}
	disconnect(device: string, id?: string): void {
		for (const window of this.windows.values()) if ((!id || window.view.id === id) && window.device === device && window.view.owner !== "closed") {
			clearTimeout(window.lease);
			window.device = undefined; window.view.owner = "waiting"; window.view.epoch++; this.invalidate(window); window.view.operation = "连接断开，等待重新接管";
		}
	}

	async input(id: string, device: string, frame: Pick<BrowserFrame, "epoch" | "document" | "seq">, input: BrowserUserInput): Promise<void> {
		const window = this.require(id);
		await this.enqueue(window, async () => {
			if (window.view.owner !== "user" || window.device !== device || frame.epoch !== window.view.epoch || frame.document !== window.view.document || !window.frames.has(frame.seq)) throw Error("控制权或画面已过期");
			this.heartbeat(id, device);
			try {
			if (input.kind === "click" || input.kind === "drag") {
				const size = window.frames.get(frame.seq)!;
				const points = input.kind === "click" ? [input] : input.points;
				if (points.some(point => ![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x >= size.width || point.y >= size.height)) throw Error("点击坐标超出画面");
				if (input.kind === "click") await window.page.mouse.click(input.x, input.y);
				else {
					await window.page.mouse.move(points[0].x, points[0].y);
					try {
						await window.page.mouse.down();
						for (const point of points.slice(1)) {
							if (window.view.owner !== "user" || window.view.epoch !== frame.epoch || window.view.document !== frame.document) throw Error("拖动期间页面或控制权已改变");
							await window.page.mouse.move(point.x, point.y);
						}
					} finally { await window.page.mouse.up(); }
				}
			} else if (input.kind === "text") { if (input.text) this.secrets.add(input.text); await window.page.keyboard.insertText(input.text); }
			else if (input.kind === "key") {
				try { await window.page.keyboard.press(input.key); }
				finally { for (const key of ["Alt", "Control", "Meta", "Shift"]) await window.page.keyboard.up(key); }
			}
			else if (input.kind === "tab") await this.selectTab(window, input.tabId);
			else await window.page.mouse.wheel(input.x, input.y);
			} finally { this.invalidate(window); }
		});
	}

	async frame(id: string, preview = false, device?: string): Promise<BrowserFrame> {
		const window = this.require(id);
		const canView = () => {
			this.require(id);
			if (window.view.owner !== "agent" && (window.view.owner !== "user" || window.device !== device)) throw Error("私密画面仅当前控制设备可读取");
		};
		canView();
		if (window.framePending) {
			if (preview !== window.framePreview) throw Error("画面正在更新，请稍后重试");
			const frame = await window.framePending; canView(); return frame;
		}
		const pending = this.enqueue(window, async () => {
			canView();
			this.require(id);
			const epoch = window.view.epoch, documentId = window.view.document;
			const page = window.page;
			const privateInput = await this.capturePrivateValues(window);
			if (preview && (privateInput || window.view.owner !== "agent")) throw Error("私密操作中，缩略图已暂停");
			// CDP-attached pages have no configured viewport; use their actual CSS dimensions.
			const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
			const mask = window.view.owner !== "user";
			const image = await page.screenshot({
				type: "jpeg", quality: 65, scale: "css",
				mask: mask ? await this.privateMasks(page) : undefined,
				animations: mask ? "disabled" : "allow",
				style: mask ? "input,textarea,[contenteditable] { color: transparent !important; text-shadow: none !important; }" : undefined,
			});
			canView();
			if (epoch !== window.view.epoch || documentId !== window.view.document) throw Error("页面已改变，请重新获取画面");
			const frame: BrowserFrame = { windowId: id, epoch, document: documentId, seq: ++this.frameSeq, ...viewport, data: image.toString("base64") };
			window.frame = frame;
			window.frames.set(frame.seq, viewport);
			if (window.frames.size > 8) window.frames.delete(window.frames.keys().next().value!);
			return frame;
		});
		window.framePending = pending;
		window.framePreview = preview;
		try { return await pending; } finally { window.framePending = undefined; }
	}

	async closeTask(taskId: string): Promise<void> {
		for (const [key, controller] of this.openingControllers) if (key.startsWith(`${taskId}:`)) controller.abort();
		for (const reservation of [...this.waiting]) if (reservation.taskId === taskId) reservation.abort();
		await this.openingTail;
		await Promise.all([...this.windows.values()].filter(window => window.view.taskId === taskId && (window.view.owner !== "closed" || window.downloads.size || window.uploads.size)).map(async window => {
			window.view.owner = "closed"; window.view.epoch++; this.invalidate(window);
			clearTimeout(window.lease);
			await Promise.all([...window.downloads.values()].map(download => download.cancel()));
			await Promise.all([...window.pages.values()].map(page => page.close())); await window.tail;
			await Promise.all([...window.downloads.values()].map(download => download.delete())); window.downloads.clear();
			await Promise.all([...window.uploads].map(directory => rm(directory, { recursive: true, force: true }))); window.uploads.clear();
		}));
		this.release();
	}
	async dispose(): Promise<void> {
		this.closed = true;
		for (const controller of this.openingControllers.values()) controller.abort();
		for (const reservation of [...this.waiting]) reservation.abort();
		await this.openingTail;
		if (this.context) await (await this.context).close();
		await Promise.all([...this.windows.values()].map(window => window.tail));
		await Promise.all([...this.windows.values()].flatMap(window => [...window.uploads].map(directory => rm(directory, { recursive: true, force: true }))));
		if (this.recovery) { await this.recovery; await rm(this.staging, { recursive: true, force: true }); }
	}

	async clearLogin(): Promise<void> {
		if (this.clearing || this.active() || this.openingTasks.size || this.waiting.length) throw Error("请先结束所有浏览器任务，再清除共享登录态");
		this.clearing = true;
		try {
			if (this.context) await (await this.context).close();
			await rm(this.profile, { recursive: true, force: true });
		} finally { this.clearing = false; }
	}

	private require(id: string): WindowState {
		const window = this.windows.get(id); if (!window || window.view.owner === "closed") throw Error("任务浏览器窗口不存在或已关闭"); return window;
	}
	private tabs(window: WindowState) { return [...window.pages].map(([id, page]) => ({ id, origin: this.origin(page.url()), active: page === window.page })); }
	private async selectTab(window: WindowState, id: string, close = false): Promise<void> {
		const page = window.pages.get(id); if (!page) throw Error("标签页不存在或不属于当前任务");
		if (close) { await page.close(); return; }
		window.page = page; window.view.origin = this.origin(page.url()); await page.bringToFront();
	}
	private attach(window: WindowState, page: Page): void {
		const id = randomUUID(); window.pages.set(id, page);
		page.on("popup", popup => {
			if (window.view.owner === "closed") { void popup.close(); return; }
			this.attach(window, popup);
		});
		page.on("download", download => {
			if (window.view.owner === "closed" || window.downloads.size >= 10) { void download.cancel(); return; }
			window.downloads.set(randomUUID(), download);
		});
		page.on("framenavigated", frame => {
			if (window.page !== page) return;
			this.invalidate(window);
			if (frame === page.mainFrame()) window.view.origin = this.origin(page.url());
		});
		page.on("crash", () => { void this.closeTask(window.view.taskId); });
		page.on("close", () => {
			window.pages.delete(id);
			if (!window.pages.size) {
				window.view.owner = "closed"; window.view.epoch++; window.view.operation = "浏览器已结束"; clearTimeout(window.lease); this.invalidate(window); this.save(); this.release();
				for (const download of window.downloads.values()) void download.cancel().catch(() => console.error("任务浏览器下载取消失败"));
			}
			else if (window.page === page) { window.page = window.pages.values().next().value!; window.view.origin = this.origin(window.page.url()); this.invalidate(window); }
		});
	}
	private agent(window: WindowState, epoch: number): void {
		if (window.view.owner !== "agent" || window.view.epoch !== epoch) throw Error("浏览器正等待用户操作，请等待交还后重新观察");
	}
	private reference(window: WindowState, document: number): void {
		if (window.observed !== document || window.view.document !== document) throw Error("页面引用已过期，请重新观察");
	}
	private invalidate(window: WindowState): void { window.view.document++; window.observed = undefined; window.frame = undefined; window.frames.clear(); }
	private async capturePrivateValues(window: WindowState): Promise<boolean> {
		let privateInput = false;
		for (const value of this.accounts.privateValuesForHost()) this.secrets.add(value);
		for (const frame of window.page.frames()) {
			const values = await frame.locator('input[type="password"],input[autocomplete="username"],input[autocomplete="current-password"],input[autocomplete="new-password"]').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
			for (const value of values) if (value) this.secrets.add(value);
			privateInput ||= values.some(Boolean);
		}
		return privateInput;
	}
	private async privateMasks(page: Page): Promise<Locator[]> {
		const masks: Locator[] = [];
		const values = [...this.secrets].flatMap(value => [value, encodeURIComponent(value)]);
		for (const frame of page.frames()) {
			const marker = this.maskAttribute;
			const elements = frame.locator("body, body *");
			// Only page-owned text crosses from the page to the host. Never send the secret
			// list into an untrusted renderer, including cross-origin frames.
			const texts = await elements.evaluateAll((elements, marker) => elements.map((element, index) => {
				element.setAttribute(marker, String(index));
				return [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join("")
					+ ["title", "alt", "aria-label", "aria-valuetext"].map(name => element.getAttribute(name) ?? "").join("\n")
					+ getComputedStyle(element, "::before").content + getComputedStyle(element, "::after").content;
			}), marker);
			const selectors = texts.flatMap((text, index) => values.some(secret => text.includes(secret)) ? [`[${marker}="${index}"]`] : []);
			masks.push(frame.locator(["input", "textarea", "[contenteditable]", ...selectors].join(",")));
		}
		return masks;
	}
	private redact(text: string): string {
		const values = new Set([...this.secrets].flatMap(secret => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]));
		for (const value of [...values].sort((a, b) => b.length - a.length)) text = text.split(value).join("[private]");
		return text;
	}
	private async fingerprint(page: Page, action: AgentBrowserAction): Promise<string> {
		const value = "ref" in action ? await page.getByRef(action.ref).evaluate((element, marker) => {
			const target = element.cloneNode(true) as Element;
			for (const item of [target, ...target.querySelectorAll(`[${marker}]`)]) item.removeAttribute(marker);
			return { url: location.href, target: target.outerHTML,
				values: Array.from(document.querySelectorAll("input,textarea,select,[contenteditable]")).map(item => "value" in item ? item.value : item.textContent) };
		}, this.maskAttribute) : { url: page.url(), action };
		return createHash("sha256").update(JSON.stringify(value)).digest("hex");
	}
	private origin(url: string): string { return /^https?:/.test(url) ? new URL(url).origin : ""; }
	private enqueue<T>(window: WindowState, operation: () => Promise<T>): Promise<T> {
		const next = window.tail.then(operation).catch(error => {
			// Playwright errors include page excerpts, selectors and URLs. Keep those out of model/task logs.
			if (error instanceof Error && /^(?:[\u3400-\u9fff])/.test(error.message)) throw Error(this.redact(error.message.split("\n")[0]));
			throw Error("浏览器操作未完成；请重新观察页面确认结果，不要直接重复提交");
		});
		window.tail = next.catch(() => {}); return next;
	}
	private reserve(taskId: string, runId: string, signal?: AbortSignal): Promise<void> {
		if (this.closed) return Promise.reject(Error("浏览器服务已关闭"));
		if (this.active() + this.opening < 3) { this.opening++; return Promise.resolve(); }
		return new Promise((resolve, reject) => {
			const item: Reservation = { taskId, runId, signal, resolve, reject, abort: () => { const index = this.waiting.indexOf(item); if (index >= 0) this.waiting.splice(index, 1); signal?.removeEventListener("abort", item.abort); reject(Error("浏览器任务已取消")); } };
			this.waiting.push(item); signal?.addEventListener("abort", item.abort, { once: true }); if (signal?.aborted) item.abort();
		});
	}
	private active(): number { return [...this.windows.values()].filter(window => window.view.owner !== "closed").length; }
	private save(): void {
		mkdirSync(dirname(this.historyFile), { recursive: true });
		const data = this.state().map(({ tabs: _tabs, ...view }) => view);
		writeFileSync(`${this.historyFile}.tmp`, JSON.stringify(data), { mode: 0o600 });
		renameSync(`${this.historyFile}.tmp`, this.historyFile);
	}
	private release(): void {
		for (const changed of this.controlListeners) changed();
		while (!this.closed && this.waiting.length && this.active() + this.opening < 3) { const next = this.waiting.shift()!; next.signal?.removeEventListener("abort", next.abort); this.opening++; next.resolve(); }
	}
}
