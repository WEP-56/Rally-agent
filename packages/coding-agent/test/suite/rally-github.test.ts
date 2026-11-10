import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToolContext } from "../../src/index.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { GithubReadSchema, resolveGithubRepository, type GithubInput } from "../../../../src/main/supervisor/github-plan.ts";
import { managedGithubRunner, type GithubRunner } from "../../../../src/main/supervisor/github-runner.ts";
import { createGithubReadTool, createGithubTool } from "../../../../src/main/supervisor/github-tool.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ProcessRegistry, type OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { readTask } from "../../../../src/main/supervisor/task-read.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const harnesses: Harness[] = []; const registries: ProcessRegistry[] = []; const supervisors: Supervisor[] = [];
const context = {} as ExtensionToolContext;
let callSequence = 0;
const safeEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1" });
afterEach(async () => {
	await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose()));
	await Promise.all(registries.splice(0).map(registry => registry.dispose()));
	vi.restoreAllMocks(); vi.unstubAllEnvs();
	for (const harness of harnesses.splice(0)) harness.cleanup();
}, 30000);
async function setup() {
	const harness = await createHarness(); harnesses.push(harness);
	const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
	const events = new EventLog(paths.eventsFile); const store = new TaskStore(events, paths.workspaceDir, () => {}); const audit = new AuditLog(paths.auditFile, events);
	const task = store.create({ title: "GitHub fixture", cwd: harness.tempDir, mode: "readonly", scope: [], dependsOn: [], quotes: [], autoApprove: true }).task;
	const run = store.startRun(task.id, "dispatch", "faux"); mkdirSync(task.outputDir, { recursive: true });
	const host = { task, run, store, audit, isActive: () => !task.ended && !run.endedAt };
	const stopped: OwnedProcess[] = [];
	const registry = new ProcessRegistry(join(harness.tempDir, "managed"), { assertWritable: () => {}, graceMs: 0, onStopped: entry => stopped.push(entry) }); registries.push(registry);
	return { harness, paths, host, registry, stopped };
}
function fakeGh(registry: ProcessRegistry, directory: string) {
	const script = join(directory, "gh-fixture.cjs");
	writeFileSync(script, `const {readFileSync}=require('node:fs');
const args=process.argv.slice(2);
if(args[0]==='repo') { process.stderr.write('fixture warning'); process.stdout.write(JSON.stringify({nameWithOwner:'fixture/repo',url:'https://enterprise.example/fixture/repo'})); }
else if(args.includes('--search=large')) process.stdout.write('完成 ✓\\n'.repeat(12000));
else if(args.includes('--search=oversize')) process.stdout.write('X'.repeat(1024*1024+1));
else { const body=readFileSync(0,'utf8'); process.stdout.write(JSON.stringify({args,body,cwd:process.cwd()})); }
`);
	const run = registry.run.bind(registry);
	return vi.spyOn(registry, "run").mockImplementation((command, owner, options) => {
		if (owner.kind !== "github") return run(command, owner, options);
		expect(command.executable).toBe("gh"); expect(command.env.GH_PROMPT_DISABLED).toBe("1");
		expect(command.env.GH_REPO).toBeUndefined(); expect(command.env.GH_HOST).toBeUndefined(); expect(command.env.GH_DEBUG).toBeUndefined();
		// A real local child uses the production registry; credentials never enter it.
		return run({ ...command, executable: process.execPath, args: [script, ...command.args], env: safeEnv() }, owner, options);
	});
}
function call(host: Awaited<ReturnType<typeof setup>>["host"], runner: GithubRunner, input: GithubInput, signal?: AbortSignal) {
	return createGithubTool(host, runner).execute(`github-call-${++callSequence}`, input, signal, undefined, context);
}

describe("Rally GitHub tools (offline)", () => {
	it("exposes only read actions to the main agent and rejects direct attempts to mutate", async () => {
		const { harness } = await setup(); const runner = vi.fn<GithubRunner>();
		const tool = createGithubReadTool(() => harness.tempDir, harness.tempDir, runner);
		expect(JSON.stringify(GithubReadSchema)).not.toMatch(/create|comment|body|title/);
		await expect(tool.execute("id", { action: "issue_create", repo: "fixture/repo", title: "hidden", body: "no" } as unknown as Parameters<typeof tool.execute>[1], undefined, undefined, context)).rejects.toThrow("READONLY_VIOLATION");
		expect(runner).not.toHaveBeenCalled();
	});
	it.each([
		{ action: "pr_create", title: "missing head", body: "" },
		{ action: "issue_comment", number: 0, body: "no" },
		{ action: "pr_comment", number: 12, body: "  " },
		{ action: "issue_list", limit: 101 },
		{ action: "pr_view", number: 2, body: "ignored write input" },
		{ action: "issue_list", repo: "https://user:secret@github.com/o/r" },
		{ action: "issue_list", repo: "github.com/../r" },
		{ action: "issue_create", title: "title", body: "nul\0body" },
	] as GithubInput[])("rejects invalid requests before repository discovery: %j", async input => {
		const { host } = await setup(); const runner = vi.fn<GithubRunner>();
		await expect(call(host, runner, input)).rejects.toThrow("GITHUB_ARGUMENT_INVALID"); expect(runner).not.toHaveBeenCalled();
	});
	it("pins repository discovery and preserves literal body/flags in a real managed child", async () => {
		const { host, registry, harness, stopped, paths } = await setup();
		vi.stubEnv("GH_REPO", "wrong/repo"); vi.stubEnv("GH_HOST", "wrong.example"); vi.stubEnv("GH_DEBUG", "api");
		const spy = fakeGh(registry, harness.tempDir); const body = "# 正文\r\n`code` $() ${SECRET} & >file\n--web\n";
		const result = await call(host, managedGithubRunner(registry, host.task.id), { action: "pr_create", title: "--web `literal`", body, head: "author:branch", base: "main", draft: true });
		const output = JSON.parse(result.details.output);
		expect(output).toEqual({ cwd: host.task.cwd, body, args: ["pr", "create", "--title=--web `literal`", "--head=author:branch", "--base=main", "--draft", "--body-file=-", "--repo=enterprise.example/fixture/repo"] });
		expect(spy).toHaveBeenCalledTimes(2); expect(stopped).toHaveLength(2);
		expect(stopped.every(entry => entry.kind === "github" && entry.taskId === host.task.id)).toBe(true);
		expect(host.task.lastExternalAction?.tool).toContain("enterprise.example/fixture/repo"); expect(host.task.gates).toBeUndefined();
		const attempt: unknown = JSON.parse(readFileSync(paths.auditFile, "utf8").split("\n")[0]);
		expect(attempt).toMatchObject({ action: "pr_create", bodySha256: expect.stringMatching(/^[a-f0-9]{64}$/), bodyBytes: Buffer.byteLength(body) });
		expect(JSON.stringify(stopped)).not.toContain(body); expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 20000);
	it("supports all four queries with explicit repo and without external-action audits", async () => {
		const { host, paths } = await setup(); const runner = vi.fn<GithubRunner>(async () => ({ exitCode: 0, output: "[]" }));
		for (const action of ["issue_list", "pr_list", "issue_view", "pr_view"] as const) await call(host, runner, { action, repo: "fixture/repo", ...(action.endsWith("list") ? { state: "all", search: "--web", limit: 5 } : { number: 9 }) });
		expect(runner).toHaveBeenCalledTimes(4); expect(runner.mock.calls.every(([, args]) => args.includes("--repo=github.com/fixture/repo") && args.some(arg => arg.startsWith("--json=")))).toBe(true);
		expect(runner.mock.calls[0][1]).toContain("--search=--web"); expect(host.task.lastExternalAction).toBeUndefined();
		expect(host.store.access(host.task.id)).toHaveLength(4);
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.access(host.task.id)).toEqual(host.store.access(host.task.id));
		expect(readTask(restored, restored.get(host.task.id)!, { view: "files" })).toMatchObject({ accesses: expect.arrayContaining([expect.objectContaining({ tool: "github", kind: "net", target: "github.com", coverage: "command_scope", outcome: "attempt" })]) });
	});
	it.each(["issue_create", "issue_comment", "pr_comment"] as const)("audits %s before execution and preserves a nonzero result without retry", async action => {
		const { host, paths } = await setup();
		const runner = vi.fn<GithubRunner>(async (_cwd, _args, options) => {
			expect(readFileSync(paths.auditFile, "utf8")).toContain('"result":"attempt"');
			expect(host.task.lastExternalAction?.tool).toContain(action); expect(options.stdin).toBe("literal body");
			return { exitCode: 1, output: "network response lost" };
		});
		const response = await call(host, runner, { action, repo: "fixture/repo", body: "literal body", ...(action === "issue_create" ? { title: "title" } : { number: 5 }) });
		expect(response).toMatchObject({ isError: true, details: { exitCode: 1 } }); expect(runner).toHaveBeenCalledOnce();
		expect(readFileSync(paths.auditFile, "utf8")).toContain('"outcome":"unknown"'); expect(host.task.gates).toBeUndefined();
	});
	it("never dispatches after an ended task, failed repository lookup or audit failure", async () => {
		const { host } = await setup(); const runner = vi.fn<GithubRunner>(async () => ({ exitCode: 1, output: "not authenticated" }));
		const input: GithubInput = { action: "issue_create", title: "title", body: "" };
		await expect(call({ ...host, isActive: () => false }, runner, input)).rejects.toThrow("TASK_ENDED"); expect(runner).not.toHaveBeenCalled();
		await expect(call(host, runner, input)).rejects.toThrow("GITHUB_REPO_UNRESOLVED"); expect(runner).toHaveBeenCalledOnce(); runner.mockClear();
		vi.spyOn(host.audit, "append").mockImplementationOnce(() => { throw new Error("audit disk failure"); });
		await expect(call(host, runner, { ...input, repo: "fixture/repo" })).rejects.toThrow("audit disk failure"); expect(runner).not.toHaveBeenCalled();
	});
	it("rejects malformed discovery and stale task state after discovery", async () => {
		const { host } = await setup();
		await expect(resolveGithubRepository(host.task.cwd, undefined, { outputDir: host.task.outputDir }, async () => ({ exitCode: 0, output: '{"url":"https://evil.example/o/r?token=secret","nameWithOwner":"o/r"}' }))).rejects.toThrow("GITHUB_REPO_UNRESOLVED");
		const runner = vi.fn<GithubRunner>(async () => { host.run.endedAt = Date.now(); return { exitCode: 0, output: '{"url":"https://github.com/o/r","nameWithOwner":"o/r"}' }; });
		await expect(call(host, runner, { action: "issue_create", title: "title", body: "" })).rejects.toThrow("TASK_ENDED"); expect(runner).toHaveBeenCalledOnce();
	});
	it("spools long Unicode output and bounds machine-readable metadata", async () => {
		const { host, registry, harness } = await setup(); fakeGh(registry, harness.tempDir);
		const runner = managedGithubRunner(registry);
		const result = await runner(host.task.cwd, ["issue", "list", "--search=large"], { outputDir: host.task.outputDir });
		expect(result.output.length).toBeLessThan(30000); expect(readFileSync(result.fullOutputPath!, "utf8")).toBe("完成 ✓\n".repeat(12000));
		await expect(runner(host.task.cwd, ["issue", "list", "--search=oversize"], { outputDir: host.task.outputDir, metadata: true })).rejects.toThrow("GITHUB_METADATA_TOO_LARGE");
		expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 20000);
	it("cancels a real command tree, audits an uncertain result and rejects launches after disposal", async () => {
		const { host, registry, paths } = await setup(); const controller = new AbortController();
		const tree = fileURLToPath(new URL("../fixtures/rally-process-tree.cjs", import.meta.url));
		let pids: { root: number; leaf: number } | undefined; let output = "";
		const run = registry.run.bind(registry);
		vi.spyOn(registry, "run").mockImplementation((command, owner, options) => run({ ...command, executable: process.execPath, args: [tree], env: safeEnv() }, owner, { ...options, onStdout: chunk => {
			options.onStdout(chunk); output += chunk;
			if (output.includes("\n")) { pids = JSON.parse(output.trim()); controller.abort(); }
		} }));
		const runner = managedGithubRunner(registry, host.task.id);
		await expect(call(host, runner, { action: "issue_comment", repo: "fixture/repo", number: 2, body: "fixture" }, controller.signal)).rejects.toThrow("GITHUB_ABORTED");
		expect(pids).toBeDefined(); for (const pid of Object.values(pids!)) expect(() => process.kill(pid, 0)).toThrow();
		expect(readFileSync(paths.auditFile, "utf8")).toContain('"result":"cancelled"'); expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
		await registry.dispose(); await expect(runner(host.task.cwd, ["issue", "list"], { outputDir: host.task.outputDir })).rejects.toThrow("PROCESS_REGISTRY_CLOSED");
	}, 20000);
	it("wires production main/worker sessions, cwd, tool results, notices and restored access records", async () => {
		vi.stubEnv("PI_OFFLINE", "1");
		const harness = await createHarness({ provider: "rally-github", models: [{ id: "main" }, { id: "worker" }] }); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(supervisor);
		await supervisor.models.save([{ id: "rally-github", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady();
		runtime!.registerProvider("rally-github", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-github", model: "main", thinkingLevel: "off" });
		await supervisor.models.selectWorker({ provider: "rally-github", model: "worker", thinkingLevel: "off" });
		const gh = fakeGh(supervisor.processes, harness.tempDir);
		await supervisor.start(); const mainDir = join(harness.tempDir, "main-workspace"); supervisor.workspace.update({ defaultWorkspace: mainDir });
		let mainCalls = 0; let workerCalls = 0;
		const route: FauxResponseStep = (ctx, _options, _state, model) => {
			const tools = getCurrentTools(ctx.messages).map(tool => tool.name);
			if (model.id === "main") {
				expect(tools).toContain("github_read"); expect(tools).not.toContain("github");
				if (mainCalls++ === 0) return fauxAssistantMessage(fauxToolCall("github_read", { action: "issue_view", repo: "fixture/repo", number: 7 }), { stopReason: "toolUse" });
				return fauxAssistantMessage("查询结束");
			}
			expect(tools).toContain("github"); expect(tools).not.toContain("github_read");
			if (workerCalls++ === 0) return fauxAssistantMessage(fauxToolCall("github", { action: "issue_comment", repo: "fixture/repo", number: 7, body: "离线评论" }), { stopReason: "toolUse" });
			if (workerCalls === 2) {
				expect(getMessageText(ctx.messages.findLast(message => message.role === "toolResult"))).toContain("离线评论");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "离线评论已记录" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("完成");
		};
		harness.setResponses(Array(12).fill(route)); await supervisor.main.send("查询 fixture/repo #7，并发表评论：离线评论");
		await vi.waitFor(() => { expect(mainCalls).toBeGreaterThan(1); expect(supervisor.main.isBusy()).toBe(false); }, { timeout: 15000 });
		const source = supervisor.main.state().messages.find(message => message.role === "user")!;
		const task = supervisor.store.create({ title: "comment", quotes: [{ messageId: source.id, kind: "user", text: source.text, at: Date.now() }], cwd: harness.tempDir, mode: "readonly", scope: [], dependsOn: [], autoApprove: false }).task;
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"), { timeout: 15000 });
		expect(gh.mock.calls.filter(([, owner]) => owner.kind === "github").map(([command, owner]) => [command.cwd, owner.taskId])).toEqual([[mainDir, undefined], [harness.tempDir, task.id]]);
		expect(task.lastExternalAction?.tool).toContain("issue_comment"); expect(task.gates).toBeUndefined();
		expect(supervisor.store.timeline(task.id)).toEqual(expect.arrayContaining([expect.objectContaining({ name: "github", status: "ok" })]));
		const accesses = supervisor.store.access(task.id); expect(accesses).toHaveLength(1);
		await supervisor.dispose(); const restored = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(restored);
		expect(restored.store.access(task.id)).toEqual(accesses); expect(restored.store.get(task.id)?.lastExternalAction).toEqual(task.lastExternalAction);
	}, 30000);
});
