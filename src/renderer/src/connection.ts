import type { ConnectionBridge, ConnectionState } from "../../shared/connection";
import { createApi } from "../../shared/client-api";
import { IpcChannel as C, IpcEvent, type RallyApi } from "../../shared/ipc";
import { serverPath } from "./server-path";
import { flushCloudCache, openCloudCache, saveCloudCache } from "./cloud-cache";
import type { CloudEvents } from "../../shared/cloud-state";
import type { UploadState, ResourceSaveProgress } from "../../shared/resources";
import type { CloseBehavior } from "../../shared/desktop";

interface Native {
	call(id: string, method: string, json: string): void;
}
declare global {
	interface Window {
		rallyLocal?: RallyApi;
		rallyConnection?: ConnectionBridge;
		RallyAndroid?: Native;
		rallyReply?: (id: string, ok: boolean, value: unknown) => void;
		runtime: ConnectionState;
	}
}
function androidBridge(native: Native): ConnectionBridge {
	const pending = new Map<
		string,
		{ done: (value: unknown) => void; fail: (err: Error) => void; timeout?: ReturnType<typeof setTimeout> }
	>();
	window.rallyReply = (id, ok, value) => {
		const p = pending.get(id);
		if (!p) return;
		clearTimeout(p.timeout);
		pending.delete(id);
		if (ok) p.done(value);
		else p.fail(Error(String(value)));
	};
	function call<T>(method: string, args: unknown[]): Promise<T> {
		const id = crypto.randomUUID();
		return new Promise((done, fail) => {
			const timeout = method === "saveResource" ? undefined : setTimeout(() => {
				pending.delete(id);
				fail(Error("连接超时，请核对服务器状态后重试"));
			}, method === "upload" ? 150000 : 75000);
			pending.set(id, { done: (value) => done(value as T), fail, timeout });
			try {
				native.call(id, method, JSON.stringify(args));
			} catch (error) {
				clearTimeout(timeout);
				pending.delete(id);
				fail(error);
			}
		});
	}
	return {
		openExternal: url => call("openExternal", [url]),
		setAppearance: (dark, background) => call("setAppearance", [dark, background]),
		state: () => call("state", []),
		select: (...args) => call("select", args),
		request: (...args) => call("request", args),
		upload: async (id, offset, bytes) => {
			// Each native message remains below the bridge's 1 MiB JSON bound.
			let state;
			for (let part = 0; part < bytes.length; part += 256 * 1024) {
				const chunk = bytes.subarray(part, part + 256 * 1024);
				let binary = ""; for (let start = 0; start < chunk.length; start += 8192) binary += String.fromCharCode(...chunk.subarray(start, start + 8192));
				state = await call<UploadState>("upload", [id, offset + part, btoa(binary)]);
			}
			if (!state) throw Error("上传分块为空"); return state;
		},
		saveResource: (...args) => call("saveResource", args),
		cancelSave: id => call("cancelSave", [id]),
	};
}
export const bridge = window.rallyConnection ?? (window.RallyAndroid ? androidBridge(window.RallyAndroid) : undefined);
let dispose = () => {};
let connected = false;
export function isConnected() {
	return window.runtime?.mode !== "cloud" || connected;
}
export function disconnect() {
	dispose();
}

async function avatar(): Promise<string | null> {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "image/png,image/jpeg,image/webp";
	const file = await new Promise<File | undefined>((done) => {
		input.onchange = () => done(input.files?.[0]);
		input.oncancel = () => done(undefined);
		input.click();
	});
	if (!file) return null;
	if (file.size > 5 * 1024 * 1024) throw Error("图片不能超过 5 MiB");
	const image = await createImageBitmap(file);
	try {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 256;
		const edge = Math.min(image.width, image.height);
		canvas
			.getContext("2d")!
			.drawImage(image, (image.width - edge) / 2, (image.height - edge) / 2, edge, edge, 0, 0, 256, 256);
		return canvas.toDataURL("image/png");
	} finally {
		image.close();
	}
}

export async function connect() {
	disconnect();
	if (!bridge) throw Error("此页面需要 Rally 客户端");
	const state = (window.runtime = await bridge.state());
	if (state.mode === "choose") return state;
	if (state.mode === "local") {
		window.rally = window.rallyLocal!;
		return state;
	}
	const mirror = await openCloudCache(state.url, state.instance);
	const listeners = new Map<string, Set<(event: unknown, data: never) => void>>();
	let online = false,
		stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let submission: { text: string; id: string } | undefined;
	const nativeWindow = window.rallyLocal?.window;
	const stopWindow = nativeWindow?.onMaximizedChange((value) => {
		for (const cb of listeners.get(IpcEvent.windowMaximizedChanged) ?? []) cb(null, value as never);
	});
	const stopDownloads = window.rallyLocal?.resources.onSave(progress => {
		for (const cb of listeners.get(IpcEvent.resourceSave) ?? []) cb(null, progress as never);
	});
	const stopBrowser = window.rallyLocal?.browser.onEvent(event => {
		for (const cb of listeners.get(IpcEvent.browser) ?? []) cb(null, event as never);
	});
	const androidProgress = (event: Event) => { for (const cb of listeners.get(IpcEvent.resourceSave) ?? []) cb(null, (event as CustomEvent<ResourceSaveProgress>).detail as never); };
	window.addEventListener("rally-resource-save", androidProgress);
	dispose = () => {
		flushCloudCache();
		stopped = true;
		connected = online = false;
		clearTimeout(timer);
		stopWindow?.();
		stopDownloads?.();
		stopBrowser?.();
		window.removeEventListener("rally-resource-save", androidProgress);
		listeners.clear();
	};
	const inflight = new Map<string, Promise<unknown>>();
	async function rpc<T>(channel: string, args: unknown[] = [], requestId?: string): Promise<T> {
		// All mounted settings/picker consumers share a read in flight.
		const read = channel.endsWith(":state") && args.length === 0;
		if (read && inflight.has(channel)) return inflight.get(channel) as Promise<T>;
		const call = bridge!.request<T>("rpc", { channel, args, requestId });
		if (read) inflight.set(channel, call);
		try {
			const result = await call;
			if (stopped) throw Error("连接已切换");
			mirror.remember(channel, result);
			if (read) saveCloudCache();
			return result;
		} finally {
			if (read && inflight.get(channel) === call) inflight.delete(channel);
		}
	}
	window.rally = createApi({
		async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
			if (channel === C.desktopState || channel === C.desktopUpdate || channel === C.desktopSetOpenAtLogin) {
				if (!window.rallyLocal?.desktop) throw Error("此设置仅适用于桌面客户端");
				if (channel === C.desktopState) return await window.rallyLocal.desktop.getState() as T;
				if (channel === C.desktopSetOpenAtLogin) return await window.rallyLocal.desktop.setOpenAtLogin(args[0] as boolean) as T;
				return await window.rallyLocal.desktop.update(args[0] as CloseBehavior) as T;
			}
			if (channel === C.windowIsMaximized) return ((await nativeWindow?.isMaximized()) ?? false) as T;
			if (channel === C.notificationsTarget) return null as T;
			if (channel === C.workspacePick) return (await serverPath()) as T;
			const browser = window.rallyLocal?.browser;
			if (channel === C.terminalOpenLink && bridge?.openExternal) return await bridge.openExternal(args[0] as string) as T;
			if (channel === C.browserCreate) { if (!browser) throw Error("此设备使用默认浏览器打开链接"); return await browser.create(...args as Parameters<RallyApi["browser"]["create"]>) as T; }
			if (channel === C.browserNavigate) { if (!browser) throw Error("此设备使用默认浏览器打开链接"); return await browser.navigate(...args as Parameters<RallyApi["browser"]["navigate"]>) as T; }
			if (channel === C.browserAction) { if (!browser) throw Error("此设备使用默认浏览器打开链接"); return await browser.action(...args as Parameters<RallyApi["browser"]["action"]>) as T; }
			if (channel === C.browserLayout) return await browser?.layout(args[0] as Parameters<RallyApi["browser"]["layout"]>[0]) as T;
			if (channel === C.browserClose) return await browser?.close(args[0] as string) as T;
			if (channel !== C.modelsState && channel !== C.memoryState) {
				const saved = mirror.read<T>(channel);
				if (saved !== undefined) return saved;
			}
			if (!online || stopped) throw Error("未连接到服务器");
			if (channel === C.resourceAppend || channel === C.resourceSave || channel === C.resourceCancelSave) {
				const result = channel === C.resourceAppend ? await bridge!.upload(args[0] as string, args[1] as number, args[2] as Uint8Array)
					: channel === C.resourceSave ? await bridge!.saveResource(args[0] as string, args[1] as string) : await bridge!.cancelSave(args[0] as string);
				if (stopped) throw Error("连接已切换"); return result as T;
			}
			if (channel === C.identityPickAvatar) {
				const image = await avatar();
				if (!image) return null as T;
				args = [image];
			}
			let requestId: string | undefined;
			if (channel === C.chatSend) {
				const text = JSON.stringify([args[0], args[1] ?? []]);
				if (submission?.text !== text) submission = { text, id: crypto.randomUUID() };
				requestId = submission.id;
			}
			const result = await rpc<T>(channel, args, requestId);
			if (channel === C.resourcePreview) {
				if (typeof result !== "string" || !result.startsWith("/v1/resources/")) throw Error("无效预览地址");
				const url = new URL(result, state.url); if (url.origin !== state.url) throw Error("无效预览地址"); return url.href as T;
			}
			if (requestId && submission?.id === requestId) submission = undefined;
			return result;
		},
		send(channel) {
			if (channel === C.windowClose) nativeWindow?.close();
			if (channel === C.windowMinimize) nativeWindow?.minimize();
			if (channel === C.windowToggleMaximize) nativeWindow?.toggleMaximize();
		},
		on(channel, cb) {
			if (!listeners.has(channel)) listeners.set(channel, new Set());
			listeners.get(channel)!.add(cb);
		},
		off(channel, cb) {
			listeners.get(channel)?.delete(cb);
		},
	});
	async function poll() {
		const result = await bridge!.request<CloudEvents>("events", { epoch: mirror.epoch, seq: mirror.seq });
		if (stopped) return;
		if (!Array.isArray(result.events) || typeof result.epoch !== "string" || !Number.isSafeInteger(result.seq))
			throw Error("服务器事件响应无效");
		const recovered = !online;
		mirror.apply(result);
		if (result.events.length) saveCloudCache();
		connected = online = true;
		for (const event of result.events) {
			if (event.channel === "cloud:configuration") {
				window.dispatchEvent(
					new CustomEvent("rally-configuration", { detail: (event.data as { domain: string }).domain }),
				);
				continue;
			}
			for (const cb of listeners.get(event.channel) ?? []) cb(null, event.data as never);
		}
		window.dispatchEvent(new CustomEvent("rally-network", { detail: true }));
		if (recovered) {
			void rpc(C.userSeen).catch(error => console.error("用户在线信号失败", error));
			window.dispatchEvent(new CustomEvent("rally-configuration", { detail: "models" }));
			window.dispatchEvent(new CustomEvent("rally-configuration", { detail: "memory" }));
		}
	}
	if (!mirror.complete) {
		await poll();
		await Promise.allSettled([rpc(C.modelsState), rpc(C.memoryState)]);
	}
	const loop = async () => {
		if (stopped) return;
		try {
			await poll();
		} catch (error) {
			if (stopped) return;
			connected = online = false;
			window.dispatchEvent(new CustomEvent("rally-network", { detail: false }));
		}
		if (!stopped) timer = setTimeout(loop, online ? 900 : 3000);
	};
	// A cached start paints immediately; writes stay disabled until the server validates this device.
	timer = setTimeout(loop, online ? 900 : 0);
	return state;
}
