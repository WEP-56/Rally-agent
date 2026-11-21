import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parseConnections, profilePartition, type SavedConnections } from "./connection-profiles.ts";
import { IpcChannel as C } from "../shared/ipc.ts";
import { connectionUrl, type ConnectionState } from "../shared/connection.ts";
export function connectionHost(existing: boolean, owner: () => BrowserWindow | undefined) {
	const path = join(app.getPath("userData"), "connections-v1.json");
	let saved: SavedConnections = { active: existing ? "local" : "choose", profiles: [] };
	let error: string | undefined;
	try {
		if (existsSync(path)) saved = parseConnections(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		saved = { active: "choose", profiles: [] };
		error = "连接档案无法读取，请重新选择模式并配对。";
	}
	const profile = saved.profiles.find((p) => p.url === saved.active);
	const mode = profile ? "cloud" : saved.active === "local" ? "local" : "choose";
	const state: ConnectionState = {
		mode,
		url: profile?.url ?? "",
		instance: profile?.instance ?? "",
		platform: "desktop",
		profiles: saved.profiles.map((p) => p.url),
		error,
	};
	const persist = (next: SavedConnections) => {
		writeFileSync(path + ".tmp", JSON.stringify(next), { mode: 0o600 });
		renameSync(path + ".tmp", path);
		app.relaunch();
		app.quit();
	};
	async function post(url: string, key: string, route: string, body: object) {
		if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw Error("请输入控制台生成的设备接入密钥");
		const res = await fetch(`${url}/v1/${route}`, {
			method: "POST",
			redirect: "error",
			signal: AbortSignal.timeout(60000),
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const result: unknown = await res.json();
		if (!res.ok)
			throw Error(
				result && typeof result === "object" && "error" in result ? String(result.error) : `HTTP ${res.status}`,
			);
		return result;
	}
	function guard(event: Electron.IpcMainInvokeEvent) {
		if (owner()?.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame)
			throw Error("无效窗口");
	}
	ipcMain.handle(C.connectionState, (e) => {
		guard(e);
		return state;
	});
	ipcMain.handle(C.connectionSelect, async (e, mode, url, key) => {
		guard(e);
		if (mode === "local") return persist({ ...saved, active: "local" });
		if (mode !== "cloud") throw Error("无效模式");
		url = connectionUrl(url);
		const old = saved.profiles.find((p) => p.url === url);
		if (!key && old) {
			await post(url, safeStorage.decryptString(Buffer.from(old.secret, "base64")), "rpc", {
				protocol: 1,
				instance: old.instance,
				channel: C.appInfo,
				args: [],
			});
			return persist({ ...saved, active: url });
		}
		if (
			!safeStorage.isEncryptionAvailable() ||
			(process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
		)
			throw Error("系统凭据加密不可用");
		const p = (await post(url, key, "pair", { protocol: 1 })) as {
			protocol?: unknown;
			instance?: unknown;
			token?: unknown;
		};
		if (
			p.protocol !== 1 ||
			typeof p.instance !== "string" ||
			typeof p.token !== "string" ||
			!/^[-\w]{43}$/.test(p.token)
		)
			throw Error("服务端响应无效");
		const instance = p.instance,
			token = p.token;
		const secret = safeStorage.encryptString(token).toString("base64");
		persist({ active: url, profiles: [...saved.profiles.filter((v) => v.url !== url), { url, instance, secret }] });
	});
	ipcMain.handle(C.connectionRequest, (e, route, body) => {
		guard(e);
		if (!profile || !["rpc", "events"].includes(route)) throw Error("连接不可用");
		return post(profile.url, safeStorage.decryptString(Buffer.from(profile.secret, "base64")), route, {
			...body,
			instance: profile.instance,
			protocol: 1,
		});
	});
	return { mode, partition: profile ? profilePartition(profile) : mode === "choose" ? "rally-setup" : undefined };
}
