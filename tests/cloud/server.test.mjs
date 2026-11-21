import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newKey } from "../../src/main/cloud/access.ts";

// Empty HOME and an allowlisted environment: no inherited provider credentials or paid requests.
test("two devices share the cloud runtime; secrets, conflicts, retries, restart and revocation", { timeout: 90000 }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "rally-test-")), key = newKey(), children = [];
	writeFileSync(join(dir, "admin.key"), key); writeFileSync(join(dir, "vault.key"), newKey());
	const socket = process.platform === "win32" ? "\\\\.\\pipe\\rally-test-" + randomUUID() : join(dir, "runtime.sock");
	async function start(file, marker) {
		const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, RALLY_SOCKET: socket, RALLY_CONTROL_DIR: dir, RALLY_CREDENTIALS_DIR: dir, RALLY_PORT: "0" };
		const child = spawn(process.env.RALLY_TEST_SERVER ? join(process.env.RALLY_TEST_SERVER, "bin/node") : process.execPath, [resolve(process.env.RALLY_TEST_SERVER ?? "out/server", "src/main/cloud", file)], { env, stdio: ["ignore", "pipe", "pipe"] });
		children.push(child);
		let logs = ""; child.stderr.on("data", b => { logs += b; });
		const match = await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(Error("Server startup timed out: " + logs)), 25000);
			child.once("exit", () => { clearTimeout(timer); reject(Error(logs)); });
			child.stdout.on("data", b => { logs += b; const result = logs.match(marker); if (result) { clearTimeout(timer); resolve(result); } });
		});
		return { child, match };
	}
	async function stop(child) {
		if (child.exitCode === null && child.signalCode === null) {
			const done = once(child, "exit"); child.kill(); await done;
		}
	}
	try {
		let runtime = await start("runtime.ts", /runtime ready/);
		const gateway = await start("server.ts", /port: (\d+)/);
		const base = "http://127.0.0.1:" + gateway.match[1];
		const post = async (route, token, body) => {
			const res = await fetch(base + "/v1/" + route, { method: "POST", headers: { Authorization: "Bearer " + token }, body: JSON.stringify(body) });
			return [res.status, await res.json()];
		};
		assert.equal((await fetch(base + "/assets/index.js")).status, 404);
		assert.match(await (await fetch(base)).text(), /部署控制台/);
		assert.equal((await post("rpc", key, {}))[0], 401);
		assert.equal((await post("rpc", "", {}))[0], 401);
		const pair = async name => {
			const [, issue] = await post("admin", key, { action: "issue", name });
			const [status, paired] = await post("pair", issue.key, { protocol: 1 });
			assert.equal(status, 200);
			assert.equal((await post("pair", issue.key, { protocol: 1 }))[0], 401);
			return paired;
		};
		const a = await pair("桌面"), b = await pair("手机");
		const packet = (device, channel, args = [], extra = {}) => ({ instance: device.instance, protocol: 1, channel, args, ...extra });
		const rpc = async (device, channel, ...args) => {
			const [status, result] = await post("rpc", device.token, packet(device, channel, args));
			assert.equal(status, 200, JSON.stringify(result)); return result;
		};
		assert.equal((await post("admin", b.token, { action: "status" }))[0], 401);
		assert.equal((await post("rpc", b.token, packet(b, "terminal:create", [])))[0], 400);
		assert.equal((await post("events", b.token, { instance: "wrong", protocol: 1 }))[0], 409);
		await rpc(a, "identity:update", { name: "测试工位" });
		assert.equal((await rpc(b, "identity:state")).name, "测试工位");
		const [, snapshot] = await post("events", b.token, packet(b, undefined));
		assert.ok(snapshot.events.some(event => event.data?.name === "测试工位"));
		const mcp = await rpc(a, "mcp:state");
		const stored = await rpc(a, "mcp:save-server", "offline", JSON.stringify({ command: "never-run", env: { TOKEN: "private-example" }, enabled: false }), null, mcp.revision);
		assert.ok(!JSON.stringify(stored).includes("private-example"));
		await rpc(b, "mcp:save", stored.json, stored.revision);
		assert.equal((await post("rpc", a.token, packet(a, "mcp:save", [mcp.json, mcp.revision])))[0], 409);
		const models = await rpc(a, "models:state");
		const provider = { id: "rp_test", name: "Offline", protocol: "messages", baseUrl: "http://127.0.0.1:1", apiKey: "private-provider-example", models: [] };
		const saved = await rpc(a, "models:save", [provider], models.revision);
		assert.ok(!JSON.stringify(saved).includes("private-provider-example"));
		assert.match(saved.providers[0].apiKey, /^已保存:/);
		assert.equal((await post("rpc", b.token, packet(b, "models:save", [[], models.revision])))[0], 409);
		await rpc(b, "models:save", saved.providers, saved.revision);
		assert.equal((await post("rpc", a.token, packet(a, "models:save", [[{ ...saved.providers[0], baseUrl: "http://127.0.0.1:2" }], saved.revision])))[0], 400);
		const [, delta] = await post("events", b.token, { instance: b.instance, protocol: 1, epoch: snapshot.epoch, seq: snapshot.seq });
		assert.ok(delta.events.some(e => e.channel === "cloud:configuration"));
		const requestId = randomUUID(), text = "offline-message-" + requestId;
		const send = () => post("rpc", a.token, packet(a, "chat:send", [text], { requestId }));
		const sent = await Promise.all([send(), send()]);
		assert.ok(sent.every(([status]) => status === 200));
		assert.equal((await rpc(b, "chat:state")).messages.filter(m => m.role === "user" && m.text === text).length, 1);
		await stop(runtime.child);
		runtime = await start("runtime.ts", /runtime ready/);
		assert.equal((await send())[0], 200);
		assert.equal((await rpc(b, "chat:state")).messages.filter(m => m.role === "user" && m.text === text).length, 1);
		assert.equal((await rpc(b, "identity:state")).name, "测试工位");
		const [, restored] = await post("events", b.token, { instance: b.instance, protocol: 1, epoch: snapshot.epoch, seq: snapshot.seq });
		assert.notEqual(restored.epoch, snapshot.epoch);
		assert.ok(restored.events.some(e => e.channel === "chat:event" && e.data.type === "snapshot"));
		assert.ok(Array.isArray((await rpc(b, "tasks:state")).tasks));
		const [, status] = await post("admin", key, { action: "status" });
		await post("admin", key, { action: "revoke", id: status.devices.find(d => d.name === "手机").id });
		assert.equal((await post("events", b.token, {}))[0], 401);
		assert.equal((await rpc(a, "identity:state")).name, "测试工位");
		await post("admin", key, { action: "pairing", enabled: false });
		const [, invite] = await post("admin", key, { action: "issue", name: "关闭配对测试" });
		assert.equal((await post("pair", invite.key, { protocol: 1 }))[0], 401);
	} finally {
		for (const child of children.reverse()) await stop(child);
		rmSync(dir, { recursive: true, force: true });
	}
});
