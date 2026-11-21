import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AccessStore } from "./access.ts";
import { failure, PublicError, readBody, reply } from "./http.ts";
import { ResourceGateway } from "./resource-gateway.ts";
import { IpcChannel } from "../../shared/ipc.ts";

process.umask(0o077);
const secrets = process.env.RALLY_CREDENTIALS_DIR || "/etc/rally";
const admin = readFileSync(join(secrets, "admin.key"), "utf8").trim();
const access = new AccessStore(
	join(process.env.RALLY_CONTROL_DIR || "/var/lib/rally-control", "devices.sqlite"),
	admin,
);
const socket = process.env.RALLY_SOCKET || "/run/rally-runtime/service.sock";
const resources = new ResourceGateway(socket, access);
const assets = new Map(
	[
		["/", "index.html"],
		["/console.js", "console.js"],
		["/console.css", "console.css"],
		["/mark.png", "mark.png"],
	].map(([url, file]) => [url, readFileSync(new URL(`./console/${file}`, import.meta.url))]),
);
const failures = new Map<string, { count: number; since: number }>();
let stopping = false;

const server = createServer(async (req, res) => {
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("X-Content-Type-Options", "nosniff");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.setHeader(
		"Content-Security-Policy",
		"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
	);
	try {
		if (stopping) throw new PublicError("服务正在停止", 503);
		if (resources.handles(req.url ?? "")) { resources.handle(req, res); return; }
		const path = req.url ?? "",
			asset = assets.get(path);
		if (req.method === "GET" && asset) {
			res.writeHead(200, {
				"Content-Type":
					path === "/"
						? "text/html; charset=utf-8"
						: path === "/mark.png"
							? "image/png"
							: path.endsWith(".js")
								? "text/javascript; charset=utf-8"
								: "text/css; charset=utf-8",
			});
			res.end(asset);
			return;
		}
		if (req.method === "GET" && path === "/health") {
			reply(res, 200, { protocol: 1 });
			return;
		}
		if (req.method !== "POST" || !["/v1/admin", "/v1/pair", "/v1/rpc", "/v1/events"].includes(path))
			throw new PublicError("接口不存在", 404);
		const address = req.socket.remoteAddress ?? "unknown";
		const recent = failures.get(address);
		if (recent && Date.now() - recent.since < 60000 && recent.count >= 30)
			throw new PublicError("认证尝试过多，请一分钟后重试", 429);
		const auth = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1] ?? "";
		const denied = () => {
			for (const [ip, attempt] of failures) if (Date.now() - attempt.since > 60000) failures.delete(ip);
			if (failures.size > 4096) failures.delete(failures.keys().next().value!);
			const previous = failures.get(address);
			failures.set(address, { count: (previous?.count ?? 0) + 1, since: previous?.since ?? Date.now() });
			throw new PublicError("凭据无效、已使用或已吊销", 401);
		};
		if (!auth || (path === "/v1/admin" ? !access.isAdmin(auth) : path !== "/v1/pair" && !access.authenticate(auth)))
			denied();
		const body = await readBody(req);
		if (path === "/v1/pair") {
			if (body.protocol !== 1) throw new PublicError("客户端协议不兼容", 409);
			const result = access.pair(auth);
			if (!result) denied();
			reply(res, 200, result);
			return;
		}
		if (path === "/v1/admin") {
			switch (body.action) {
				case "status":
					break;
				case "issue":
					if (typeof body.name !== "string") throw new PublicError("请填写设备名称");
					reply(res, 200, { key: access.issue(body.name) });
					return;
				case "revoke":
					if (typeof body.id !== "string") throw new PublicError("无效设备");
					access.revoke(body.id);
					resources.revoke(body.id);
					break;
				case "pairing":
					if (typeof body.enabled !== "boolean") throw new PublicError("无效配对设置");
					access.setPairing(body.enabled);
					break;
				default:
					throw new PublicError("操作无效");
			}
			reply(res, 200, access.status());
			return;
		}
		// Recheck after receiving the body: a device may have been revoked during upload.
		const device = access.authenticate(auth);
		if (!device) return denied();
		if (body.instance !== access.instance || body.protocol !== 1)
			throw new PublicError("服务器实例或协议已变更，请重新连接", 409);
		const upstream = request(
			{ socketPath: socket, path, method: "POST", headers: { "Content-Type": "application/json" }, timeout: 65000 },
			async (result) => {
				if (!access.authenticate(auth)) {
					result.destroy();
					reply(res, 401, { error: "设备已被吊销" });
					return;
				}
				if (body.channel === IpcChannel.resourcePreview && result.statusCode === 200) {
					try {
						const data = await readBody(result);
						if (typeof data.id !== "string") throw new PublicError("资源响应无效");
						reply(res, 200, resources.ticket(device, data.id));
					} catch (error) { failure(res, error); }
					return;
				}
				res.writeHead(result.statusCode ?? 502, { "Content-Type": "application/json" });
				result.pipe(res);
			},
		);
		upstream.on("timeout", () => upstream.destroy());
		upstream.on("error", () => failure(res, new PublicError("运行时暂不可用，请检查状态后重试", 503)));
		res.on("close", () => upstream.destroy());
		upstream.end(JSON.stringify({ ...body, device }));
	} catch (error) {
		failure(res, error);
	}
});
server.requestTimeout = 300000;
server.headersTimeout = 10000;
const port = Number(process.env.RALLY_PORT ?? 4711);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("RALLY_PORT 无效");
server.listen(port, process.env.RALLY_HOST || "127.0.0.1", () =>
	console.log("Rally server listening", server.address()),
);
function stop() {
	if (stopping) return;
	stopping = true;
	resources.close();
	server.close(() => access.db.close());
	server.closeAllConnections();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
