import { CloudMirror } from "../../shared/cloud-state";

let mirror: CloudMirror | undefined;
let database: IDBDatabase | undefined;
let dirty = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function cloudRead<T>(channel: string): T | undefined {
	return window.runtime?.mode === "cloud" ? mirror?.read<T>(channel) : undefined;
}

export async function openCloudCache(url: string, instance: string): Promise<CloudMirror> {
	mirror = new CloudMirror(url, instance);
	try {
		database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("rally-cloud-cache-v1", 1);
			const timeout = setTimeout(() => reject(Error("Cache unavailable")), 1500);
			request.onupgradeneeded = () => request.result.createObjectStore("profiles");
			request.onsuccess = () => {
				clearTimeout(timeout);
				resolve(request.result);
			};
			request.onerror = () => {
				clearTimeout(timeout);
				reject(request.error);
			};
			request.onblocked = () => {
				clearTimeout(timeout);
				reject(Error("Cache blocked"));
			};
		});
		const value = await new Promise<unknown>((resolve, reject) => {
			const request = database!.transaction("profiles").objectStore("profiles").get(mirror!.scope);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		mirror.restore(value);
	} catch {
		/* Cache failures never prevent a cloud connection. */
	}
	return mirror;
}

export function saveCloudCache(): void {
	dirty = true;
	if (!timer) timer = setTimeout(flushCloudCache, 1500);
}

export function flushCloudCache(): void {
	clearTimeout(timer);
	timer = undefined;
	if (!dirty || !database || !mirror) return;
	dirty = false;
	try {
		const request = database
			.transaction("profiles", "readwrite")
			.objectStore("profiles")
			.put(mirror.encode(), mirror.scope);
		request.onerror = () => {
			/* Quota/private-mode failures can be retried on the next update. */
		};
	} catch {
		/* Optional, bounded local cache. */
	}
}

window.addEventListener("pagehide", flushCloudCache);
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") flushCloudCache();
});
