import { createServer, type Server, type IncomingHttpHeaders } from "node:http";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import type { ExtensionToolContext } from "../../src/index.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { NetworkRunner } from "../../../../src/main/supervisor/network-runner.ts";
import { createFetchPageTool, createHttpRequestTool } from "../../../../src/main/supervisor/network-tools.ts";
import { validateNetworkRequest, type NetworkRequest } from "../../../../src/main/supervisor/network-contract.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const harnesses: Harness[] = []; const runners: NetworkRunner[] = []; const servers: Server[] = []; const supervisors: Supervisor[] = [];
const context = {} as ExtensionToolContext; let sequence = 0;
afterEach(async () => {
	await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose()));
	await Promise.all(runners.splice(0).map(runner => runner.dispose()));
	await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); })));
	vi.restoreAllMocks(); vi.unstubAllEnvs();
	for (const harness of harnesses.splice(0)) harness.cleanup();
}, 30000);

async function setup() {
	vi.stubEnv("HTTP_PROXY", ""); vi.stubEnv("HTTPS_PROXY", ""); vi.stubEnv("ALL_PROXY", ""); vi.stubEnv("NODE_USE_ENV_PROXY", "");
	const harness = await createHarness(); harnesses.push(harness);
	const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
	const events = new EventLog(paths.eventsFile); const store = new TaskStore(events, paths.workspaceDir, () => {});
	const task = store.create({ title: "network fixture", quotes: [], cwd: harness.tempDir, mode: "readonly", scope: [], dependsOn: [], autoApprove: true }).task;
	const run = store.startRun(task.id, "dispatch", "faux"); const host = { task, run, store, isActive: () => !task.ended && !run.endedAt };
	const runner = new NetworkRunner(); runners.push(runner);
	const requests: { path: string; method: string; headers: IncomingHttpHeaders; body: string }[] = []; let hangClosed = false;
	const paragraph = "这是正文中的技术说明，包含参数、使用步骤和结果。".repeat(35);
	const server = createServer(async (request, response) => {
		const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
		requests.push({ path: request.url!, method: request.method!, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
		response.setHeader("Content-Type", "text/plain; charset=utf-8");
		switch (request.url) {
			case "/start": response.writeHead(302, { Location: "/page" }).end(); break;
			case "/loop": response.writeHead(302, { Location: "/loop" }).end(); break;
			case "/bad": response.writeHead(302, { Location: "file:///private" }).end(); break;
			case "/cross": response.writeHead(302, { Location: `${url.replace("127.0.0.1", "localhost")}/echo` }).end(); break;
			case "/mutate-redirect": response.writeHead(307, { Location: "/echo" }).end("not replayed"); break;
			case "/page": response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<html><head><title>离线文章</title><style>@import url('/css');</style></head><body><nav>NAV_NOISE</nav><article><h1>离线文章</h1><p>${paragraph}</p><h2>用法</h2><p>阅读 <a href="/guide">指南</a>，<a href="javascript:alert(1)">危险链接</a></p><ul><li>第一步</li><li>第二步</li></ul><pre><code>const answer = 42;</code></pre><table><tr><th>参数</th><th>值</th></tr><tr><td>数量</td><td>42</td></tr></table><p>${paragraph}</p><img src="/image" alt="示意图"></article><script>document.body.textContent='SCRIPT_RAN';fetch('/script-hit')</script><iframe src='/frame'></iframe><footer>FOOTER_NOISE</footer></body></html>`); break;
			case "/echo": response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(requests.at(-1))); break;
			case "/large": response.end("文字".repeat(15000)); break;
			case "/gzip": response.writeHead(200, { "Content-Encoding": "gzip" }).end(gzipSync("Z".repeat(5 * 1024 * 1024 + 1))); break;
			case "/gbk": response.writeHead(200, { "Content-Type": "text/html" }).end(Buffer.concat([Buffer.from('<meta charset="gbk"><article><p>'), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]), Buffer.from('</p></article>')])); break;
			case "/binary": response.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.0"); break;
			case "/missing": response.writeHead(404).end("not found"); break;
			case "/hang": response.writeHead(200); response.write("waiting"); response.on("close", () => { hangClosed = true; }); break;
			default: response.end("ok");
		}
	});
	servers.push(server); await new Promise<void>(resolve => server.listen(0, resolve));
	const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing port");
	const url = `http://127.0.0.1:${address.port}`;
	const fetchTool = createFetchPageTool(runner, host); const httpTool = createHttpRequestTool(runner, host);
	const page = (input: Parameters<typeof fetchTool.execute>[1], signal?: AbortSignal) => fetchTool.execute(`page-${++sequence}`, input, signal, undefined, context);
	const http = (input: Parameters<typeof httpTool.execute>[1], signal?: AbortSignal) => httpTool.execute(`http-${++sequence}`, input, signal, undefined, context);
	return { harness, paths, runner, host, server, requests, url, page, http, closed: () => hangClosed };
}

describe("Rally page and HTTP tools (offline local servers)", () => {
	it("extracts readable Markdown, resolves links, follows redirects, and never runs scripts/subresources", async () => {
		const { page, url, requests, host, paths } = await setup(); const value = (await page({ url: `${url}/start` })).details;
		expect(value).toMatchObject({ title: "离线文章", finalUrl: `${url}/page`, status: 200, truncated: false });
		expect(value.text).toContain("## 用法"); expect(value.text).toContain(`[指南](${url}/guide)`); expect(value.text).toContain("const answer = 42;"); expect(value.text).toContain("| 参数 | 值 |");
		expect(value.text).not.toMatch(/NAV_NOISE|FOOTER_NOISE|SCRIPT_RAN|javascript:|fetch\(/);
		expect(requests.map(request => request.path)).toEqual(["/start", "/page"]);
		expect(host.store.access(host.task.id).map(access => [access.method, access.requestIndex, access.target])).toEqual([["GET", 1, "127.0.0.1"], ["GET", 2, "127.0.0.1"]]);
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {}); expect(restored.access(host.task.id)).toEqual(host.store.access(host.task.id));
	});
	it("paginates text without losing content, decodes legacy HTML, and reports HTTP errors", async () => {
		const { page, http, url } = await setup();
		const first = (await page({ url: `${url}/large`, maxChars: 10001 })).details;
		const rest = (await page({ url: `${url}/large`, offset: first.nextOffset!, maxChars: 100000 })).details;
		expect(first.truncated).toBe(true); expect(first.text + rest.text).toBe("文字".repeat(15000)); expect(rest.nextOffset).toBeUndefined();
		expect((await page({ url: `${url}/gbk` })).details.text).toContain("中文");
		expect(await page({ url: `${url}/missing` })).toMatchObject({ isError: true, details: { status: 404, text: "not found" } });
		expect(await http({ method: "GET", url: `${url}/large` })).toMatchObject({ details: { truncated: true, body: "文字".repeat(10000) } });
	});
	it("sends literal bodies and explicit headers for every method, without a gate or automatic write replay", async () => {
		const { http, url, host, requests } = await setup(); const body = "中文\r\n`code` $() & <literal>\n";
		for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const) {
			const value = (await http({ method, url: `${url}/echo`, headers: { "X-Fixture": "literal" }, ...(["GET", "HEAD"].includes(method) ? {} : { body }) })).details;
			expect(value.status).toBe(200);
			if (method === "HEAD") expect(value.body).toBe("");
			else expect(JSON.parse(value.body)).toMatchObject({ method, headers: { "x-fixture": "literal" }, body: method === "GET" ? "" : body });
		}
		expect(await http({ method: "POST", url: `${url}/mutate-redirect`, body })).toMatchObject({ details: { status: 307, body: "not replayed" } });
		expect(requests).toHaveLength(7); expect(host.task.gates).toBeUndefined(); expect(host.task.lastExternalAction).toBeUndefined();
		expect(host.store.access(host.task.id).map(access => access.method)).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "POST"]);
	});
	it("drops all explicit credentials on cross-origin redirects and bounds redirect loops", async () => {
		const { http, page, url, requests } = await setup();
		const result = (await http({ method: "GET", url: `${url}/cross`, headers: { Authorization: "Bearer fake", Cookie: "session=fake", "X-Api-Key": "fake-key" } })).details;
		const echoed = JSON.parse(result.body); expect(echoed.headers.authorization).toBeUndefined(); expect(echoed.headers.cookie).toBeUndefined(); expect(echoed.headers["x-api-key"]).toBeUndefined();
		expect(requests[0].headers.authorization).toBe("Bearer fake");
		await expect(page({ url: `${url}/loop` })).rejects.toThrow("NETWORK_REDIRECT_LIMIT"); expect(requests.filter(request => request.path === "/loop")).toHaveLength(6);
		await expect(page({ url: `${url}/bad` })).rejects.toThrow("NETWORK_URL_INVALID");
	});
	it("rejects malformed requests and does not issue HTTP after persistence failure or an ended run", async () => {
		const { page, http, url, host, requests } = await setup();
		for (const request of [
			{ tool: "fetch_page", input: { url: "file:///private" } },
			{ tool: "fetch_page", input: { url: "https://user:secret@example.com" } },
			{ tool: "fetch_page", input: { url, offset: -1 } },
			{ tool: "http_request", input: { url, method: "GET", body: "no" } },
			{ tool: "http_request", input: { url, method: "POST", headers: { Host: "other" } } },
			{ tool: "http_request", input: { url, method: "POST", headers: { "X-Test": "bad\r\nvalue" } } },
		] as NetworkRequest[]) expect(() => validateNetworkRequest(request)).toThrow();
		vi.spyOn(host.store, "recordAccess").mockImplementationOnce(() => { throw new Error("fixture disk failure"); });
		await expect(http({ method: "POST", url: `${url}/echo`, body: "not sent" })).rejects.toThrow("fixture disk failure");
		host.run.endedAt = Date.now(); await expect(page({ url })).rejects.toThrow("TASK_ENDED"); expect(requests).toEqual([]);
	});
	it("bounds decompressed pages and rejects unsupported binary content", async () => {
		const { page, url } = await setup();
		await expect(page({ url: `${url}/gzip` })).rejects.toThrow("PAGE_TOO_LARGE");
		await expect(page({ url: `${url}/binary` })).rejects.toThrow("NETWORK_CONTENT_TYPE");
	});
	it.each(["cancel", "timeout", "dispose"] as const)("closes a hanging socket on %s and never retries it", async mode => {
		const { http, url, runner, requests, closed } = await setup(); const controller = new AbortController();
		const pending = http({ method: "POST", url: `${url}/hang`, body: "once", timeoutMs: mode === "timeout" ? 6000 : 30000 }, controller.signal);
		const outcome = pending.then(() => undefined, (error: unknown) => error);
		try {
			await vi.waitFor(() => expect(requests).toHaveLength(1), { timeout: 5000 });
			if (mode === "cancel") controller.abort(); else if (mode === "dispose") await runner.dispose();
			expect(await outcome).toMatchObject({ message: expect.stringContaining(mode === "timeout" ? "NETWORK_TIMEOUT" : "NETWORK_ABORTED") });
		} finally { controller.abort(); await outcome; }
		await vi.waitFor(() => expect(closed()).toBe(true)); expect(requests).toHaveLength(1);
		await runner.dispose(); await expect(http({ method: "GET", url })).rejects.toThrow("NETWORK_CLOSED");
	});
	it("wires production main/worker tool boundaries, actual results and recovered access methods", async () => {
		const fixture = await setup(); const { url, harness: original } = fixture;
		const harness = await createHarness({ provider: "rally-network", models: [{ id: "main" }, { id: "worker" }] }); harnesses.push(harness);
		const paths = resolveRallyPaths(join(original.tempDir, "production")); ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(supervisor);
		await supervisor.models.save([{ id: "rally-network", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady(); runtime!.registerProvider("rally-network", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-network", model: "main", thinkingLevel: "off" }); await supervisor.models.selectWorker({ provider: "rally-network", model: "worker", thinkingLevel: "off" });
		await supervisor.start(); let mainCalls = 0; let workerCalls = 0;
		const route: FauxResponseStep = (ctx, _options, _state, model) => {
			const tools = getCurrentTools(ctx.messages).map(tool => tool.name); expect(tools).toContain("fetch_page");
			if (model.id === "main") {
				expect(tools).not.toContain("http_request");
				if (mainCalls++ === 0) return fauxAssistantMessage(fauxToolCall("fetch_page", { url: `${url}/page` }), { stopReason: "toolUse" });
				return fauxAssistantMessage("已读取");
			}
			expect(tools).toContain("http_request");
			if (workerCalls++ === 0) return fauxAssistantMessage(fauxToolCall("http_request", { method: "POST", url: `${url}/echo`, body: "离线测试" }), { stopReason: "toolUse" });
			if (workerCalls === 2) { expect(getMessageText(ctx.messages.findLast(message => message.role === "toolResult"))).toContain("离线测试"); return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "HTTP 本地验证结束" }), { stopReason: "toolUse" }); }
			return fauxAssistantMessage("完成");
		};
		harness.setResponses(Array(12).fill(route)); await supervisor.main.send("读取测试文章并让任务向本地 echo POST 离线测试");
		await vi.waitFor(() => { expect(mainCalls).toBeGreaterThan(1); expect(supervisor.main.isBusy()).toBe(false); }, { timeout: 10000 });
		const task = supervisor.store.create({ title: "HTTP fixture", quotes: [], cwd: original.tempDir, mode: "readonly", scope: [], dependsOn: [], autoApprove: false }).task;
		supervisor.approve(task.id); await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"), { timeout: 10000 });
		expect(supervisor.store.access(task.id)).toEqual([expect.objectContaining({ tool: "http_request", kind: "net", method: "POST", target: "127.0.0.1", requestIndex: 1 })]);
		expect(supervisor.store.timeline(task.id)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "http_request", status: "ok" })]));
		await supervisor.dispose(); const restored = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(restored);
		expect(restored.store.access(task.id)).toEqual(supervisor.store.access(task.id));
	});
});
