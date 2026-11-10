import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { managedMcpConfigValue, managedMcpTransport } from "../../../../src/main/supervisor/mcp-transport.ts";
import { ProcessRegistry, type OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { McpStore } from "../../../../src/main/mcp-store.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { InMemoryAuthStorageBackend } from "../../src/core/auth-storage.ts";
import { emitSessionShutdownEvent } from "../../src/core/extensions/runner.ts";
import { createMcpExtension } from "../../src/extensions/mcp/index.ts";
import { McpOAuthCredentialStore, signInMcpServer } from "../../src/extensions/mcp/oauth.ts";
import { McpServerConnection } from "../../src/extensions/mcp/runtime.ts";
import { createHarness, createTestUiContext, getMessageText } from "./harness.ts";
import { startOAuthMcpServer } from "./mcp-oauth-server.ts";

const quote = (path: string) => `'${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
describe("Rally managed MCP OAuth configuration (local HTTP and faux provider)", () => {
	const cleanups: (() => void | Promise<void>)[] = [];
	afterEach(async () => {
		while (cleanups.length) await cleanups.pop()?.();
		vi.restoreAllMocks(); vi.unstubAllEnvs();
	}, 30000);
	async function setup() {
		vi.stubEnv("PI_OFFLINE", "1");
		const harness = await createHarness(); cleanups.push(() => harness.cleanup()); const cwd = harness.tempDir;
		let secret = "local-private-secret";
		const server = await startOAuthMcpServer({ clientSecret: () => secret }); cleanups.push(server.close);
		const lock = new StateDirectoryLock(join(cwd, "state")); cleanups.push(() => lock.release());
		const stopped: OwnedProcess[] = []; const registry = new ProcessRegistry(join(cwd, "state"), { assertWritable: () => lock.assertHeld(), graceMs: 50, onStopped: entry => { stopped.push(entry); } }); cleanups.push(() => registry.dispose());
		const backend = new InMemoryAuthStorageBackend(); const credentials = new McpOAuthCredentialStore(backend);
		const secretFile = join(cwd, "secret.txt"); writeFileSync(secretFile, secret);
		const config = { url: server.url, oauth: { clientId: "configured-client", clientSecret: `!cat ${quote(secretFile)}` } };
		const entry = { name: "issues", source: "test", config };
		const resolver = managedMcpConfigValue(registry, "T-oauth");
		const connection = new McpServerConnection({ entry, cwd, credentials, createTransport: managedMcpTransport(registry, "T-oauth"), resolveConfigValue: resolver, onTools: () => {} }); cleanups.push(() => connection.close());
		const seed = async () => {
			const token = server.issueAccessToken();
			await credentials.forServer("issues", server.url).save({ serverUrl: server.url, tokens: { access_token: token, refresh_token: "refresh-1", token_type: "Bearer" }, tokensExpireAt: Date.now() - 1000 });
		};
		const marker = join(cwd, "pids.json");
		const hang = `!${quote(process.execPath)} ${quote(fileURLToPath(new URL("../fixtures/rally-search-process.cjs", import.meta.url)))} ${quote(marker)} hang`;
		return { cwd, server, registry, stopped, backend, credentials, config, entry, connection, resolver, marker, hang, seed,
			rotateSecret: () => { secret = "rotated-private-secret"; writeFileSync(secretFile, secret); return secret; } };
	}
	it("resolves secrets lazily for sign-in and again for refresh, without persisting command output", async () => {
		const { connection, server, credentials, registry, stopped, backend, rotateSecret } = await setup();
		await expect(connection.getClient()).rejects.toThrow("requires sign-in"); expect(stopped).toEqual([]);
		await signInMcpServer({ serverUrl: server.url, store: credentials.forServer("issues", server.url), settings: await connection.oauthSettings(), prompt: {
			showAuthorizationUrl: url => { void fetch(url); }, promptForRedirectUrl: signal => new Promise(resolve => signal.addEventListener("abort", () => resolve(undefined), { once: true })),
		} });
		await connection.reconnect(); expect(server.tokenRequests[0].get("client_secret")).toBe("local-private-secret");
		const updated = rotateSecret(); server.expireAccessTokens();
		expect(await connection.callTool("whoami", {}, {})).toMatchObject({ content: [{ text: "token access-2" }] });
		expect(server.tokenRequests.at(-1)?.get("client_secret")).toBe(updated); expect(stopped).toHaveLength(2);
		expect(stopped.every(entry => entry.kind === "mcp" && entry.taskId === "T-oauth")).toBe(true);
		for (const text of [readFileSync(registry.file, "utf8"), backend.withLock(current => ({ result: current ?? "" }))]) { expect(text).not.toContain("private-secret"); }
	}, 20000);
	it.each(["settings", "refresh"] as const)("closes a hung secret command during %s and waits for its child tree", async mode => {
		const { connection, config, hang, marker, seed, registry, server } = await setup(); config.oauth.clientSecret = hang;
		if (mode === "refresh") await seed();
		const pending = mode === "refresh" ? connection.getClient() : connection.oauthSettings(); const rejection = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 6000 }); const pids = JSON.parse(readFileSync(marker, "utf8"));
		await connection.close(); await rejection;
		expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false); expect(server.tokenRequests).toEqual([]);
		expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
		await expect(connection.oauthSettings()).rejects.toThrow();
	}, 15000);
	it("bounds a non-returning credential command to ten seconds and clears its whole tree", async () => {
		const { connection, config, hang, marker, registry } = await setup(); config.oauth.clientSecret = hang;
		const started = performance.now(); await expect(connection.oauthSettings()).rejects.toThrow("PROCESS_ABORTED");
		const elapsed = performance.now() - started; expect(elapsed).toBeGreaterThanOrEqual(9500); expect(elapsed).toBeLessThan(18000);
		const pids = JSON.parse(readFileSync(marker, "utf8")); expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false);
		expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 20000);
	it("tracks login configuration resolution through extension shutdown before opening a callback or browser", async () => {
		const { config, entry, hang, marker, registry, resolver, credentials } = await setup(); config.oauth.clientSecret = hang; const opened = vi.fn();
		const harness = await createHarness({ extensionFactories: [createMcpExtension({ loadConfig: () => ({ servers: [entry], errors: [] }), credentials,
			createTransport: managedMcpTransport(registry, "T-login"), resolveConfigValue: resolver, openUrl: opened })] }); cleanups.push(() => harness.cleanup());
		const shutdown = async () => { await emitSessionShutdownEvent(harness.session.extensionRunner, { type: "session_shutdown", reason: "quit" }); }; cleanups.push(shutdown);
		await harness.session.bindExtensions({ uiContext: createTestUiContext() });
		const login = harness.session.prompt("/mcp login issues");
		await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 6000 }); const pids = JSON.parse(readFileSync(marker, "utf8"));
		await shutdown(); await login; expect(opened).not.toHaveBeenCalled(); expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false);
	}, 15000);
	it("rejects excessive secret output and waits for cleanup without retaining further chunks", async () => {
		const { connection, config, cwd, registry } = await setup(); const file = join(cwd, "large-secret.cjs");
		writeFileSync(file, "process.stdout.write('中'.repeat(400000)); setInterval(() => process.stdout.write('ignored'.repeat(10000)), 10);");
		config.oauth.clientSecret = `!${quote(process.execPath)} ${quote(file)}`;
		await expect(connection.oauthSettings()).rejects.toThrow("MCP_CONFIG_OUTPUT_LIMIT");
		expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it("waits for an already sent refresh to save rotated tokens during close", async () => {
		const { connection, server, credentials, seed } = await setup(); await seed(); server.stall.add("/token");
		const opening = expect(connection.getClient()).rejects.toThrow();
		await vi.waitFor(() => expect(server.stalled).toHaveLength(1), { timeout: 6000 });
		let closed = false; const closing = connection.close().then(() => { closed = true; });
		await new Promise(resolve => setTimeout(resolve, 30)); expect(closed).toBe(false);
		const access = server.issueAccessToken();
		server.stalled[0].response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ access_token: access, refresh_token: "refresh-2", token_type: "Bearer", expires_in: 3600 }));
		await closing; await opening;
		expect((await credentials.forServer("issues", server.url).load())?.tokens).toMatchObject({ access_token: "access-2", refresh_token: "refresh-2" });
	}, 15000);
	it("cancels one settings request without closing the connection and resolves a later request freshly", async () => {
		const { connection, config, hang, marker } = await setup(); const original = config.oauth.clientSecret; config.oauth.clientSecret = hang;
		const controller = new AbortController(); const rejected = expect(connection.oauthSettings(controller.signal)).rejects.toThrow();
		await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 6000 }); const pids = JSON.parse(readFileSync(marker, "utf8")); controller.abort(); await rejected;
		expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false); config.oauth.clientSecret = original;
		expect((await connection.oauthSettings()).clientSecret).toBe("local-private-secret");
	}, 15000);
	it.each(["complete", "cancel"] as const)("uses the managed resolver in a production worker refresh during %s", async action => {
		const { cwd, server, config, hang, marker } = await setup(); if (action === "cancel") config.oauth.clientSecret = hang;
		const harness = await createHarness({ provider: "rally-oauth", models: [{ id: "main" }, { id: "worker" }] }); cleanups.push(() => harness.cleanup());
		const paths = resolveRallyPaths(join(cwd, "home")); ensureRallyDirs(paths); vi.stubEnv("RALLY_CODING_AGENT_DIR", paths.agentDir);
		new McpStore(paths.agentDir).save(JSON.stringify({ mcpServers: { issues: config } }));
		const token = server.issueAccessToken(); const credentials = new McpOAuthCredentialStore();
		await credentials.forServer("issues", server.url).save({ serverUrl: server.url, tokens: { access_token: token, refresh_token: "refresh-1", token_type: "Bearer" }, tokensExpireAt: Date.now() - 1000 });
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); cleanups.push(() => supervisor.dispose());
		await supervisor.models.save([{ id: "rally-oauth", name: "Local", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady(); if (!runtime) throw new Error("missing runtime");
		runtime.registerProvider("rally-oauth", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-oauth", model: "main", thinkingLevel: "off" }); await supervisor.models.selectWorker({ provider: "rally-oauth", model: "worker", thinkingLevel: "off" }); await supervisor.start();
		const task = supervisor.store.create({ title: "OAuth fixture", cwd: paths.workspaceDir, mode: "write", scope: [], dependsOn: [], autoApprove: false, quotes: [{ messageId: "#fixture", kind: "user", text: "read whoami", at: Date.now() }] }).task;
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main") return fauxAssistantMessage("已收到。");
			const last = context.messages.findLast(message => message.role === "toolResult");
			if (last?.role === "toolResult" && last.toolName === "task_report") return fauxAssistantMessage("完成。");
			if (last?.role === "toolResult") { expect(getMessageText(last)).toContain("token access-2"); return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "读取成功" }), { stopReason: "toolUse" }); }
			return fauxAssistantMessage(fauxToolCall("mcp__issues__whoami", { arguments: {} }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id);
		if (action === "cancel") {
			await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 6000 }); const pids = JSON.parse(readFileSync(marker, "utf8"));
			supervisor.cancel(task.id); await supervisor.workers.abort(task.id);
			expect(task.ended?.outcome).toBe("cancelled"); expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false); expect(server.tokenRequests).toEqual([]);
			expect(supervisor.events.ofKind("process_stopped")).toMatchObject([{ data: { kind: "mcp", taskId: task.id } }]);
			return;
		}
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs[0]?.lastReport?.summary).toBe("done"), { timeout: 10000 }); await supervisor.workers.abort(task.id);
		expect(supervisor.events.ofKind("process_stopped")).toMatchObject([{ data: { kind: "mcp", taskId: task.id } }]);
		expect(server.tokenRequests).toHaveLength(1); expect(server.tokenRequests[0].get("client_secret")).toBe("local-private-secret");
		expect(readFileSync(paths.eventsFile, "utf8")).not.toContain("local-private-secret");
	}, 20000);
});
