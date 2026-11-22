import { createHash, randomBytes } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type FauxResponseStep } from "@rally/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { businessHandlers } from "../../../../src/main/business.ts";
import { cloudCommands } from "../../../../src/main/cloud/commands.ts";
import { cloudVault } from "../../../../src/main/cloud/vault.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { saveResource } from "../../../../src/main/resource-download.ts";
import { ResourcePreviewHost } from "../../../../src/main/resource-preview.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { generateImages, ImageParametersRejected, searchWeb, type ImageRequest } from "../../../../src/main/tool-provider-http.ts";
import { ToolProviderStore } from "../../../../src/main/tool-provider-store.ts";
import { IpcChannel as C } from "../../../../src/shared/ipc.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import type { SearchProviderId, ToolProviderState, ToolProviderUpdate } from "../../../../src/shared/tool-providers.ts";
import { createHarness, getMessageText } from "./harness.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=", "base64");
const imageKey = "offline-image-credential";
const searchKey = "offline-search-credential";
const nativeFetch = fetch;
const owners: (() => void | Promise<void>)[] = [];

afterEach(async () => {
	vi.unstubAllGlobals();
	while (owners.length) await owners.pop()?.();
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "rally-tool-providers-"));
	owners.push(() => rmSync(directory, { recursive: true, force: true }));
	const vault = cloudVault(randomBytes(32));
	return { directory, vault, file: join(directory, "tools.json") };
}

function retained(state: ToolProviderState): ToolProviderUpdate {
	return { ...state, search: state.search.map(id => ({ id })) };
}

function configure(state: ToolProviderState): ToolProviderUpdate {
	return {
		revision: state.revision,
		images: [
			{ id: "a", name: "Image A", baseUrl: "https://images.example.invalid/v1/", models: ["draft", "retouch"], apiKey: imageKey },
			{ id: "b", name: "Image B", baseUrl: "https://other.example.invalid/img/v1", models: ["draft"], apiKey: "offline-second-image-credential" },
		],
		preferredImage: { providerId: "a", model: "draft" },
		search: [{ id: "tavily", apiKey: searchKey }, { id: "exa", apiKey: "offline-exa-credential" }, { id: "brave", apiKey: "offline-brave-credential" }],
		preferredSearch: "tavily",
	};
}

const resultUrl = "https://example.org/article";
const searchCases = [
	{ id: "tavily", url: "https://api.tavily.com/search", method: "POST", header: "Authorization", auth: `Bearer ${searchKey}`,
		body: { query: "public subject", max_results: 3, search_depth: "basic", include_answer: false, include_raw_content: false },
		wrap: (items: unknown[]) => ({ results: items }), snippet: { content: "摘要" }, date: { published_date: "2025-01-01" } },
	{ id: "exa", url: "https://api.exa.ai/search", method: "POST", header: "x-api-key", auth: searchKey,
		body: { query: "public subject", numResults: 3, type: "auto", contents: { highlights: true } },
		wrap: (items: unknown[]) => ({ results: items }), snippet: { highlights: ["摘要"] }, date: { publishedDate: "2025-01-01" } },
	{ id: "brave", url: "https://api.search.brave.com/res/v1/web/search?q=public+subject&count=3&result_filter=web&text_decorations=false",
		method: "GET", header: "X-Subscription-Token", auth: searchKey, body: undefined,
		wrap: (items: unknown[]) => ({ web: { results: items } }), snippet: { description: "摘要" }, date: { page_age: "2025-01-01" } },
] satisfies { id: SearchProviderId; url: string; method: string; header: string; auth: string; body?: unknown;
	wrap(items: unknown[]): unknown; snippet: object; date: object }[];

describe("tool provider credentials and HTTP", () => {
	it("encrypts keys, keeps omitted secrets, rejects stale edits and requires a key for a changed image endpoint", () => {
		const { file, vault } = fixture();
		const store = new ToolProviderStore(file, vault);
		const start = store.state();
		expect(() => store.image()).toThrow("尚未配置首选生图模型");
		const saved = store.save(configure(start));
		expect(saved).toMatchObject({ images: [{ baseUrl: "https://images.example.invalid/v1", models: ["draft", "retouch"] }, { models: ["draft"] }],
			search: ["tavily", "exa", "brave"], preferredImage: { providerId: "a", model: "draft" }, preferredSearch: "tavily" });
		expect(JSON.stringify(saved)).not.toMatch(/apiKey|secret|offline-/);
		const disk = readFileSync(file, "utf8");
		expect(disk).not.toContain(imageKey);
		expect(disk).not.toContain(searchKey);
		expect(disk).not.toContain(Buffer.from(imageKey).toString("base64"));
		expect(() => store.save(configure(start))).toThrow("请刷新后再保存");
		const retainedUpdate = retained(saved);
		const changed = retainedUpdate.images.map(image => image.id === "a" ? { ...image, baseUrl: "https://new.example.invalid/v1" } : image);
		expect(() => store.save({ ...retainedUpdate, images: changed })).toThrow("更换 API 地址时需填写密钥");
		expect(store.state()).toEqual(saved);
		expect(readFileSync(file, "utf8")).toBe(disk);
		const selected = store.save({ ...retainedUpdate, images: retainedUpdate.images.map(image => image.id === "b" ? { ...image, responseFormat: "b64_json" } : image),
			preferredImage: { providerId: "b", model: "draft" }, preferredSearch: "brave" });
		const restarted = new ToolProviderStore(file, vault);
		expect(restarted.state()).toEqual({ ...selected, revision: restarted.state().revision });
		expect(() => restarted.save(retained(selected))).toThrow("请刷新后再保存");
		expect(restarted.image()).toEqual({ baseUrl: "https://other.example.invalid/img/v1", model: "draft", apiKey: "offline-second-image-credential", responseFormat: "b64_json" });
		expect(restarted.search()).toEqual({ id: "brave", apiKey: "offline-brave-credential" });
		const cleared = restarted.save({ revision: restarted.state().revision, images: [], search: [], preferredImage: null, preferredSearch: null });
		expect(cleared).toMatchObject({ images: [], search: [], preferredImage: null, preferredSearch: null });
	});

	it.each(searchCases)("calls $id with its own authentication and normalizes only usable results", async item => {
		const response = item.wrap([
			{ title: `结果 ${searchKey}`, url: resultUrl, ...item.snippet, ...item.date },
			{ title: "重复项", url: resultUrl },
			{ title: "非网页", url: "file:///tmp/local" },
		]);
		const send = vi.fn<typeof fetch>(async (input, init) => {
			expect(String(input)).toBe(item.url);
			expect(init).toMatchObject({ method: item.method, redirect: "manual", credentials: "omit" });
			expect(new Headers(init?.headers).get(item.header)).toBe(item.auth);
			expect(init?.body ? JSON.parse(String(init.body)) : undefined).toEqual(item.body);
			return Response.json(response);
		});
		expect(await searchWeb(item.id, searchKey, "public subject", 3, undefined, undefined, send)).toEqual([
			{ title: "结果 [已隐藏]", url: resultUrl, snippet: "摘要", publishedAt: "2025-01-01" },
		]);
		expect(send).toHaveBeenCalledOnce();
	});

	it("serializes only fields supplied, including a prompt-only payload for provider defaults", async () => {
		const outgoing: unknown[] = [];
		const send = vi.fn<typeof fetch>(async (_input, init) => {
			outgoing.push(JSON.parse(String(init?.body)));
			return Response.json({ data: [{ b64_json: png.toString("base64") }] });
		});
		const minimal = { prompt: "test image" };
		const explicit = { ...minimal, model: "draft", size: "1:1", style: "natural", quality: "hd",
			background: "transparent", response_format: "b64_json", output_format: "webp", output_compression: 0, n: 1 };
		const generate = (input: ImageRequest) => generateImages("https://images.example.invalid/v1", imageKey, input, undefined, undefined, send);
		expect(await generate(minimal)).toHaveLength(1);
		expect(await generate(explicit)).toHaveLength(1);
		expect(outgoing).toEqual([minimal, explicit]);
	});

	it("accepts embedded data URLs and binary results, without fetching an image URL when base64 is supplied", async () => {
		const base64 = png.toString("base64");
		const cases = [
			Response.json({ data: [{ b64_json: base64, url: "https://127.0.0.1/ignored.png" }] }),
			Response.json({ data: [{ b64_json: "", url: `data:image/png;base64,${base64}` }] }),
			new Response(Uint8Array.from(png), { headers: { "content-type": "image/png" } }),
		];
		for (const response of cases) {
			const observe = vi.fn();
			const images = await generateImages("https://images.example.invalid/v1", imageKey,
				{ prompt: "test image" }, undefined, observe, async () => response);
			expect(images).toEqual([{ bytes: png, extension: "png" }]);
			expect(observe.mock.calls).toEqual([["images.example.invalid", "POST"]]);
		}
	});

	it("distinguishes a successful request with an inaccessible result from a parameter rejection", async () => {
		const observe = vi.fn();
		const send = vi.fn<typeof fetch>(async () => Response.json({ data: [{ url: "https://127.0.0.1/fixture.png" }] }));
		const failure = await generateImages("https://images.example.invalid/v1", imageKey,
			{ prompt: "test image" }, undefined, observe, send).catch((reason: unknown) => reason);
		expect(failure).not.toBeInstanceOf(ImageParametersRejected);
		expect(failure).toMatchObject({ message: expect.stringMatching(/HTTP 200.*非公开网络.*Base64/) });
		expect(send).toHaveBeenCalledOnce();
		expect(observe.mock.calls).toEqual([["images.example.invalid", "POST"]]);
	});

	it("distinguishes structured parameter errors from a policy rejection or an ambiguous HTTP failure", async () => {
		const generate = (status: number, body: object) => generateImages("https://images.example.invalid/v1", imageKey,
			{ prompt: "test image" }, undefined, undefined, async () => Response.json(body, { status }));
		await expect(generate(422, { error: { code: "invalid_parameter", param: "size", message: imageKey } })).rejects.toThrow(ImageParametersRejected);
		for (const [status, body] of [[400, { error: { type: "invalid_request_error", code: "content_policy_violation", param: "prompt" } }],
			[400, { error: "Bad request" }], [500, { error: { code: "invalid_parameter", param: "size" } }]] as const) {
			const error = await generate(status, body).catch((reason: unknown) => reason);
			expect(error).toBeInstanceOf(Error);
			expect(error).not.toBeInstanceOf(ImageParametersRejected);
		}
	});

	it("reports gateway trace IDs without exposing credentials or retrying generation", async () => {
		const send = vi.fn<typeof fetch>(async () => new Response(imageKey, {
			status: 502, headers: { "cf-ray": "abcdef0123456789-NRT", "x-request-id": imageKey },
		}));
		const error = await generateImages("https://images.example.invalid/v1", imageKey,
			{ prompt: "test image", model: "draft" }, undefined, undefined, send).catch((reason: unknown) => reason);
		expect(error).not.toBeInstanceOf(ImageParametersRejected);
		expect(error).toMatchObject({ message: expect.stringContaining("HTTP 502（cf-ray: abcdef0123456789-NRT）") });
		expect(send).toHaveBeenCalledOnce();
	});

	it("sanitizes provider errors and does not follow a redirect or retry a paid request", async () => {
		const send = vi.fn<typeof fetch>(async () => new Response(`private upstream error: ${imageKey}`, { status: 307, headers: { Location: "https://elsewhere.invalid/" } }));
		const prompt = { model: "draft", prompt: "test image" };
		await expect(generateImages("https://images.example.invalid/v1", imageKey, prompt, undefined, undefined, send)).rejects.toThrow("HTTP 307");
		expect(send).toHaveBeenCalledOnce();
		const errorBody = vi.fn<typeof fetch>(async () => new Response(`private upstream error: ${searchKey}`, { status: 401 }));
		const failure = await searchWeb("tavily", searchKey, "public subject", 3, undefined, undefined, errorBody).catch((error: Error) => error.message);
		expect(failure).toMatch(/HTTP 401/);
		expect(failure).not.toContain(searchKey);
	});
});

describe("tool provider production wiring", () => {
	it("restricts main image requests and attaches worker outputs to reports and the resource transport", async () => {
		const { directory, vault } = fixture();
		const harness = await createHarness({ provider: "rally-tool-providers", models: [{ id: "main" }, { id: "worker" }] });
		owners.push(() => harness.cleanup());
		const paths = resolveRallyPaths(join(directory, "production"));
		ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, credentialVault: vault });
		owners.push(() => supervisor.dispose());
		const preview = new ResourcePreviewHost(supervisor.resources);
		owners.push(() => preview.close());
		const cloud = cloudCommands(businessHandlers(paths, supervisor, () => {}));
		const before = cloud[C.toolProvidersState]();
		const saved = cloud[C.toolProvidersSave](configure(before));
		expect(JSON.stringify([saved, cloud[C.toolProvidersState]()])).not.toMatch(/apiKey|secret|offline-/);
		expect(() => cloud[C.toolProvidersSave](configure(before))).toThrow(expect.objectContaining({ status: 409 }));

		const imageCalls: ImageRequest[] = [], searchCalls: string[] = [];
		const mockFetch: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url === "https://images.example.invalid/v1/images/generations") {
				expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${imageKey}`);
				const body: ImageRequest = JSON.parse(String(init?.body)); imageCalls.push(body);
				if (body.size === "1:1") return Response.json({ error: { code: "unknown_parameter", param: "size" } }, { status: 400 });
				return Response.json({ data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: png.toString("base64") })) });
			}
			if (url === "https://api.tavily.com/search") {
				expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${searchKey}`);
				searchCalls.push(JSON.parse(String(init?.body)).query);
				return Response.json({ results: [{ title: "Fixture", content: "离线搜索摘要", url: resultUrl }] });
			}
			throw Error("Unexpected outbound request in offline provider test");
		};
		vi.stubGlobal("fetch", mockFetch);
		await supervisor.models.save([{ id: "rally-tool-providers", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady();
		runtime!.registerProvider("rally-tool-providers", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-tool-providers", model: "main", thinkingLevel: "off" });
		await supervisor.models.selectWorker({ provider: "rally-tool-providers", model: "worker", thinkingLevel: "off" });
		await supervisor.start();

		let mainStep = 0, workerStep = 0, mainMessageId = "";
		const route: FauxResponseStep = (context, _options, _state, model) => {
			const tools = getCurrentTools(context.messages).map(tool => tool.name);
			expect(tools).toEqual(expect.arrayContaining(["image_gen", "web_search", "fetch_page"]));
			if (model.id === "main") {
				expect(tools).not.toContain("http_request");
				switch (mainStep++) {
					case 0:
						mainMessageId = supervisor.main.state().messages.findLast(line => line.role === "user")!.id;
						return fauxAssistantMessage(fauxToolCall("image_gen", { userMessageId: mainMessageId, prompt: "single image", providerOptions: { size: "1:1" } }), { stopReason: "toolUse" });
					case 1:
						expect(getMessageText(context.messages.findLast(message => message.role === "toolResult"))).toContain("API 文档");
						return fauxAssistantMessage(fauxToolCall("image_gen", { userMessageId: mainMessageId, prompt: "single image", providerOptions: { size: "1:1" } }), { stopReason: "toolUse" });
					case 2:
						expect(getMessageText(context.messages.findLast(message => message.role === "toolResult"))).toContain("参数没有变化");
						return fauxAssistantMessage(fauxToolCall("image_gen", {
							userMessageId: mainMessageId, prompt: "single image", background: "opaque", quality: "high",
							output_compression: 100, count: 1, omitModel: true, output_format: "png", response_format: "b64_json", size: "1024x1024", style: "natural",
						}), { stopReason: "toolUse" });
					case 3:
						return fauxAssistantMessage(fauxToolCall("image_gen", { userMessageId: mainMessageId, prompt: "duplicate image", providerOptions: { omitModel: true } }), { stopReason: "toolUse" });
					case 4:
						expect(getMessageText(context.messages.findLast(message => message.role === "toolResult"))).toContain("只能生成一次单张图片");
						return fauxAssistantMessage(fauxToolCall("web_search", { query: "main search" }), { stopReason: "toolUse" });
					case 5:
						expect(getMessageText(context.messages.findLast(message => message.role === "toolResult"))).toContain(resultUrl);
						return fauxAssistantMessage("图片和搜索结果已返回。");
					case 6:
						return fauxAssistantMessage(fauxToolCall("image_gen", { userMessageId: mainMessageId, prompt: "stale message" }), { stopReason: "toolUse" });
					case 7:
						expect(getMessageText(context.messages.findLast(message => message.role === "toolResult"))).toContain("最近一条");
						return fauxAssistantMessage("未重复生成图片。");
					default: return fauxAssistantMessage("已收到任务汇报。");
				}
			}
			expect(tools).toContain("http_request");
			if (workerStep++ === 0) return fauxAssistantMessage(fauxToolCall("web_search", { query: "worker search" }), { stopReason: "toolUse" });
			if (workerStep === 2) return fauxAssistantMessage(fauxToolCall("image_gen", { prompt: "authorized batch", providerOptions: { count: 2, size: "1024x1024" } }), { stopReason: "toolUse" });
			if (workerStep === 3) return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "两张图片已完成" }), { stopReason: "toolUse" });
			return fauxAssistantMessage("完成。");
		};
		harness.setResponses(Array(18).fill(route));
		await supervisor.main.send("生成一张图片并搜索公开资料。");
		await vi.waitFor(() => { expect(mainStep).toBe(6); expect(supervisor.main.isBusy()).toBe(false); }, { timeout: 10000 });
		const chatLines = supervisor.main.state().messages;
		const mainRefs = chatLines.flatMap(line => line.attachments ?? []);
		expect(mainRefs).toHaveLength(1);
		expect(chatLines.flatMap(line => line.toolCalls ?? []).filter(call => call.name === "image_gen").map(call => call.status)).toEqual(["error", "error", "ok", "error"]);
		expect(imageCalls).toEqual([{ model: "draft", prompt: "single image", size: "1:1" }, { model: "draft", prompt: "single image" }]);
		await supervisor.main.send("谢谢，保持这张图。");
		await vi.waitFor(() => { expect(mainStep).toBe(8); expect(supervisor.main.isBusy()).toBe(false); }, { timeout: 10000 });
		expect(imageCalls).toHaveLength(2);

		const current = retained(cloud[C.toolProvidersState]());
		cloud[C.toolProvidersSave]({ ...current, images: current.images.map(image => image.id === "a" ? { ...image, responseFormat: "b64_json" } : image) });
		const task = supervisor.store.create({ title: "批量生图", quotes: [], cwd: directory, mode: "readonly", scope: [], dependsOn: [], autoApprove: false }).task;
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"), { timeout: 10000 });
		const tool = supervisor.store.timeline(task.id).find(call => call.name === "image_gen");
		expect(tool).toMatchObject({ status: "ok" });
		expect(tool?.attachments).toHaveLength(2);
		expect(task.runs.at(-1)?.lastReport?.attachments).toEqual(tool?.attachments);
		expect(imageCalls.at(-1)).toEqual({ model: "draft", n: 2, prompt: "authorized batch", size: "1024x1024", response_format: "b64_json" });
		expect(searchCalls).toEqual(["main search", "worker search"]);
		expect(supervisor.store.access(task.id)).toEqual([
			expect.objectContaining({ tool: "web_search", kind: "net", method: "POST", target: "api.tavily.com", requestIndex: 1 }),
			expect.objectContaining({ tool: "image_gen", kind: "net", method: "POST", target: "images.example.invalid", requestIndex: 1 }),
		]);
		for (const ref of [...mainRefs, ...tool!.attachments!]) {
			const resource = supervisor.resources.get(ref.id, "second-paired-client");
			expect(resource).toMatchObject({ source: "generated", mime: "image/png", sha256: createHash("sha256").update(png).digest("hex") });
			const response = await nativeFetch(await preview.url(ref.id));
			expect(response.headers.get("content-type")).toBe("image/png");
			expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
			const destination = join(directory, `${ref.id}.png`);
			await saveResource(createReadStream(supervisor.resources.path(ref.id, "desktop")), destination, resource, new AbortController().signal, () => {});
			expect(readFileSync(destination)).toEqual(png);
		}
	});
});
