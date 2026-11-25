import { createServer } from "node:http";
import { AGENT_BROWSER_COMMANDS, browserCommand } from "../agent-browser/commands.ts";
import { chmodSync, existsSync, lstatSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { cloudVault } from "./vault.ts";
import { cloudCommands } from "./commands.ts";
import { ChatRequests } from "./requests.ts";
import { failure, PublicError, readBody, reply } from "./http.ts";
import { businessHandlers } from "../business.ts";
import { Supervisor } from "../supervisor/index.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../paths.ts";
import { IpcEvent, IpcChannel } from "../../shared/ipc.ts";
import { RESOURCE_COMMANDS, resourceBytes, resourceCommand } from "./resources.ts";

process.umask(0o077);
const paths = resolveRallyPaths();
process.env.RALLY_CODING_AGENT_DIR = paths.agentDir;
process.env.RALLY_BUILTIN_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../skills");
const secrets = process.env.RALLY_CREDENTIALS_DIR || "/etc/rally";
const vault = cloudVault(Buffer.from(readFileSync(join(secrets, "vault.key"), "utf8").trim(), "base64url"));
const epoch = randomUUID();
let seq = 0,
	bytes = 0;
const updates: { seq: number; channel: string; data: unknown; bytes: number }[] = [];
function emit(channel: string, data: unknown) {
	const item = { seq: ++seq, channel, data, bytes: Buffer.byteLength(JSON.stringify(data)) };
	updates.push(item);
	bytes += item.bytes;
	while (updates.length > 256 || bytes > 8 * 1024 * 1024) bytes -= updates.shift()!.bytes;
}
const supervisor = new Supervisor(paths, {
	credentialVault: vault,
	emitChat: (e) => emit(IpcEvent.chat, e),
	emitTask: (e) => emit(IpcEvent.task, e),
	emitWorkspace: (e) => emit(IpcEvent.workspace, e),
	emitServices: (e) => emit(IpcEvent.services, e),
});
// Supervisor owns the directory lock before creating/recovering any runtime state.
ensureRallyDirs(paths);
const requests = new ChatRequests(join(paths.stateDir, "cloud-requests.sqlite"));
const version = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;
const methods = {
	[IpcChannel.identityPickAvatar]: (value: string) => {
		const state = supervisor.identity.setAvatar(value);
		emit(IpcEvent.identity, state);
		return state;
	},
	...cloudCommands(businessHandlers(paths, supervisor, emit)),
	[IpcChannel.appInfo]: () => ({
		name: "Rally Server",
		version,
		platform: process.platform,
		paths,
		versions: { node: process.version, chrome: "", electron: "" },
	}),
};
const socket = process.env.RALLY_SOCKET || "/run/rally-runtime/service.sock";
const pending = new Set<Promise<unknown>>();
let stopping = false;
const server = createServer(async (req, res) => {
	try {
		if (stopping) throw new PublicError("服务正在停止", 503);
		if (/^\/v1\/(uploads|resources)\//.test(req.url ?? "")) {
			const operation = resourceBytes(req, res, supervisor.resources); pending.add(operation);
			try { await operation; } finally { pending.delete(operation); }
			return;
		}
		if (req.method !== "POST" || !["/v1/rpc", "/v1/events", "/v1/device-revoked"].includes(req.url ?? ""))
			throw new PublicError("接口不存在", 404);
		const body = await readBody(req);
		if (req.url === "/v1/device-revoked") {
			if (typeof body.device !== "string") throw new PublicError("无效设备");
			supervisor.agentBrowser.disconnect(body.device); reply(res, 200, null); return;
		}
		if (req.url === "/v1/events") {
			const cursor = seq;
			let events = updates.filter((e) => e.seq > Number(body.seq)).map(({ bytes: _bytes, ...event }) => event);
			if (
				body.epoch !== epoch ||
				!Number.isSafeInteger(body.seq) ||
				Number(body.seq) > seq ||
				Number(body.seq) < seq - updates.length
			) {
				events = [
					{ seq: cursor, channel: IpcEvent.chat, data: { type: "snapshot", state: supervisor.main.state() } },
					{ seq: cursor, channel: IpcEvent.task, data: { type: "snapshot", board: supervisor.board() } },
					{ seq: cursor, channel: IpcEvent.workspace, data: supervisor.workspace.state() },
					{ seq: cursor, channel: IpcEvent.identity, data: supervisor.identity.state() },
					{ seq: cursor, channel: IpcEvent.services, data: supervisor.services.state() },
				];
			}
			reply(res, 200, { epoch, seq: cursor, events });
			return;
		}
		if (
			typeof body.channel !== "string" ||
			(!Object.hasOwn(methods, body.channel) && !RESOURCE_COMMANDS.has(body.channel) && !AGENT_BROWSER_COMMANDS.has(body.channel)) ||
			!Array.isArray(body.args) ||
			body.args.length > 5
		)
			throw new PublicError("云端不支持此操作");
		const channel = body.channel,
			args = body.args;
		const call = Promise.resolve().then(() =>
			channel === IpcChannel.chatSend
				? requests.run(body.device, body.requestId, args, () =>
							supervisor.main.send(typeof args[0] === "string" ? args[0] : "", args[1] as string[] | undefined, String(body.device)),
					)
					: AGENT_BROWSER_COMMANDS.has(channel) ? browserCommand(supervisor.agentBrowser, String(body.device ?? ""), channel, args)
					: RESOURCE_COMMANDS.has(channel) ? resourceCommand(supervisor.resources, String(body.device ?? ""), channel, args)
					: Reflect.apply(methods[channel as keyof typeof methods], undefined, args),
		);
		pending.add(call);
		try {
			const result = await call;
			if (
				/^(coach|tool-providers|models|mcp|memory|skills|trust|feishu|qqmail|qqbot|connector-tools|schedules):/.test(channel) &&
				!channel.endsWith(":state") &&
				channel !== IpcChannel.modelsFetch
			)
				emit("cloud:configuration", { domain: channel.split(":")[0] });
			reply(res, 200, result);
		} finally {
			pending.delete(call);
		}
	} catch (error) {
		failure(res, error);
	}
});
server.requestTimeout = 300000;

async function stop() {
	if (stopping) return;
	stopping = true;
	server.close();
	server.closeAllConnections();
	try {
		await supervisor.dispose(Promise.allSettled([...pending]).then(() => {}));
	} catch {
		process.exitCode = 1;
		console.error("Rally runtime shutdown failed");
	} finally {
		server.closeAllConnections();
		requests.db.close();
	}
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
try {
	await supervisor.start();
	if (!stopping) {
		// A crashed process can leave its Unix socket. The held state lock excludes another owner.
		if (process.platform !== "win32" && existsSync(socket)) {
			if (!lstatSync(socket).isSocket()) throw new Error("Runtime socket path is occupied by a file");
			unlinkSync(socket);
		}
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(socket, () => {
				if (process.platform !== "win32") chmodSync(socket, 0o660);
				resolve();
			});
		});
		console.log("Rally runtime ready");
	}
} catch (error) {
	console.error("Rally runtime startup failed", error);
	process.exitCode = 1;
	await stop();
}
