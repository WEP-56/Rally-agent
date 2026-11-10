import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { resolveRallyPaths } from "../../../../src/main/paths.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import { managedModelConfigValue } from "../../../../src/main/supervisor/model-config-value.ts";
import { ProcessRegistry, type OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { createHarness, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
const registries: ProcessRegistry[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(registries.splice(0).map((registry) => registry.dispose()));
	for (const harness of harnesses.splice(0)) harness.cleanup();
});
async function setup() {
	const harness = await createHarness();
	harnesses.push(harness);
	const stopped: OwnedProcess[] = [];
	const registry = new ProcessRegistry(join(harness.tempDir, "managed"), {
		assertWritable: () => {},
		graceMs: 0,
		onStopped: (entry) => {
			stopped.push(entry);
		},
	});
	registries.push(registry);
	const runtime = await ModelRuntime.create({
		credentials: harness.authStorage,
		modelsPath: null,
		refreshOnCreate: false,
		resolveConfigValue: managedModelConfigValue(registry, harness.tempDir),
	});
	const model = {
		id: "test",
		name: "test",
		reasoning: false,
		input: ["text" as const],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 4096,
		maxTokens: 1024,
	};
	runtime.registerProvider("managed-test", {
		api: "openai-completions",
		baseUrl: "http://127.0.0.1:1",
		apiKey: "!echo private-key",
		headers: { "X-Provider": "!echo private-provider" },
		models: [{ ...model, headers: { "X-Model": "!echo private-model" } }],
	});
	return { harness, registry, runtime, model, stopped };
}
describe("managed model configuration", () => {
	it("does not run commands for availability; resolves provider/model values per request without persisting secrets", async () => {
		const { runtime, registry, stopped } = await setup();
		await runtime.checkAuth("managed-test");
		expect(stopped).toEqual([]);
		const model = runtime.getModel("managed-test", "test")!;
		for (let i = 0; i < 2; i++)
			expect(await runtime.getAuth(model)).toMatchObject({
				auth: { apiKey: "private-key", headers: { "X-Provider": "private-provider", "X-Model": "private-model" } },
			});
		expect(stopped).toHaveLength(6);
		expect(stopped.every((entry) => entry.kind === "config" && !entry.taskId)).toBe(true);
		expect(JSON.stringify(stopped)).not.toContain("private");
		expect(readFileSync(registry.file, "utf8")).not.toContain("private");
	}, 30000);
	it("resolves auth.json commands on builtin providers without modifying stored credentials", async () => {
		const { runtime, harness, stopped } = await setup();
		await harness.authStorage.modify("anthropic", async () => ({ type: "api_key", key: "!echo stored-private" }));
		await runtime.checkAuth("anthropic");
		expect(stopped).toEqual([]);
		expect(await runtime.getAuth("anthropic")).toMatchObject({ auth: { apiKey: "stored-private" } });
		expect(await harness.authStorage.read("anthropic", undefined, true)).toMatchObject({
			key: "!echo stored-private",
		});
		expect(stopped).toHaveLength(1);
	});
	it("cancels registered configuration execution and clears its registry entry", async () => {
		const { runtime, registry, stopped } = await setup();
		const controller = new AbortController();
		const run = registry.run.bind(registry);
		vi.spyOn(registry, "run").mockImplementation((command, owner, options) =>
			run(command, owner, { ...options, onStarted: () => controller.abort() }),
		);
		await expect(runtime.getAuth("managed-test", { signal: controller.signal })).rejects.toThrow();
		await registry.dispose();
		expect(stopped).toHaveLength(1);
		expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	});
	it("rejects new command resolutions after application process shutdown", async () => {
		const { runtime, registry } = await setup();
		await registry.dispose();
		await expect(runtime.getAuth("managed-test")).rejects.toThrow();
	});
	it("resolves OAuth headers and preserves OAuth credentials", async () => {
		const { runtime, harness, model, stopped } = await setup();
		const credential = {
			type: "oauth" as const,
			access: "oauth-token",
			refresh: "refresh-token",
			expires: Date.now() + 3600000,
		};
		await harness.authStorage.modify("oauth-test", async () => credential);
		runtime.registerProvider("oauth-test", {
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:1",
			headers: { "X-Secret": "!echo oauth-header" },
			models: [model],
			oauth: {
				name: "fixture",
				login: async () => credential,
				refreshToken: async () => credential,
				getApiKey: (current) => current.access,
			},
		});
		expect(await runtime.getAuth("oauth-test")).toMatchObject({
			auth: { apiKey: "oauth-token", headers: { "X-Secret": "oauth-header" } },
		});
		expect(await harness.authStorage.read("oauth-test")).toEqual(credential);
		expect(stopped).toHaveLength(1);
	});
	it("passes request cancellation into OAuth header commands", async () => {
		const { runtime, harness, model, registry, stopped } = await setup();
		const controller = new AbortController();
		const credential = { type: "oauth" as const, access: "token", refresh: "refresh", expires: Date.now() + 3600000 };
		await harness.authStorage.modify("oauth-test", async () => credential);
		runtime.registerProvider("oauth-test", {
			api: "openai-completions",
			baseUrl: "http://127.0.0.1:1",
			headers: { "X-Secret": "!echo oauth-header" },
			models: [model],
			oauth: {
				name: "fixture",
				login: async () => credential,
				refreshToken: async () => credential,
				getApiKey: (current) => current.access,
			},
		});
		const run = registry.run.bind(registry);
		vi.spyOn(registry, "run").mockImplementation((command, owner, options) =>
			run(command, owner, { ...options, onStarted: () => controller.abort() }),
		);
		await expect(runtime.getAuth("oauth-test", { signal: controller.signal })).rejects.toThrow();
		await registry.dispose();
		expect(stopped).toHaveLength(1);
	});
	it("cleans an already running command on request cancellation", async () => {
		const { registry, harness, stopped } = await setup();
		const controller = new AbortController();
		const run = registry.run.bind(registry);
		vi.spyOn(registry, "run").mockImplementation((command, owner, options) =>
			run(command, owner, {
				...options,
				onStdout: (text) => {
					options.onStdout(text);
					controller.abort();
				},
			}),
		);
		await expect(
			managedModelConfigValue(registry, harness.tempDir)(
				"!printf ready; sleep 60",
				"fixture",
				undefined,
				controller.signal,
			),
		).rejects.toThrow();
		expect(stopped).toHaveLength(1);
		expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it("uses the production Supervisor model runtime and records config ownership", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const supervisor = new Supervisor(resolveRallyPaths(harness.tempDir), { emitChat: () => {}, emitTask: () => {} });
		try {
			await supervisor.start();
			const runtime = (await supervisor.models.whenReady())!;
			runtime.registerProvider("production-config", {
				api: "openai-completions",
				baseUrl: "http://127.0.0.1:1",
				apiKey: "!echo production-private",
				models: [],
			});
			expect(await runtime.getAuth("production-config")).toMatchObject({ auth: { apiKey: "production-private" } });
			expect(supervisor.events.ofKind("process_stopped")).toMatchObject([{ data: { kind: "config" } }]);
			expect(JSON.stringify(supervisor.events.ofKind("process_stopped"))).not.toContain("production-private");
		} finally {
			await supervisor.dispose();
		}
	}, 15000);
	it("does not execute an interpolated credential beginning with an exclamation mark", async () => {
		const { runtime, harness, stopped } = await setup();
		await harness.authStorage.modify("anthropic", async () => ({
			type: "api_key",
			key: "$VALUE",
			env: { VALUE: "!echo must-stay-literal" },
		}));
		expect(await runtime.getAuth("anthropic")).toMatchObject({ auth: { apiKey: "!echo must-stay-literal" } });
		expect(stopped).toEqual([]);
	});
});
