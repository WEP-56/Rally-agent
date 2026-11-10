import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ModelStore } from "../../../../src/main/model-store.ts";
import { SkillStore } from "../../../../src/main/skill-store.ts";
import { McpStore } from "../../../../src/main/mcp-store.ts";
import { projectTrustState, setProjectTrust, projectSettings } from "../../../../src/main/project-trust.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createMainTaskTools, createWorkerTools } from "../../../../src/main/supervisor/tools.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { Scheduler } from "../../../../src/main/supervisor/scheduler.ts";
import { WorkspaceStore } from "../../../../src/main/workspace-store.ts";
import { createRouterReadTools } from "../../../../src/main/supervisor/router-tools.ts";
import { toolInput, toolOutput } from "../../../../src/shared/tools.ts";
import { taskView } from "../../../../src/shared/task.ts";
import { assistantContent, type AssistantMessageView } from "../../../../src/shared/conversation.ts";
import { DefaultResourceLoader, type ExtensionToolContext } from "../../src/index.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("Rally production supervisor integration (offline faux provider)", () => {
	const harnesses: Harness[] = [];
	const supervisors: Supervisor[] = [];
	afterEach(async () => {
		await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.dispose()));
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});

	async function setup(workerConfigured = true, keepRecentTokens = 20000) {
		// Search tools must use installed binaries, never download during offline integration tests.
		vi.stubEnv("PI_OFFLINE", "1");
		const harness = await createHarness({ provider: "rally-test", models: [{ id: "main-1" }, { id: "worker-1" }, { id: "worker-2" }] });
		harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home"));
		ensureRallyDirs(paths);
		writeFileSync(join(paths.agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens } }));
		mkdirSync(paths.workspaceDir, { recursive: true });
		writeFileSync(join(paths.workspaceDir, "README.md"), "# Fixture README\nfirst twenty lines\n");
		writeFileSync(join(paths.workspaceDir, "AGENTS.md"), "RALLY_PROJECT_INSTRUCTIONS_SENTINEL");
		mkdirSync(join(paths.workspaceDir, ".rally", "skills", "fixture-skill"), { recursive: true });
		writeFileSync(join(paths.workspaceDir, ".rally", "skills", "fixture-skill", "SKILL.md"), "---\nname: fixture-skill\ndescription: Fixture worker skill for integration tests\n---\n\nFIXTURE_WORKER_SKILL_SENTINEL\n");
		setProjectTrust(paths.agentDir, paths.workspaceDir, true);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
		supervisors.push(supervisor);
		await supervisor.models.save([{ id: "rally-test", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux-key", models: harness.models.map((model) => defaultModel(model.id)) }]);
		const runtime = await supervisor.models.whenReady();
		if (!runtime) throw new Error("Missing model runtime");
		// Keep the production config/session path; only the provider's transport is faux.
		runtime.registerProvider("rally-test", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map((model) => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "rally-test", model: "main-1", thinkingLevel: "off" });
		if (workerConfigured) await supervisor.models.selectWorker({ provider: "rally-test", model: "worker-1", thinkingLevel: "off" });
		await supervisor.start();
		return { harness, paths, supervisor };
	}

	function toolNames(context: TranscriptContext) { return getCurrentTools(context.messages).map((tool) => tool.name); }
	it("refreshes memory in tool loops and after restart/compaction without persisting snapshots", async () => {
		const { harness, paths, supervisor } = await setup(true, 1);
		writeFileSync(paths.memoryFile, "MEMORY_INITIAL_SENTINEL");
		harness.setResponses([
			(context) => {
				expect(toolNames(context)).toEqual(expect.arrayContaining(["memory_append", "memory_remove"]));
				expect(JSON.stringify(context.messages)).toContain("MEMORY_INITIAL_SENTINEL");
				expect(getCurrentSystemPrompt(context.messages)).not.toContain("MEMORY_INITIAL_SENTINEL");
				writeFileSync(paths.memoryFile, "MEMORY_EDITED_SENTINEL");
				const id = /User message (#\d+)/.exec(lastUser(context))![1];
				return fauxAssistantMessage(fauxToolCall("memory_append", { text: "use pnpm", quotes: [{ id }] }), { stopReason: "toolUse" });
			},
			(context) => {
				expect(JSON.stringify(context.messages)).toContain("MEMORY_EDITED_SENTINEL");
				expect(JSON.stringify(context.messages)).not.toContain("MEMORY_INITIAL_SENTINEL");
				expect(JSON.stringify(context.messages)).toContain("use pnpm");
				return fauxAssistantMessage("记忆完成");
			},
			fauxAssistantMessage("压缩摘要"),
		]);
		await supervisor.main.send("记住 use pnpm");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some(m => m.text === "记忆完成"), JSON.stringify(supervisor.main.state().messages)).toBe(true));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		expect(supervisor.main.state().messages.some(m => m.text === "记忆完成"), JSON.stringify(supervisor.main.state().messages)).toBe(true);
		await supervisor.main.reset();
		writeFileSync(paths.memoryFile, "MEMORY_AFTER_COMPACTION");
		harness.setResponses([(context) => { expect(JSON.stringify(context.messages)).toContain("MEMORY_AFTER_COMPACTION"); return fauxAssistantMessage("已读取"); }]);
		await supervisor.main.send("当前偏好");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some(m => m.text === "已读取")).toBe(true));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		await supervisor.dispose();
		const recovered = await restart(paths, harness);
		writeFileSync(paths.memoryFile, "MEMORY_RESTART_SENTINEL");
		harness.setResponses([(context) => { expect(JSON.stringify(context.messages)).toContain("MEMORY_RESTART_SENTINEL"); return fauxAssistantMessage("重启读取"); }]);
		await recovered.main.send("当前偏好");
		await vi.waitFor(() => expect(recovered.main.state().messages.some(m => m.text === "重启读取")).toBe(true));
		await vi.waitFor(() => expect(recovered.main.isBusy()).toBe(false));
		for (const name of readdirSync(paths.sessionsMainDir).filter(n => n.endsWith(".jsonl"))) {
			const persisted = readFileSync(join(paths.sessionsMainDir, name), "utf8");
			expect(persisted).not.toContain("MEMORY_INITIAL_SENTINEL"); expect(persisted).not.toContain("MEMORY_EDITED_SENTINEL"); expect(persisted).not.toContain("MEMORY_RESTART_SENTINEL");
		}
		expect(harness.getPendingResponseCount()).toBe(0);
	});
	async function restart(paths: Supervisor["paths"], harness: Harness) {
		const recovered = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(recovered);
		const runtime = await recovered.models.whenReady();
		if (!runtime) throw new Error("Missing recovered runtime");
		runtime.registerProvider("rally-test", { api: harness.faux.api, apiKey: "faux-key", baseUrl: "http://localhost:0", models: harness.models.map((model) => ({ ...model, type: "chat" as const })) });
		await recovered.start();
		return recovered;
	}
	function lastUser(context: TranscriptContext) { return getMessageText(context.messages.findLast((message) => message.role === "user")); }
	function createTask(supervisor: Supervisor, overrides: Partial<Parameters<Supervisor["store"]["create"]>[0]> = {}) {
		return supervisor.store.create({ title: "离线任务", quotes: [{ messageId: "#fixture", kind: "user", text: "用户原话", at: Date.now() }], cwd: supervisor.paths.workspaceDir, scope: [], mode: "readonly", dependsOn: [], autoApprove: supervisor.board().autoApprove, ...overrides }).task;
	}
	function toolsFor(supervisor: Supervisor) {
		const tools = createMainTaskTools({ store: supervisor.store, workspaceDir: supervisor.workspace.base(), autoApprove: () => supervisor.board().autoApprove,
			quote: (ref) => ["#fixture", "#fixture2"].includes(ref.id) ? { messageId: ref.id, kind: "user", text: "逐字原话", at: Date.now() } : null,
			tick: () => supervisor.scheduler.tick(), board: () => supervisor.board(), abortWorker: (id) => { void supervisor.workers.abort(id); },
			deliverSteer: (id, text) => supervisor.workers.deliver(id, text, supervisor.store.get(id)?.inputs.at(-1)?.id) ? "steered" : "queued_for_worker",
			deliverAnswer: (id, text) => supervisor.workers.deliver(id, text, supervisor.store.get(id)?.inputs.at(-1)?.id) ? "steered" : "queued_for_worker" });
		return (name: string, params: unknown) => {
			const tool = tools.find((item) => item.name === name);
			if (!tool) throw new Error(`Missing ${name}`);
			return tool.execute("test", params, undefined, undefined, {} as ExtensionToolContext);
		};
	}

	it("declares Rally roles/tools and runs dispatch → approval → worker read/report → main relay", async () => {
		const { harness, paths, supervisor } = await setup();
		const original = "派发一个任务：让 worker 读取 README 前 20 行并汇报";
		writeFileSync(paths.memoryFile, "WORKER_MUST_NOT_SEE_MEMORY");
		harness.setResponses([
			(context) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				expect(prompt).toContain("Rally");
				expect(prompt).not.toContain("You are a coding assistant running inside pi");
				expect(prompt).not.toContain("Pi documentation");
				expect(prompt).not.toContain("fixture-skill");
				expect(prompt).not.toContain("RALLY_PROJECT_INSTRUCTIONS_SENTINEL");
				expect(toolNames(context)).toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "git_inspect", "task_dispatch", "task_approve", "task_update", "task_steer", "task_answer", "task_resume", "task_cancel", "task_read"]));
				expect(toolNames(context)).not.toEqual(expect.arrayContaining(["write", "bash"]));
				const id = /User message (#\d+)/.exec(lastUser(context))?.[1];
				expect(id).toBeTruthy();
				if (!id) throw new Error("Missing user message id");
				return fauxAssistantMessage(fauxToolCall("task_dispatch", { title: "读取 README", quotes: [{ id }], cwd: paths.workspaceDir, mode: "readonly" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("已创建待批准任务。"),
			(context, _options, _state, model) => {
				expect(model.id).toBe("worker-1");
				expect(getCurrentSystemPrompt(context.messages)).toContain("task agent");
				expect(getCurrentSystemPrompt(context.messages)).toContain("RALLY_PROJECT_INSTRUCTIONS_SENTINEL");
				expect(getCurrentSystemPrompt(context.messages)).toContain("fixture-skill");
				expect(toolNames(context)).toEqual(expect.arrayContaining(["task_report", "task_read", "bash", "powershell"]));
				expect(toolNames(context)).not.toContain("task_dispatch");
				expect(toolNames(context)).not.toContain("memory_append");
				expect(toolNames(context)).not.toContain("memory_remove");
				expect(JSON.stringify(context.messages)).not.toContain("WORKER_MUST_NOT_SEE_MEMORY");
				expect(lastUser(context)).toContain(original);
				return fauxAssistantMessage(fauxToolCall("read", { path: "README.md", limit: 20 }), { stopReason: "toolUse" });
			},
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("Fixture README");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已读取 Fixture README 前 20 行。" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("任务完成。"),
			(context) => {
				expect(JSON.stringify(context.messages)).toContain("已读取 Fixture README 前 20 行。");
				return fauxAssistantMessage("T-1045 已完成，已读取 README。");
			},
		]);
		await supervisor.main.send(original);
		await vi.waitFor(() => expect(supervisor.board().tasks[0]?.status, JSON.stringify(supervisor.main.state().messages)).toBe("pending_approval"));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		const task = supervisor.store.list()[0];
		expect(task.quotes[0].text).toBe(original);
		expect(task.runs).toHaveLength(0);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(supervisor.store.get(task.id)?.ended?.outcome).toBe("done"));
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((message) => message.text === "T-1045 已完成，已读取 README。")).toBe(true), { timeout: 6000 });
		expect(task.runs[0].model).toBe("rally-test/worker-1");
		expect(task.usage.toolCalls).toBeGreaterThanOrEqual(2);
		expect(supervisor.store.timeline(task.id).map((call) => [call.name, call.status])).toEqual([["read", "ok"], ["task_report", "ok"]]);
		expect(supervisor.main.state().messages.flatMap((line) => line.toolCalls ?? []).some((call) => call.name === "task_dispatch" && call.status === "ok")).toBe(true);
		expect(supervisor.workspace.state().recentProjects).toContain(paths.workspaceDir);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("lets a worker discover and read its cwd skill without eagerly injecting the body", async () => {
		const { harness, paths, supervisor } = await setup();
		const task = createTask(supervisor);
		const skillPath = join(paths.workspaceDir, ".rally", "skills", "fixture-skill", "SKILL.md");
		harness.setResponses([
			(context) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				expect(prompt).toContain("Fixture worker skill for integration tests");
				expect(prompt).toContain(skillPath);
				expect(prompt).not.toContain("FIXTURE_WORKER_SKILL_SENTINEL");
				return fauxAssistantMessage(fauxToolCall("read", { path: skillPath }), { stopReason: "toolUse" });
			},
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("FIXTURE_WORKER_SKILL_SENTINEL");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "Read the project skill" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("Done."),
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(supervisor.store.access(task.id)).toEqual([expect.objectContaining({ tool: "read", target: skillPath })]);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("persists imported skills and applies enable changes to later production workers", async () => {
		const { harness, paths, supervisor } = await setup();
		const directory = join(harness.tempDir, "imported-skill");
		mkdirSync(directory);
		writeFileSync(join(directory, "SKILL.md"), "---\nname: imported-skill\ndescription: IMPORTED_SKILL_DESCRIPTION\n---\nImported body");
		const preferences = new SkillStore(paths.agentDir);
		expect(() => preferences.importDirectory(paths.mainCwd)).toThrow("未发现有效");
		preferences.importDirectory(directory);
		preferences.importDirectory(directory);
		const projects = [paths.workspaceDir];
		const listed = await preferences.state(projects);
		expect(listed.skills.filter((skill) => skill.name === "imported-skill")).toHaveLength(1);
		const path = listed.skills.find((skill) => skill.name === "imported-skill")!.path;
		await preferences.setEnabled(path, false, projects);
		expect((await new SkillStore(paths.agentDir).state(projects)).skills.find((skill) => skill.path === path)?.enabled).toBe(false);
		for (const enabled of [false, true]) {
			if (enabled) await preferences.setEnabled(path, true, projects);
			harness.setResponses([
				(context) => {
					expect(getCurrentSystemPrompt(context.messages).includes("IMPORTED_SKILL_DESCRIPTION")).toBe(enabled);
					return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "checked skill selection" }), { stopReason: "toolUse" });
				}, fauxAssistantMessage("Done."),
			]);
			const task = createTask(supervisor);
			supervisor.approve(task.id);
			await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
			await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		}
		expect(readFileSync(join(directory, "SKILL.md"), "utf8")).toContain("Imported body");
	});

	it("honors revoked and inherited project trust in discovery and future worker requests", async () => {
		const { harness, paths, supervisor } = await setup();
		writeFileSync(join(paths.workspaceDir, ".rally", "settings.json"), JSON.stringify({ shellCommandPrefix: "PROJECT_ONLY_PREFIX" }));
		const child = join(paths.workspaceDir, "child");
		mkdirSync(child);
		expect(projectTrustState(paths.agentDir, [child]).projects.find((entry) => entry.path === child)).toMatchObject({ decision: true, inheritedFrom: paths.workspaceDir });
		setProjectTrust(paths.agentDir, child, false);
		expect(projectSettings(child, paths.agentDir, true).isProjectTrusted()).toBe(false);
		expect(projectSettings(paths.workspaceDir, paths.agentDir, false).getShellCommandPrefix()).not.toBe("PROJECT_ONLY_PREFIX");
		for (const trusted of [false, true]) {
			setProjectTrust(paths.agentDir, paths.workspaceDir, trusted);
			expect(projectSettings(paths.workspaceDir, paths.agentDir, true).getShellCommandPrefix()).toBe(trusted ? "PROJECT_ONLY_PREFIX" : undefined);
			expect((await new SkillStore(paths.agentDir).state([paths.workspaceDir])).skills.some((skill) => skill.name === "fixture-skill")).toBe(trusted);
			harness.setResponses([
				(context) => {
					const prompt = getCurrentSystemPrompt(context.messages);
					expect(prompt.includes("fixture-skill")).toBe(trusted);
					expect(prompt).toContain("RALLY_PROJECT_INSTRUCTIONS_SENTINEL");
					return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "checked trust" }), { stopReason: "toolUse" });
				}, fauxAssistantMessage("Done."),
			]);
			const task = createTask(supervisor);
			supervisor.approve(task.id);
			await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
			await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		}
		expect(projectTrustState(paths.agentDir, []).projects).toEqual(expect.arrayContaining([expect.objectContaining({ path: child, decision: false })]));
		const unknown = join(harness.tempDir, "unknown-project");
		mkdirSync(unknown);
		expect(projectSettings(unknown, paths.agentDir, true).isProjectTrusted()).toBe(false);
	});

	it("persists MCP configuration without connecting and applies project trust when merging", async () => {
		const { paths } = await setup();
		const store = new McpStore(paths.agentDir);
		const config = { customMetadata: "preserved", mcpServers: {
			local: { command: "definitely-not-an-executable", args: ["path with spaces", "--flag"], env: { FIXTURE: "value" }, exposure: "direct" },
			remote: { url: "https://example.invalid/mcp", headers: { "X-Fixture": "value" }, enabled: false },
		} };
		expect(store.state().servers).toEqual([]);
		expect(store.save(JSON.stringify(config)).servers).toHaveLength(2);
		store.update("local", false);
		const restored = new McpStore(paths.agentDir);
		expect(JSON.parse(restored.state().json)).toMatchObject({ customMetadata: "preserved", mcpServers: { local: { enabled: false, args: ["path with spaces", "--flag"], env: { FIXTURE: "value" } } } });
		const before = restored.state().json;
		for (const value of ["{", "{}", JSON.stringify({ mcpServers: { bad: { command: 12 } } }), JSON.stringify({ mcpServers: { "a-b": { command: "x" }, a_b: { command: "y" } } })]) {
			expect(() => restored.save(value)).toThrow();
			expect(restored.state().json).toBe(before);
		}
		writeFileSync(join(paths.workspaceDir, ".rally", "mcp.json"), JSON.stringify({ mcpServers: { local: { enabled: true }, project: { command: "project-only" } } }));
		expect(restored.forProject(paths.workspaceDir).servers).toEqual(expect.arrayContaining([expect.objectContaining({ name: "project" }), expect.objectContaining({ name: "local", config: expect.objectContaining({ enabled: true }) })]));
		setProjectTrust(paths.agentDir, paths.workspaceDir, false);
		expect(restored.forProject(paths.workspaceDir).servers.map((server) => server.name)).toEqual(["local", "remote"]);
		expect(restored.forProject(paths.workspaceDir).servers[0].config.enabled).toBe(false);
		expect(restored.update("remote", null).servers.map((server) => server.name)).toEqual(["local"]);
		writeFileSync(join(paths.agentDir, "mcp.json"), "{broken");
		expect(restored.state().errors).toHaveLength(1);
		expect(() => restored.update("local", true)).toThrow();
		expect(readFileSync(join(paths.agentDir, "mcp.json"), "utf8")).toBe("{broken");
	});

	it("runs MCP only on workers, blocks late or risk-marked calls and releases the stdio process", async () => {
		const { supervisor, harness, paths } = await setup();
		const pidFile = join(harness.tempDir, "mcp.pid");
		const callsFile = join(harness.tempDir, "mcp-calls.txt");
		new McpStore(paths.agentDir).save(JSON.stringify({ mcpServers: { fixture: { command: process.execPath, args: [fileURLToPath(new URL("../fixtures/rally-mcp.cjs", import.meta.url)), pidFile, callsFile] } } }));
		harness.setResponses([(context) => {
			expect(toolNames(context).some((name) => name.startsWith("mcp__"))).toBe(false);
			return fauxAssistantMessage("Main has no MCP.");
		}]);
		await supervisor.main.send("Just answer.");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((message) => message.text === "Main has no MCP.")).toBe(true));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		expect(existsSync(pidFile)).toBe(false);
		for (const riskMarked of [false, true]) {
			writeFileSync(join(paths.agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false }, ...(riskMarked ? { mcpTiers: { mcp__fixture__echo: "irreversible" } } : {}) }));
			harness.setResponses([
				(context) => {
					expect(toolNames(context), existsSync(join(paths.agentDir, "mcp.log")) ? readFileSync(join(paths.agentDir, "mcp.log"), "utf8") : "No MCP log").toContain("mcp__fixture__echo");
					return fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { arguments: {} }), { stopReason: "toolUse" });
				},
				(context) => {
					expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain(riskMarked ? "GATE_CONTEXT_REQUIRED" : "MCP_FIXTURE_RESULT");
					return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "MCP checked" }), { stopReason: "toolUse" });
				},
				fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { arguments: {} }), { stopReason: "toolUse" }),
				(context) => {
					expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("TASK_ENDED");
					return fauxAssistantMessage("Done.");
				},
			]);
			const task = createTask(supervisor);
			supervisor.approve(task.id);
			await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"), { timeout: 15000 });
			await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
			const pid = Number(readFileSync(pidFile, "utf8"));
			await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 10000 });
		}
		expect(readFileSync(callsFile, "utf8")).toBe("called\n");
	}, 30000);

	async function setupMcpRisk(tier: "external" | "irreversible", exposure: "direct" | "codemode" = "direct") {
		const context = await setup();
		const { paths, harness } = context;
		const callsFile = join(harness.tempDir, "gate-mcp-calls.txt");
		const preferences = new McpStore(paths.agentDir);
		preferences.save(JSON.stringify({ mcpServers: { fixture: { command: process.execPath, exposure,
			args: [fileURLToPath(new URL("../fixtures/rally-mcp.cjs", import.meta.url)), join(harness.tempDir, "gate-mcp.pid"), callsFile] } } }));
		preferences.setTier("mcp__fixture__echo", tier);
		return { ...context, callsFile, preferences };
	}

	it("persists MCP tiers without dropping other settings and audits external calls without blocking", async () => {
		const { supervisor, harness, paths, callsFile, preferences } = await setupMcpRisk("external");
		expect(JSON.parse(readFileSync(join(paths.agentDir, "settings.json"), "utf8")).compaction).toBeDefined();
		expect(new McpStore(paths.agentDir).state().tools).toContainEqual({ name: "mcp__fixture__echo", tier: "external" });
		expect(() => preferences.setTier("read", "irreversible")).toThrow("无效");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { arguments: { message: "publish" } }), { stopReason: "toolUse" }),
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("MCP_FIXTURE_RESULT");
				preferences.setTier("mcp__fixture__echo", "irreversible");
				return fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { arguments: { message: "publish again" } }), { stopReason: "toolUse" });
			},
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("GATE_CONTEXT_REQUIRED");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "External call checked" }), { stopReason: "toolUse" });
			}, fauxAssistantMessage("Done."),
		]);
		const task = createTask(supervisor); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"), { timeout: 15000 });
		await supervisor.workers.abort(task.id);
		expect(task.gates).toBeUndefined();
		expect(supervisor.board().tasks[0].lastExternalAction?.tool).toBe("mcp__fixture__echo");
		expect(readFileSync(callsFile, "utf8")).toBe("called\n");
		const entries = readFileSync(paths.auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		expect(entries.filter((entry) => entry.kind === "external")).toEqual([expect.objectContaining({ taskId: task.id, action: "mcp__fixture__echo", target: { message: "publish" }, result: "attempt" })]);
		writeFileSync(join(paths.agentDir, "settings.json"), JSON.stringify({ mcpTiers: { mcp__fixture__echo: "invalid" } }));
		expect(preferences.state().errors.join()).toContain("MCP_RISK_CONFIG_INVALID");
		expect(() => preferences.tier("mcp__fixture__echo")).toThrow("MCP_RISK_CONFIG_INVALID");
	}, 20000);

	it.each(["direct", "codemode"] as const)("gates %s MCP calls and executes exact arguments only after a quoted main decision", async (exposure) => {
		const { supervisor, harness, paths, callsFile } = await setupMcpRisk("irreversible", exposure);
		writeFileSync(join(paths.workspaceDir, ".rally", "settings.json"), JSON.stringify({ mcpTiers: { mcp__fixture__echo: "reversible" } }));
		harness.setResponses([fauxAssistantMessage("已收到授权原话。")]);
		await supervisor.main.send("允许 fixture echo 执行 request-1，对象是 dist；保留 nested 数据。");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((line) => line.text === "已收到授权原话。")).toBe(true));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		const quoteId = supervisor.main.state().messages.findLast((line) => line.role === "user")!.id;
		const task = createTask(supervisor);
		const args = { message: "request-1", nested: { targets: ["dist"] }, approval: "server-owned field" };
		const input = { arguments: args, approval: { action: "执行 request-1", scope: ["dist"], alternative: "保留对象" } };
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main-1") {
				const gate = task.gates?.at(-1);
				if (gate && !gate.decision) {
					expect(existsSync(callsFile)).toBe(false);
					expect(JSON.stringify(context.messages)).toContain("gate_request");
					return fauxAssistantMessage(fauxToolCall("gate_decide", { gateId: gate.id, decision: "allow", quotes: [{ id: quoteId }], reason: "用户允许了此动作和对象" }), { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("已记录内门决定。");
			}
			const last = context.messages.findLast((message) => message.role === "toolResult");
			if (last?.role === "toolResult") {
				if (last.toolName === "task_report") return fauxAssistantMessage("Done.");
				expect(getMessageText(last)).toContain("MCP_FIXTURE_RESULT");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "Approved MCP call checked" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage(exposure === "direct" ? fauxToolCall("mcp__fixture__echo", input) : fauxToolCall("codemode", { code: `text(await tools.mcp__fixture__echo(${JSON.stringify(input)}));` }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(10).fill(route));
		supervisor.setAutoApprove(true); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"), { timeout: 18000 });
		await supervisor.workers.abort(task.id);
		expect(task.gates).toHaveLength(1);
		expect(task.gates![0].decision).toMatchObject({ value: "allow", actor: "main", basis: [quoteId] });
		expect(JSON.parse(readFileSync(`${callsFile}.args.json`, "utf8"))).toEqual(args);
		expect(readFileSync(callsFile, "utf8")).toBe("called\n");
		expect(readFileSync(paths.auditFile, "utf8")).toContain('"kind":"gate"');
	}, 25000);

	it("automatically escalates an unanswered gate and lets the user deny without calling MCP", async () => {
		const { supervisor, harness, callsFile } = await setupMcpRisk("irreversible");
		const task = createTask(supervisor);
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main-1") return fauxAssistantMessage("请确认 worker 的请求。");
			const last = context.messages.findLast((message) => message.role === "toolResult");
			if (last?.role === "toolResult") {
				if (last.toolName === "task_report") return fauxAssistantMessage("Done.");
				expect(getMessageText(last)).toContain("GATE_DENIED");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "用户拒绝，保留原文件" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { arguments: {}, approval: { action: "删除 dist", scope: ["dist"], alternative: "保留文件" } }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(8).fill(route)); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.gates?.[0].escalatedAt).toBeTypeOf("number"), { timeout: 10000 });
		expect(taskView(task).status).toBe("needs_gate");
		expect(existsSync(callsFile)).toBe(false);
		supervisor.gates.decide(task.gates![0].id, "deny", "user", [], "用户拒绝");
		await vi.waitFor(() => expect(task.runs[0].lastReport?.state).toBe("blocked"));
		expect(task.gates![0].decision?.actor).toBe("user");
		expect(existsSync(callsFile)).toBe(false);
	}, 15000);

	it("cancels a pending MCP gate and ignores late approval", async () => {
		const { supervisor, harness, callsFile, paths } = await setupMcpRisk("irreversible");
		harness.setResponses([fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { arguments: {}, approval: { action: "清理", scope: ["dist"], alternative: "保留" } }), { stopReason: "toolUse" })]);
		const task = createTask(supervisor); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.gates).toHaveLength(1), { timeout: 10000 });
		supervisor.cancel(task.id); await supervisor.workers.abort(task.id);
		expect(task.gates![0].decision?.value).toBe("deny");
		expect(() => supervisor.gates.decide(task.gates![0].id, "allow", "user", [], "late")).toThrow("已决定");
		expect(existsSync(callsFile)).toBe(false);
		expect(readFileSync(paths.auditFile, "utf8")).toContain('"kind":"cancel"');
	}, 15000);

	it.each([
		["hang-initialize", "cancel"], ["hang-call", "cancel"],
		["hang-initialize", "shutdown"], ["hang-call", "shutdown"],
	] as const)("releases a local MCP process on %s during %s", async (mode, action) => {
		const { supervisor, harness, paths } = await setup();
		const pidFile = join(harness.tempDir, "mcp.pid");
		const callsFile = join(harness.tempDir, "mcp-calls.txt");
		new McpStore(paths.agentDir).save(JSON.stringify({ mcpServers: { fixture: {
			command: process.execPath,
			args: [fileURLToPath(new URL("../fixtures/rally-mcp.cjs", import.meta.url)), pidFile, callsFile, mode],
		} } }));
		harness.setResponses([fauxAssistantMessage(fauxToolCall("mcp__fixture__echo", { arguments: {} }), { stopReason: "toolUse" })]);
		const task = createTask(supervisor);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(existsSync(callsFile)).toBe(true), { timeout: 15000 });
		const pid = Number(readFileSync(pidFile, "utf8"));
		expect(() => process.kill(pid, 0)).not.toThrow();
		if (action === "cancel") {
			await toolsFor(supervisor)("task_cancel", { taskId: task.id, quotes: [{ id: "#fixture" }] });
			await supervisor.workers.abort(task.id);
			expect(task.ended?.outcome).toBe("cancelled");
		} else {
			const closing = supervisor.dispose();
			expect(supervisor.dispose()).toBe(closing);
			await closing;
			expect(task.ended).toBeUndefined();
			// Shutdown leaves the run for recovery, without misreporting it as a task failure.
			expect(task.runs[0].endedAt).toBeUndefined();
		}
		// The close promise must cover transport cleanup, not just removal from the worker map.
		expect(() => process.kill(pid, 0)).toThrow();
		expect(supervisor.workers.has(task.id)).toBe(false);
		expect(harness.faux.state.callCount).toBe(mode === "hang-call" ? 1 : 0);
		expect(readFileSync(callsFile, "utf8")).toBe(mode === "hang-call" ? "called\n" : "initializing\n");
		if (mode === "hang-call") expect(supervisor.store.timeline(task.id)).toEqual([
			expect.objectContaining({ name: "mcp__fixture__echo", status: "interrupted", endedAt: expect.any(Number) }),
		]);
	}, 25000);

	it("waits for a worker still loading resources at shutdown and closes its late session", async () => {
		const { supervisor, harness } = await setup();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const reload = DefaultResourceLoader.prototype.reload;
		let loading = false;
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementationOnce(async function (this: DefaultResourceLoader) {
			await reload.call(this);
			loading = true;
			await gate;
		});
		const task = createTask(supervisor);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(loading).toBe(true));
		let finished = false;
		const closing = supervisor.dispose().then(() => { finished = true; });
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(finished).toBe(false);
		} finally {
			release();
		}
		await closing;
		expect(supervisor.workers.has(task.id)).toBe(false);
		expect(harness.faux.state.callCount).toBe(0);
		expect(task.runs[0].endedAt).toBeUndefined();
	});

	it("does not revive the main session when shutdown overlaps its resource loading", async () => {
		const { supervisor, harness, paths } = await setup();
		await supervisor.dispose();
		const restored = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
		supervisors.push(restored);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const reload = DefaultResourceLoader.prototype.reload;
		let loading = false;
		vi.spyOn(DefaultResourceLoader.prototype, "reload").mockImplementationOnce(async function (this: DefaultResourceLoader) {
			await reload.call(this);
			loading = true;
			await gate;
		});
		const starting = restored.start();
		await vi.waitFor(() => expect(loading).toBe(true));
		let finished = false;
		const closing = restored.dispose().then(() => { finished = true; });
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(finished).toBe(false);
		} finally {
			release();
		}
		await Promise.all([starting, closing]);
		const before = restored.main.state();
		await restored.main.send("Must not start a new model turn after shutdown");
		expect(restored.main.state()).toEqual(before);
		expect(before.model).toBeNull();
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("preserves main assistant text/thinking/tool order across a ten-call loop and restart", async () => {
		const { harness, paths, supervisor } = await setup();
		harness.setResponses([
			fauxAssistantMessage([fauxThinking("MAIN_THINK_FIRST"), fauxText("MAIN_BEFORE_FIRST_BATCH"),
				...Array.from({ length: 5 }, (_, index) => fauxToolCall("ls", {}, { id: `first-${index}` })), fauxText("MAIN_AFTER_FIRST_BATCH")], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("MAIN_BETWEEN_BATCHES"), fauxThinking("MAIN_THINK_SECOND"),
				...Array.from({ length: 5 }, (_, index) => fauxToolCall("ls", {}, { id: `second-${index}` }))], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxThinking("MAIN_THINK_FINAL"), fauxText("MAIN_FINAL")]),
		]);
		await supervisor.main.send("不要派发任务，连续调用十次工具");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((line) => line.text === "MAIN_FINAL" && !line.streaming)).toBe(true));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		const messages = supervisor.main.state().messages.filter((line) => line.role === "assistant");
		expect(messages).toHaveLength(3);
		expect(messages[0].blocks?.map((block) => block.type)).toEqual(["thinking", "text", ...Array(5).fill("tool"), "text"]);
		expect(messages[1].text).toBe("MAIN_BETWEEN_BATCHES");
		expect(messages[0].toolCalls?.map((call) => call.id)).toEqual(Array.from({ length: 5 }, (_, index) => `first-${index}`));
		expect(messages[1].toolCalls?.map((call) => call.status)).toEqual(Array(5).fill("ok"));
		expect(supervisor.store.list()).toHaveLength(0);
		await supervisor.dispose();
		const restored = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
		supervisors.push(restored);
		expect(restored.main.state().messages.filter((line) => line.role === "assistant")).toEqual(messages);
	});

	it("streams and persists worker intermediate messages and thinking without exposing them to task_read", async () => {
		const { harness, paths, supervisor } = await setup();
		const snapshots: AssistantMessageView[] = [];
		const record = supervisor.store.recordAssistant.bind(supervisor.store);
		vi.spyOn(supervisor.store, "recordAssistant").mockImplementation((id, message, persist) => {
			snapshots.push(structuredClone(message));
			record(id, message, persist);
		});
		harness.setResponses([
			fauxAssistantMessage([fauxThinking("WORKER_PRIVATE_THINK_FIRST"), fauxText("WORKER_BEFORE_READ"), fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("WORKER_AFTER_READ"), fauxThinking("WORKER_PRIVATE_THINK_SECOND"), fauxToolCall("task_report", { state: "ready", summary: "public report" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxThinking("WORKER_PRIVATE_THINK_FINAL"), fauxText("WORKER_FINAL")]),
		]);
		const task = createTask(supervisor);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome === "done" && !supervisor.workers.has(task.id)).toBe(true));
		const messages = supervisor.store.assistantMessages(task.id);
		expect(messages.map((message) => message.text)).toEqual(["WORKER_BEFORE_READ", "WORKER_AFTER_READ", "WORKER_FINAL"]);
		expect(messages[0].blocks.map((block) => block.type)).toEqual(["thinking", "text", "tool"]);
		expect(messages[1].blocks.map((block) => block.type)).toEqual(["text", "thinking", "tool"]);
		expect(messages[0].toolCalls?.[0]).toMatchObject({ name: "read", status: "ok" });
		expect(messages[1].toolCalls?.[0]).toMatchObject({ name: "task_report", status: "ok" });
		expect(messages.every((message) => !message.streaming)).toBe(true);
		expect(snapshots.some((message) => message.streaming && message.blocks.some((block) => block.type === "thinking" && block.text))).toBe(true);
		expect(snapshots.some((message) => message.streaming && message.text.includes("WORKER_BEFORE_READ"))).toBe(true);
		const call = toolsFor(supervisor);
		for (const view of ["board", "card", "report", "runs", "files", "timeline"]) {
			const output = getMessageText(await call("task_read", { taskId: task.id, view }));
			expect(output).not.toContain("WORKER_PRIVATE");
			expect(output).not.toContain("WORKER_BEFORE_READ");
		}
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.assistantMessages(task.id)).toEqual(messages);
		expect(supervisor.board().tasks[0].assistantMessages).toEqual(messages);
	});

	it("projects exposed thinking only and recovers interrupted assistant messages", async () => {
		const projected = assistantContent({ content: [
			{ type: "thinking", thinking: "VISIBLE_THINKING", thinkingSignature: "OPAQUE_SIGNATURE" },
			{ type: "thinking", redacted: true, thinking: "OPAQUE_DATA", thinkingSignature: "OPAQUE_SIGNATURE" },
			{ type: "text", text: "VISIBLE_TEXT" },
		] });
		expect(projected).toEqual({ text: "VISIBLE_TEXT", blocks: [{ type: "thinking", text: "VISIBLE_THINKING" }, { type: "text", text: "VISIBLE_TEXT" }] });
		const { paths, supervisor } = await setup();
		const task = createTask(supervisor);
		const run = supervisor.store.startRun(task.id, "dispatch", "fixture");
		supervisor.store.recordAssistant(task.id, { id: "partial", runId: run.id, at: Date.now(), streaming: true, text: "", blocks: [{ type: "thinking", text: "PARTIAL_THINKING" }] }, true);
		supervisor.store.endRunInterrupted(task.id, "interrupted");
		expect(supervisor.store.assistantMessages(task.id)[0].streaming).toBe(false);
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.assistantMessages(task.id)[0]).toMatchObject({ streaming: false, blocks: [{ type: "thinking", text: "PARTIAL_THINKING" }] });
	});

	it("persists independent worker choice and approval mode; invalidates deleted selections", async () => {
		const { paths, supervisor } = await setup();
		await supervisor.models.selectWorker({ provider: "rally-test", model: "worker-2" });
		supervisor.setAutoApprove(true);
		const restored = new ModelStore(paths.modelsFile);
		await restored.whenReady();
		expect((await restored.state()).worker?.model).toBe("worker-2");
		expect((await restored.state()).active?.model).toBe("main-1");
		const restart = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
		supervisors.push(restart);
		expect(restart.board().autoApprove).toBe(true);
		await supervisor.models.save([]);
		await supervisor.main.reapplyActiveModel();
		expect((await supervisor.models.state()).worker).toBeNull();
		expect(supervisor.main.state().model).toBeNull();
		expect(JSON.parse(readFileSync(paths.modelsFile, "utf8")).worker).toBeNull();
	});

	it("does not retroactively approve pending tasks; missing worker selection fails visibly", async () => {
		const { supervisor } = await setup(false);
		const pending = createTask(supervisor);
		supervisor.setAutoApprove(true);
		expect(pending.approval.state).toBe("pending");
		expect(pending.runs).toHaveLength(0);
		const auto = createTask(supervisor, { title: "自动批准" });
		await vi.waitFor(() => expect(auto.ended?.outcome).toBe("failed"));
		expect(auto.runs[0].lastReport?.summary).toContain("设置 → 供应商");
		expect(supervisor.main.state().messages.some((message) => message.text.includes(`${auto.id} · 自动批准 · 失败`))).toBe(true);
		expect(pending.runs).toHaveLength(0);
	});

	it("resumes with reapproval and the current worker model in the same JSONL", async () => {
		const { harness, supervisor, paths } = await setup();
		const task = createTask(supervisor);
		harness.setResponses([fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "FIRST_RUN_SENTINEL" }), { stopReason: "toolUse" }), fauxAssistantMessage("完成。")]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"));
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		const file = join(paths.sessionsTasksDir, `${task.id}.jsonl`);
		const firstSession = JSON.parse(readFileSync(file, "utf8").split("\n")[0]).id;
		await supervisor.models.selectWorker({ provider: "rally-test", model: "worker-2" });
		const call = toolsFor(supervisor);
		expect((await call("task_resume", { taskId: task.id, quotes: [{ id: "#fixture" }] })).isError).not.toBe(true);
		expect(task.approval.state).toBe("pending");
		expect(task.runs).toHaveLength(1);
		harness.setResponses([(context, _options, _state, model) => {
			expect(model.id).toBe("worker-2");
			expect(JSON.stringify(context.messages)).toContain("FIRST_RUN_SENTINEL");
			expect(lastUser(context)).toContain("逐字原话");
			return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "SECOND_RUN" }), { stopReason: "toolUse" });
		}, fauxAssistantMessage("续接完成。")]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(task.runs.map((run) => run.model)).toEqual(["rally-test/worker-1", "rally-test/worker-2"]);
		expect(JSON.parse(readFileSync(file, "utf8").split("\n")[0]).id).toBe(firstSession);
	});

	it("cancels during asynchronous startup and rejects a late report", async () => {
		const { supervisor, harness } = await setup();
		const runtime = await supervisor.models.whenReady();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		vi.spyOn(supervisor.models, "whenReady").mockImplementation(async () => { await gate; return runtime; });
		const task = createTask(supervisor);
		supervisor.approve(task.id);
		expect(task.runs).toHaveLength(1);
		supervisor.cancel(task.id);
		release();
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(task.ended?.outcome).toBe("cancelled");
		expect(() => supervisor.store.report(task.id, task.runs[0].id, "ready", "晚到")).toThrow("不能再汇报");
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("enforces readonly paths, records successful output, and rejects tools after ready", async () => {
		const { supervisor, harness, paths } = await setup();
		const task = createTask(supervisor);
		mkdirSync(task.outputDir, { recursive: true });
		const linked = join(task.outputDir, "escape");
		symlinkSync(paths.workspaceDir, linked, "junction");
		const output = join(task.outputDir, "report.md");
		const steps = [
			{ path: "README.md", content: "bad" },
			{ path: join(task.outputDir, "..", "escaped.md"), content: "bad" },
			{ path: join(linked, "README.md"), content: "bad" },
		];
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", steps[0]), { stopReason: "toolUse" }),
			...steps.slice(1).map((step) => (context: TranscriptContext) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("READONLY_TASK");
				return fauxAssistantMessage(fauxToolCall("write", step), { stopReason: "toolUse" });
			}),
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("READONLY_TASK");
				return fauxAssistantMessage(fauxToolCall("write", { path: output, content: "verified" }), { stopReason: "toolUse" });
			},
			() => {
				expect(task.changedFiles).toEqual([output]);
				return fauxAssistantMessage([fauxToolCall("task_report", { state: "ready", summary: "已写报告" }), fauxToolCall("write", { path: join(task.outputDir, "late.md"), content: "bad" })], { stopReason: "toolUse" });
			},
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("TASK_ENDED");
				return fauxAssistantMessage("完成。");
			},
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(task.ended?.outcome).toBe("done");
		expect(readFileSync(join(paths.workspaceDir, "README.md"), "utf8")).toContain("Fixture README");
		expect(readFileSync(output, "utf8")).toBe("verified");
		expect(existsSync(join(task.outputDir, "late.md"))).toBe(false);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("validates quote ids, note limits, updated cwd/scope and dependency cycles", async () => {
		const { supervisor, paths } = await setup();
		const call = toolsFor(supervisor);
		const base = { title: "valid", quotes: [{ id: "#fixture" }], mode: "readonly", cwd: paths.workspaceDir };
		for (const [patch, error] of [[{ quotes: [{ id: "#missing" }] }, "QUOTE_INVALID"], [{ note: "word ".repeat(31) }, "NOTE_TOO_LONG"], [{ cwd: join(paths.workspaceDir, "README.md") }, "CWD_NOT_FOUND"]] as const) {
			const response = await call("task_dispatch", { ...base, ...patch });
			expect(response.isError).toBe(true);
			expect(getMessageText(response)).toContain(error);
		}
		expect(supervisor.store.list()).toHaveLength(0);
		const a = createTask(supervisor);
		const b = createTask(supervisor, { dependsOn: [a.id] });
		expect(getMessageText(await call("task_update", { taskId: a.id, quotes: base.quotes, dependsOn: [b.id] }))).toContain("DEP_CYCLE");
		const nextCwd = join(paths.workspaceDir, "nested");
		mkdirSync(nextCwd);
		expect((await call("task_update", { taskId: a.id, quotes: base.quotes, cwd: nextCwd, scope: ["src"] })).isError).not.toBe(true);
		expect(a.scope).toEqual([join(nextCwd, "src")]);
	});

	it("changes only the main default workspace while keeping worker paths and main session cwd fixed", async () => {
		const { supervisor, paths, harness } = await setup();
		const project = join(harness.tempDir, "项目 A");
		const projectB = join(harness.tempDir, "项目 B");
		mkdirSync(project); mkdirSync(projectB);
		writeFileSync(join(project, "README.md"), "PROJECT_A");
		writeFileSync(join(projectB, "README.md"), "PROJECT_B");
		const outputWorkspace = join(harness.tempDir, "新的工作区");
		supervisor.workspace.update({ defaultWorkspace: outputWorkspace });
		const before = createTask(supervisor, { cwd: project });
		expect(before.outputDir.startsWith(outputWorkspace)).toBe(true);
		const savedOutput = before.outputDir;
		const laterWorkspace = join(harness.tempDir, "后续产出");
		supervisor.workspace.update({ defaultWorkspace: laterWorkspace });
		expect(createTask(supervisor, { cwd: projectB }).outputDir.startsWith(laterWorkspace)).toBe(true);
		const responses: string[] = [];
		for (const [directory, sentinel] of [[project, "PROJECT_A"], [projectB, "PROJECT_B"]]) {
			supervisor.workspace.update({ defaultWorkspace: directory });
			harness.setResponses([
				(context) => {
					expect(context.messages.some((message) => getMessageText(message).includes(JSON.stringify(directory)))).toBe(true);
					expect(getCurrentSystemPrompt(context.messages)).not.toContain("RALLY_PROJECT_INSTRUCTIONS_SENTINEL");
					return fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }), { stopReason: "toolUse" });
				},
				(context) => {
					const text = getMessageText(context.messages.findLast((message) => message.role === "toolResult"));
					expect(text).toContain(sentinel); responses.push(sentinel);
					return fauxAssistantMessage(sentinel);
				},
			]);
			await supervisor.main.send("读取主对话工作区 README");
			await vi.waitFor(() => expect(responses, JSON.stringify(supervisor.main.state())).toContain(sentinel));
			await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		}
		expect(before.cwd).toBe(project);
		expect(before.outputDir).toBe(savedOutput);
		const restored = new WorkspaceStore(paths.home, paths.workspaceDir);
		expect(restored.state()).toEqual(supervisor.workspace.state());
		expect(restored.state().recentProjects).toEqual([]);
		expect(restored.state()).not.toHaveProperty("currentProject");
		expect(existsSync(join(outputWorkspace, "notes"))).toBe(true);
		const sessionFile = readdirSync(paths.sessionsMainDir).find((name) => name.endsWith(".jsonl"));
		expect(sessionFile).toBeDefined();
		expect(JSON.parse(readFileSync(join(paths.sessionsMainDir, sessionFile!), "utf8").split("\n")[0]).cwd).toBe(paths.mainCwd);
	});

	it("executes main git_inspect in the current workspace, rejects writes and restores tool history", async () => {
		const { supervisor, paths, harness } = await setup();
		for (const name of ["projectA", "projectB"]) {
			const cwd = join(harness.tempDir, name); mkdirSync(cwd);
			execFileSync("git", ["init", cwd], { windowsHide: true, stdio: "ignore" });
			writeFileSync(join(cwd, `${name}.txt`), name);
			supervisor.workspace.update({ defaultWorkspace: cwd });
			harness.setResponses([
				(context) => {
					expect(toolNames(context)).toContain("git_inspect"); expect(toolNames(context)).not.toContain("git");
					return fauxAssistantMessage(fauxToolCall("git_inspect", { command: "status", args: ["--short"] }), { stopReason: "toolUse" });
				},
				(context) => {
					expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain(`${name}.txt`);
					return fauxAssistantMessage(fauxToolCall("git_inspect", { command: "diff", args: ["--output=should-not-exist"] }), { stopReason: "toolUse" });
				},
				(context) => {
					expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("READONLY_VIOLATION");
					return fauxAssistantMessage(`inspected ${name}`);
				},
			]);
			await supervisor.main.send(`查询 ${name} Git 状态`);
			await vi.waitFor(() => expect(supervisor.main.state().messages.some((line) => line.text === `inspected ${name}`)).toBe(true));
			await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
			expect(existsSync(join(cwd, "should-not-exist"))).toBe(false);
		}
		const calls = supervisor.main.state().messages.flatMap((line) => line.toolCalls ?? []).filter((call) => call.name === "git_inspect");
		expect(calls.map((call) => call.status)).toEqual(["ok", "error", "ok", "error"]);
		await supervisor.dispose();
		const restored = await restart(paths, harness);
		expect(restored.main.state().messages.flatMap((line) => line.toolCalls ?? []).filter((call) => call.name === "git_inspect")).toEqual(calls);
	});

	it("requires explicit worker cwd and keeps recent projects as read-only history", async () => {
		const { supervisor, paths, harness } = await setup();
		const call = toolsFor(supervisor);
		for (const cwd of [undefined, "relative/path"]) {
			const response = await call("task_dispatch", { title: "明确目录", quotes: [{ id: "#fixture" }], mode: "readonly", cwd });
			expect(getMessageText(response)).toContain("CWD_REQUIRED");
		}
		const before = supervisor.workspace.state();
		expect(() => supervisor.workspace.update({ defaultWorkspace: "relative" })).toThrow();
		expect(() => supervisor.workspace.update({ defaultWorkspace: join(paths.workspaceDir, "README.md") })).toThrow();
		expect(supervisor.workspace.state()).toEqual(before);
		supervisor.workspace.recordProject(harness.tempDir);
		expect(supervisor.workspace.state().recentProjects).toEqual([harness.tempDir]);
		expect(supervisor.workspace.base()).toBe(before.defaultWorkspace);
		const read = createRouterReadTools(() => supervisor.workspace.base()).find((tool) => tool.name === "read");
		expect(read).toBeDefined();
		const result = await read!.execute("test", { path: "README.md" }, undefined, undefined, {} as ExtensionToolContext);
		expect(getMessageText(result)).toContain("Fixture README");
		for (const [name, input] of [["ls", {}], ["find", { pattern: "README.md" }], ["grep", { pattern: "Fixture" }]] as const) {
			const tool = createRouterReadTools(() => supervisor.workspace.base()).find((item) => item.name === name)!;
			const output = await tool.execute("test", input, undefined, undefined, { cwd: paths.mainCwd } as ExtensionToolContext);
			expect(getMessageText(output)).toContain("README.md");
		}
	});

	it("ignores legacy current project selection and rejects attempts to select recent projects", async () => {
		const { supervisor, paths, harness } = await setup();
		writeFileSync(join(paths.home, "workspace.json"), JSON.stringify({ version: 1, defaultWorkspace: paths.workspaceDir, currentProject: harness.tempDir, recentProjects: [harness.tempDir] }));
		const restored = new WorkspaceStore(paths.home, paths.workspaceDir);
		expect(restored.base()).toBe(paths.workspaceDir);
		expect(restored.state()).not.toHaveProperty("currentProject");
		expect(restored.state().recentProjects).toEqual([harness.tempDir]);
		expect(() => restored.update({ defaultWorkspace: paths.workspaceDir, ...{ currentProject: harness.tempDir } })).toThrow("只可设置");
		expect(supervisor.workspace.base()).toBe(paths.workspaceDir);
	});

	it("deduplicates dispatch by sorted quote ids and title for 60 seconds, including after restart", async () => {
		const { supervisor, paths } = await setup();
		const call = toolsFor(supervisor);
		const input = { title: "幂等派发", quotes: [{ id: "#fixture" }, { id: "#fixture2" }], cwd: paths.workspaceDir, mode: "readonly" };
		const first = JSON.parse(getMessageText(await call("task_dispatch", input)));
		const duplicate = JSON.parse(getMessageText(await call("task_dispatch", { ...input, quotes: [...input.quotes].reverse() })));
		expect(duplicate).toMatchObject({ taskId: first.taskId, reused: true });
		expect(supervisor.store.list()).toHaveLength(1);
		const restart = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
		supervisors.push(restart);
		expect(JSON.parse(getMessageText(await toolsFor(restart)("task_dispatch", input))).taskId).toBe(first.taskId);
		const createdAt = supervisor.store.get(first.taskId)!.createdAt;
		vi.spyOn(Date, "now").mockReturnValue(createdAt + 60000);
		const next = JSON.parse(getMessageText(await call("task_dispatch", input)));
		expect(next.taskId).not.toBe(first.taskId);
		expect(supervisor.store.list()).toHaveLength(2);
	});

	it("pages the task board, runs and tool timeline without leaking worker conversations", async () => {
		const { supervisor } = await setup();
		const call = toolsFor(supervisor);
		for (let i = 0; i < 25; i++) supervisor.store.cancel(createTask(supervisor).id, "main");
		const task = createTask(supervisor);
		createTask(supervisor); createTask(supervisor);
		const board = JSON.parse(getMessageText(await call("task_read", {})));
		expect(board).toMatchObject({ offset: 0, total: 23, nextOffset: 20 });
		expect(board.tasks).toHaveLength(20);
		expect(board.tasks.filter((item: { ended?: unknown }) => !item.ended)).toHaveLength(3);
		expect(JSON.parse(getMessageText(await call("task_read", { view: "board", offset: 20 }))).tasks).toHaveLength(3);
		const first = supervisor.store.startRun(task.id, "dispatch", "fixture");
		supervisor.store.report(task.id, first.id, "ready", "first report");
		supervisor.store.resume(task.id, {});
		const second = supervisor.store.startRun(task.id, "resume", "fixture");
		expect(JSON.parse(getMessageText(await call("task_read", { taskId: task.id, view: "report" }))).report.summary).toBe("first report");
		supervisor.store.report(task.id, second.id, "progress", "latest report");
		for (let i = 0; i < 30; i++) supervisor.store.recordTool(task.id, { id: `call-${i}`, runId: second.id, name: "read", input: `file-${i}`, status: "ok", startedAt: i, endedAt: i + 1, output: "PRIVATE_OUTPUT_NOT_IN_MODEL_TIMELINE" });
		const timeline = JSON.parse(getMessageText(await call("task_read", { taskId: task.id, view: "timeline" })));
		expect(timeline).toMatchObject({ total: 30, nextOffset: 20 });
		expect(timeline.timeline[0].id).toBe("call-29");
		expect(JSON.stringify(timeline)).not.toContain("PRIVATE_OUTPUT");
		const rest = JSON.parse(getMessageText(await call("task_read", { taskId: task.id, view: "timeline", offset: 20 })));
		expect(rest.timeline).toHaveLength(10); expect(rest.nextOffset).toBeNull();
		expect(JSON.parse(getMessageText(await call("task_read", { taskId: task.id, view: "runs", limit: 1 }))).runs[0].id).toBe(second.id);
		expect(JSON.parse(getMessageText(await call("task_read", { taskId: task.id, view: "report" }))).report.summary).toBe("latest report");
		expect(JSON.parse(getMessageText(await call("task_read", { taskId: task.id }))).card.id).toBe(task.id);
		expect(JSON.parse(getMessageText(await call("task_read", { taskId: task.id, view: "files" }))).coverage.shell).toBe("unknown");
		for (const input of [{ offset: -1 }, { limit: 0 }, { offset: 0.5 }, { limit: 101 }]) expect((await call("task_read", input)).isError).toBe(true);
	});

	it("persists successful file access, failed shell attempts and final worker usage with paged reads", async () => {
		const { supervisor, harness, paths } = await setup();
		const task = createTask(supervisor);
		mkdirSync(task.outputDir, { recursive: true });
		const output = join(task.outputDir, "observed.md");
		const calls = [
			fauxToolCall("read", { path: "@README.md" }),
			fauxToolCall("ls", {}),
			fauxToolCall("grep", { pattern: "Fixture", path: "README.md" }),
			fauxToolCall("find", { pattern: "README.md" }),
			fauxToolCall("read", { path: "missing.md" }),
			fauxToolCall("write", { path: output, content: "before" }),
			fauxToolCall("edit", { path: output, edits: [{ oldText: "before", newText: "after" }] }),
			fauxToolCall("edit", { path: output, edits: [{ oldText: "missing text", newText: "bad" }] }),
			fauxToolCall("powershell", { command: "Write-Output 'observed shell'; exit 3" }),
		];
		harness.setResponses([
			...calls.map((call) => fauxAssistantMessage(call, { stopReason: "toolUse" })),
			fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "observed" }), { stopReason: "toolUse" }),
			(context) => {
				expect(JSON.parse(getMessageText(context.messages.findLast((message) => message.role === "toolResult")))).toMatchObject({ recorded: true, taskEnded: true, notifiedMain: true });
				return fauxAssistantMessage("Final sentence after terminal report.");
			},
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"), { timeout: 10000 });
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false), { timeout: 10000 });
		const access = supervisor.store.access(task.id);
		expect(access.map((entry) => [entry.tool, entry.kind, entry.target, entry.created])).toEqual([
			["read", "fs_read", join(task.cwd, "README.md"), undefined],
			["ls", "fs_read", task.cwd, undefined],
			["grep", "fs_read", join(task.cwd, "README.md"), undefined],
			["find", "fs_read", task.cwd, undefined],
			["write", "fs_write", output, true],
			["edit", "fs_write", output, false],
			["powershell", "shell", task.cwd, undefined],
		]);
		expect(supervisor.store.timeline(task.id).find((entry) => entry.name === "powershell")?.status).toBe("error");
		expect(task.changedFiles).toEqual([output]);
		expect(readFileSync(output, "utf8")).toBe("after");
		expect(task.usage.toolCalls).toBe(10);
		expect(task.usage.inputTokens).toBeGreaterThan(0);
		expect(task.usage.inputTokens).toBe((task.usage.cacheReadTokens ?? 0) + (task.usage.cacheWriteTokens ?? 0));
		expect(task.usage.costUsd).toBeUndefined();
		expect(task.usage.costIncomplete).toBe(true);
		const lastUsage = supervisor.events.ofKind("usage_updated").at(-1)!;
		expect(lastUsage.seq).toBeGreaterThan(supervisor.events.ofKind("task_ended").at(-1)!.seq);
		const call = toolsFor(supervisor);
		const files = JSON.parse(getMessageText(await call("task_read", { taskId: task.id, view: "files", offset: 2, limit: 2 })));
		expect(files).toMatchObject({ accesses: access.slice(2, 4), total: 7, offset: 2, nextOffset: 4, changedFiles: [output], coverage: { shell: "unknown", network: "git fetch/pull/push resolved remote hosts only; attempts, not confirmed traffic" } });
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.access(task.id)).toEqual(access);
		expect(restored.get(task.id)?.usage).toEqual(task.usage);
		expect(restored.view(restored.get(task.id)!).durationMs).toBe(supervisor.store.view(task).durationMs);
	});

	it.each(["write", "edit"] as const)("returns STALE_FILE to the worker for %s and allows adaptation after reread", async (name) => {
		const { supervisor, harness, paths } = await setup();
		const task = createTask(supervisor, { mode: "write" });
		const target = join(paths.workspaceDir, "README.md");
		const change = () => fauxAssistantMessage(fauxToolCall(name, name === "write"
			? { path: "README.md", content: "adapted" }
			: { path: "README.md", edits: [{ oldText: "outside", newText: "adapted" }] }), { stopReason: "toolUse" });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: "README.md", limit: 1 }), { stopReason: "toolUse" }),
			() => { writeFileSync(target, "outside"); return change(); },
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("STALE_FILE");
				expect(readFileSync(target, "utf8")).toBe("outside");
				expect(task.changedFiles ?? []).toEqual([]);
				return fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }), { stopReason: "toolUse" });
			},
			change(),
			fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "重读后调整" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("完成。"),
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(readFileSync(target, "utf8")).toBe("adapted");
		expect(task.changedFiles).toEqual([target]);
		expect(supervisor.store.timeline(task.id).filter((entry) => entry.name === name).map((entry) => entry.status)).toEqual(["error", "ok"]);
		expect(supervisor.store.access(task.id).filter((entry) => entry.kind === "fs_write")).toHaveLength(1);
	});

	it("keeps read versions across supervisor restart and task resume", async () => {
		const { supervisor, harness, paths } = await setup();
		const task = createTask(supervisor, { mode: "write" });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }), { stopReason: "toolUse" }),
			fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已读取" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("完成。"),
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		await supervisor.dispose();
		const target = join(paths.workspaceDir, "README.md"); writeFileSync(target, "outside between runs");
		const restored = await restart(paths, harness);
		expect((await toolsFor(restored)("task_resume", { taskId: task.id, quotes: [{ id: "#fixture" }] })).isError).not.toBe(true);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("write", { path: "README.md", content: "lost" }), { stopReason: "toolUse" }),
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("STALE_FILE");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "保留外部修改" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("完成。"),
		]);
		restored.approve(task.id);
		await vi.waitFor(() => expect(restored.store.get(task.id)?.ended?.outcome).toBe("done"));
		await vi.waitFor(() => expect(restored.workers.has(task.id)).toBe(false));
		expect(readFileSync(target, "utf8")).toBe("outside between runs");
		expect(restored.store.get(task.id)?.runs).toHaveLength(2);
		expect(restored.store.get(task.id)?.changedFiles ?? []).toEqual([]);
	});

	it.each(["readonly", "write"] as const)("executes file_delete for %s task-created files and rejects terminal calls", async (mode) => {
		const { supervisor, harness, paths } = await setup();
		const task = createTask(supervisor, { mode });
		const target = join(mode === "readonly" ? task.outputDir : paths.workspaceDir, "created.txt");
		harness.setResponses([
			(context) => {
				expect(toolNames(context)).toContain("file_delete");
				return fauxAssistantMessage(fauxToolCall("write", { path: target, content: "new" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage(fauxToolCall("file_delete", { paths: [target] }), { stopReason: "toolUse" }),
			(context) => {
				expect(JSON.parse(getMessageText(context.messages.findLast((message) => message.role === "toolResult")))).toMatchObject({ matched: 1, totalBytes: 3 });
				expect(existsSync(target)).toBe(true);
				return fauxAssistantMessage(fauxToolCall("file_delete", { paths: [target], dryRun: false }), { stopReason: "toolUse" });
			},
			(context) => {
				expect(JSON.parse(getMessageText(context.messages.findLast((message) => message.role === "toolResult")))).toEqual({ deleted: 1, failed: [] });
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "产出清理完成" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage(fauxToolCall("file_delete", { paths: [join(paths.workspaceDir, "README.md")], dryRun: false }), { stopReason: "toolUse" }),
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("TASK_ENDED");
				return fauxAssistantMessage("完成。");
			},
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"));
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(task.gates).toBeUndefined(); expect(existsSync(target)).toBe(false);
		expect(existsSync(join(paths.workspaceDir, "README.md"))).toBe(true);
		expect(supervisor.store.access(task.id).map((entry) => entry.kind)).toEqual(["fs_write", "fs_delete"]);
	});

	it("routes file_delete through the real main-agent gate and records quoted authorization", async () => {
		const { supervisor, harness, paths } = await setup();
		harness.setResponses([(context) => {
			expect(toolNames(context)).not.toContain("file_delete");
			return fauxAssistantMessage("已收到清理原话。");
		}]);
		await supervisor.main.send("允许删除 README.md 和 obsolete.txt 这两个文件。");
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		const quoteId = supervisor.main.state().messages.findLast((line) => line.role === "user")!.id;
		const first = join(paths.workspaceDir, "README.md"); const second = join(paths.workspaceDir, "obsolete.txt"); writeFileSync(second, "old");
		const task = createTask(supervisor, { mode: "write" });
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main-1") {
				const gate = task.gates?.find((item) => !item.decision);
				if (gate) {
					expect(existsSync(first) && existsSync(second)).toBe(true);
					expect(gate.scope).toEqual(expect.arrayContaining([first, second]));
					expect(gate.arguments).toMatchObject({ dryRun: false, matched: 2, uncommitted: [] });
					return fauxAssistantMessage(fauxToolCall("gate_decide", { gateId: gate.id, decision: "allow", quotes: [{ id: quoteId }], reason: "原话明确覆盖这两个文件" }), { stopReason: "toolUse" });
				}
				return fauxAssistantMessage("已确认清理范围。");
			}
			const last = context.messages.findLast((message) => message.role === "toolResult");
			if (last?.role === "toolResult") {
				if (last.toolName === "task_report") return fauxAssistantMessage("完成。");
				expect(JSON.parse(getMessageText(last))).toEqual({ deleted: 2, failed: [] });
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "两个文件已按批准清理" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage(fauxToolCall("file_delete", { paths: ["README.md", "obsolete.txt"], dryRun: false }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"), { timeout: 12000 });
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(task.gates![0].decision).toMatchObject({ value: "allow", actor: "main", basis: [quoteId] });
		expect(existsSync(first) || existsSync(second)).toBe(false);
		expect(supervisor.store.access(task.id).filter((entry) => entry.kind === "fs_delete")).toHaveLength(2);
		expect(readFileSync(paths.auditFile, "utf8")).toContain('"tool":"file_delete"');
	}, 20000);

	it("cancels file_delete at its approval gate without removing the file", async () => {
		const { supervisor, harness, paths } = await setup();
		const task = createTask(supervisor, { mode: "write" });
		harness.setResponses([fauxAssistantMessage(fauxToolCall("file_delete", { paths: ["README.md"], dryRun: false }), { stopReason: "toolUse" })]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.gates).toHaveLength(1));
		supervisor.cancel(task.id);
		await supervisor.workers.abort(task.id);
		expect(task.gates![0].decision?.value).toBe("deny");
		expect(task.ended?.outcome).toBe("cancelled");
		expect(existsSync(join(paths.workspaceDir, "README.md"))).toBe(true);
		expect(supervisor.store.access(task.id)).toEqual([]);
		expect(supervisor.store.timeline(task.id).find((entry) => entry.name === "file_delete")?.status).toBe("interrupted");
	});

	it("runs worker Git add/status, records command scope and refuses project mutations in readonly mode", async () => {
		const { supervisor, harness, paths } = await setup();
		execFileSync("git", ["init", paths.workspaceDir], { windowsHide: true, stdio: "ignore" });
		const task = createTask(supervisor, { mode: "write" });
		harness.setResponses([
			(context) => {
				expect(toolNames(context)).toContain("git"); expect(toolNames(context)).not.toContain("git_inspect");
				expect(getCurrentSystemPrompt(context.messages)).toContain("Commit and push only");
				return fauxAssistantMessage(fauxToolCall("git", { args: ["add", "--", "README.md"] }), { stopReason: "toolUse" });
			},
			(context) => {
				expect(JSON.parse(getMessageText(context.messages.findLast((message) => message.role === "toolResult")))).toMatchObject({ exitCode: 0 });
				return fauxAssistantMessage(fauxToolCall("git", { args: ["status", "--short"] }), { stopReason: "toolUse" });
			},
			(context) => {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain("A  README.md");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已暂存并查询" }), { stopReason: "toolUse" });
			},
			fauxAssistantMessage("完成。"),
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"), { timeout: 15000 });
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(supervisor.store.access(task.id)).toEqual(expect.arrayContaining([expect.objectContaining({ tool: "git", kind: "fs_write", coverage: "command_scope" }), expect.objectContaining({ tool: "git", kind: "fs_read" })]));
		expect(task.changedFiles ?? []).toEqual([]);
		const readonly = createTask(supervisor, { title: "只读 Git" });
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main-1") return fauxAssistantMessage("已收到汇报。");
			const last = context.messages.findLast((message) => message.role === "toolResult");
			if (last?.role === "toolResult") {
				if (last.toolName === "task_report") return fauxAssistantMessage("已受阻。");
				expect(getMessageText(last)).toContain("READONLY_TASK");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "只读任务不能暂存项目" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage(fauxToolCall("git", { args: ["add", "--", "AGENTS.md"] }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(8).fill(route)); supervisor.approve(readonly.id);
		await vi.waitFor(() => expect(supervisor.store.view(readonly).status).toBe("blocked"), { timeout: 10000 });
		expect(supervisor.store.access(readonly.id)).toEqual([]);
	}, 30000);

	it("hangs worker Git at its gate and cancels without executing the destructive command", async () => {
		const { supervisor, harness, paths } = await setup();
		execFileSync("git", ["init", paths.workspaceDir], { windowsHide: true, stdio: "ignore" });
		const task = createTask(supervisor, { mode: "write" });
		harness.setResponses([fauxAssistantMessage(fauxToolCall("git", { args: ["checkout", "."] }), { stopReason: "toolUse" })]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.gates).toHaveLength(1), { timeout: 10000 });
		expect(task.gates![0]).toMatchObject({ tool: "git", cwd: paths.workspaceDir, arguments: { args: ["checkout", "."], riskTier: "irreversible" } });
		supervisor.cancel(task.id); await supervisor.workers.abort(task.id);
		expect(task.gates![0].decision?.value).toBe("deny"); expect(task.ended?.outcome).toBe("cancelled");
		expect(readFileSync(join(paths.workspaceDir, "README.md"), "utf8")).toContain("Fixture README");
		expect(supervisor.store.access(task.id)).toEqual([]);
		expect(supervisor.store.timeline(task.id).find((entry) => entry.name === "git")?.status).toBe("interrupted");
	}, 15000);

	it("routes a Git gate through main original-word approval and preserves its real failing exit code", async () => {
		const { supervisor, harness, paths } = await setup();
		execFileSync("git", ["init", paths.workspaceDir], { windowsHide: true, stdio: "ignore" });
		harness.setResponses([fauxAssistantMessage("已收到测试原话。")]);
		await supervisor.main.send("允许在测试仓库对不存在的 __rally_missing__ 路径执行 git restore --worktree；应返回路径不存在错误，不改任何文件。");
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		const quoteId = supervisor.main.state().messages.findLast((line) => line.role === "user")!.id;
		const task = createTask(supervisor, { mode: "write" });
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main-1") {
				const gate = task.gates?.find((item) => !item.decision);
				if (gate) return fauxAssistantMessage(fauxToolCall("gate_decide", { gateId: gate.id, decision: "allow", quotes: [{ id: quoteId }], reason: "原话覆盖测试命令和不存在的路径" }), { stopReason: "toolUse" });
				return fauxAssistantMessage("已按原话核对。");
			}
			const last = context.messages.findLast((message) => message.role === "toolResult");
			if (last?.role === "toolResult") {
				if (last.toolName === "task_report") return fauxAssistantMessage("验证结束。");
				expect(JSON.parse(getMessageText(last)).exitCode).not.toBe(0);
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已确认错误退出码，未改文件" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage(fauxToolCall("git", { args: ["restore", "--worktree", "--", "__rally_missing__"] }), { stopReason: "toolUse" });
		};
		harness.setResponses(Array(10).fill(route)); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome, task.runs.at(-1)?.lastReport?.summary).toBe("done"), { timeout: 15000 });
		expect(task.gates![0].decision).toMatchObject({ value: "allow", actor: "main", basis: [quoteId] });
		expect(supervisor.store.timeline(task.id).find((entry) => entry.name === "git")?.status).toBe("error");
		expect(readFileSync(join(paths.workspaceDir, "README.md"), "utf8")).toContain("Fixture README");
		expect(task.changedFiles ?? []).toEqual([]);
	}, 20000);

	it("restores late usage deltas, partial cost and elapsed time across resumed runs", async () => {
		const { supervisor, paths } = await setup();
		const task = createTask(supervisor);
		const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
		const first = supervisor.store.startRun(task.id, "dispatch", "fixture");
		clock.mockReturnValue(2000);
		supervisor.store.report(task.id, first.id, "ready", "done");
		supervisor.store.recordUsage(task.id, { inputTokens: 10, outputTokens: 2, toolCalls: 1, costUsd: 0.1 });
		supervisor.store.resume(task.id, {});
		clock.mockReturnValue(4000);
		const second = supervisor.store.startRun(task.id, "resume", "fixture");
		clock.mockReturnValue(6000);
		supervisor.store.report(task.id, second.id, "ready", "done again");
		supervisor.store.recordUsage(task.id, { inputTokens: 20, outputTokens: 3, toolCalls: 2, costUsd: 0.2 });
		supervisor.store.recordUsage(task.id, { inputTokens: 1, outputTokens: 1, toolCalls: 0, costIncomplete: true });
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.get(task.id)?.usage).toMatchObject({ inputTokens: 31, outputTokens: 6, toolCalls: 3, costIncomplete: true });
		expect(restored.get(task.id)?.usage.costUsd).toBeCloseTo(0.3);
		expect(taskView(restored.get(task.id)!).durationMs).toBe(3000);
		const card = JSON.parse(getMessageText(await toolsFor(supervisor)("task_read", { taskId: task.id })));
		expect(card.card).toMatchObject({ durationMs: 3000, usage: { inputTokens: 31, costIncomplete: true } });
	});

	it("rebuilds changed files when interrupted between access evidence and the next task snapshot", async () => {
		const { supervisor, paths } = await setup();
		const task = createTask(supervisor);
		const run = supervisor.store.startRun(task.id, "dispatch", "fixture");
		const target = join(task.outputDir, "recorded.md");
		supervisor.events.append("access_recorded", { taskId: task.id, access: { toolCallId: "observed", runId: run.id, tool: "write", at: Date.now(), kind: "fs_write", target, created: true } });
		expect(task.changedFiles).toBeUndefined();
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.get(task.id)?.changedFiles).toEqual([target]);
		expect(restored.access(task.id)).toHaveLength(1);
	});

	it("returns actual approval, queue and cancellation facts and supports explicit question clearing", async () => {
		const { supervisor } = await setup();
		const call = toolsFor(supervisor);
		const upstream = createTask(supervisor);
		const input = { title: "dependent", cwd: supervisor.paths.workspaceDir, mode: "readonly", dependsOn: [upstream.id], quotes: [{ id: "#fixture" }] };
		const dispatched = JSON.parse(getMessageText(await call("task_dispatch", input)));
		expect(dispatched).toMatchObject({ status: "pending_approval", approval: "pending" });
		const approved = JSON.parse(getMessageText(await call("task_approve", { taskId: dispatched.taskId, quotes: input.quotes })));
		expect(approved).toMatchObject({ status: "queued", approval: "approved" });
		expect(JSON.parse(getMessageText(await call("task_dispatch", input)))).toMatchObject({ reused: true, queuedReason: "dependency" });
		expect(JSON.parse(getMessageText(await call("task_cancel", { taskId: upstream.id, quotes: input.quotes })))).toMatchObject({ outcome: "cancelled", affected: [{ taskId: dispatched.taskId, status: "dependency_failed" }], coverage: { jobs: "not_implemented" } });
		const task = createTask(supervisor);
		const run = supervisor.store.startRun(task.id, "dispatch", "fixture");
		const report = (question?: string | null) => supervisor.store.report(task.id, run.id, "progress", "progress", question);
		report("pending question");
		const questionId = task.attention?.id;
		report();
		expect(task.attention?.id).toBe(questionId);
		report(null);
		expect(task.attention).toBeUndefined();
		report("next question");
		supervisor.store.report(task.id, run.id, "ready", "done");
		expect(task.attention).toBeUndefined();
		expect(getMessageText(await call("task_cancel", { taskId: task.id, quotes: input.quotes }))).toContain("TASK_ENDED");
	});

	it("reports first-message delivery through the production main task tool", async () => {
		const { supervisor, harness } = await setup();
		const task = createTask(supervisor);
		harness.setResponses([
			() => fauxAssistantMessage(fauxToolCall("task_steer", { taskId: task.id, quotes: [{ id: supervisor.main.state().messages.findLast((message) => message.role === "user")!.id }] }), { stopReason: "toolUse" }),
			(context) => {
				expect(JSON.parse(getMessageText(context.messages.findLast((message) => message.role === "toolResult")))).toMatchObject({ delivery: "queued_with_first_message" });
				return fauxAssistantMessage("queued");
			},
		]);
		await supervisor.main.send("additional original instruction");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((message) => message.text === "queued")).toBe(true));
		expect(task.inputs.at(-1)?.quotes?.[0].text).toBe("additional original instruction");
		expect(task.runs).toHaveLength(0);
	});

	it("limits worker task views to self and direct upstream tasks", async () => {
		const { supervisor } = await setup();
		const upstream = createTask(supervisor);
		const own = createTask(supervisor, { dependsOn: [upstream.id] });
		const hidden = createTask(supervisor);
		const tool = createWorkerTools({ store: supervisor.store, taskId: own.id, dependsOn: own.dependsOn, report: () => ({ taskId: own.id, ended: false, notifiedMain: false }) }).find((item) => item.name === "task_read")!;
		const read = (input: unknown) => tool.execute("test", input, undefined, undefined, {} as ExtensionToolContext);
		expect(JSON.parse(getMessageText(await read({}))).card.id).toBe(own.id);
		expect(JSON.parse(getMessageText(await read({ taskId: upstream.id, view: "runs" }))).runs).toEqual([]);
		expect(getMessageText(await read({ taskId: hidden.id }))).toContain("NOT_VISIBLE");
		expect(getMessageText(await read({ view: "board" }))).toContain("NOT_VISIBLE");
	});

	it("warns on scope overlap after update, resume and queued startup without locking", async () => {
		const { supervisor, harness } = await setup();
		const first = createTask(supervisor, { mode: "write", scope: [join(supervisor.paths.workspaceDir, "src")] });
		supervisor.store.startRun(first.id, "dispatch", "fixture");
		const second = createTask(supervisor, { mode: "write" });
		const call = toolsFor(supervisor);
		const updated = JSON.parse(getMessageText(await call("task_update", { taskId: second.id, quotes: [{ id: "#fixture" }], scope: ["src/components"] })));
		expect(updated.warnings[0].withTaskId).toBe(first.id);
		supervisor.store.cancel(second.id, "main");
		const resumed = JSON.parse(getMessageText(await call("task_resume", { taskId: second.id, quotes: [{ id: "#fixture" }] })));
		expect(resumed.warnings[0].withTaskId).toBe(first.id);
		harness.setResponses([fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "done" }), { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
		supervisor.approve(second.id);
		await vi.waitFor(() => expect(second.ended?.outcome).toBe("done"));
		expect(supervisor.events.ofKind("task_scope_overlap").filter((event) => event.data.taskId === second.id).map((event) => event.data.phase)).toEqual(expect.arrayContaining(["update", "resume", "start"]));
	});

	it("persists bounded tool activity and marks unfinished calls interrupted after recovery", async () => {
		const { supervisor, paths } = await setup();
		const task = createTask(supervisor);
		const run = supervisor.store.startRun(task.id, "dispatch", "fixture");
		supervisor.store.recordTool(task.id, { id: "inflight", runId: run.id, name: "read", status: "running", input: toolInput({ path: "x".repeat(3000) }), startedAt: Date.now() });
		expect(toolOutput({ content: [{ type: "text", text: "x".repeat(20000) }, { type: "image", data: "IMAGE_NOT_SAVED" }] }).length).toBeLessThan(8100);
		expect(supervisor.store.timeline(task.id)[0].input.length).toBeLessThan(1100);
		supervisor.store.endRunInterrupted(task.id, "interrupted");
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.timeline(task.id)[0].status).toBe("interrupted");
		supervisor.store.resume(task.id, {});
		supervisor.store.startRun(task.id, "resume", "fixture");
		expect(supervisor.store.timeline(task.id)[0].status).toBe("interrupted");
	});

	it("surfaces a model error, clears busy and allows a later reply", async () => {
		const { supervisor, harness } = await setup();
		harness.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "HTTP 401 unauthorized" }), fauxAssistantMessage("恢复成功")]);
		await supervisor.main.send("首次");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((message) => message.text.includes("HTTP 401"))).toBe(true));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		await supervisor.main.send("重试");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((message) => message.text === "恢复成功")).toBe(true));
	});

	it("returns readable model-fetch failures and rejects unsupported thinking without switching", async () => {
		const { supervisor } = await setup();
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("", { status: 401, statusText: "Unauthorized" })).mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-a" }, { id: "model-b" }] }), { status: 200 })));
		const input = { baseUrl: "http://localhost:0/v1", apiKey: "faux", protocol: "messages" as const };
		expect(await supervisor.models.fetchModels(input)).toEqual({ ok: false, error: "HTTP 401 Unauthorized" });
		expect(await supervisor.models.fetchModels(input)).toEqual({ ok: false, error: "连接失败：offline" });
		expect(await supervisor.models.fetchModels(input)).toEqual({ ok: true, models: ["model-a", "model-b"] });
		await expect(supervisor.main.selectModel({ provider: "rally-test", model: "main-1", thinkingLevel: "high" })).rejects.toThrow("不支持思考档位");
		expect(supervisor.main.state().thinkingLevel).toBe("off");
		await expect(supervisor.models.selectWorker({ provider: "rally-test", model: "worker-1", thinkingLevel: "high" })).rejects.toThrow("不支持思考档位");
	});

	it("counts starting and active workers once, queues capacity, and blocks failed dependencies", async () => {
		const { paths, supervisor } = await setup();
		// Isolated scheduler facts with controlled startup completion, no model transport involved.
		const events = new EventLog(join(paths.stateDir, "scheduler-test.jsonl"));
		const store = new TaskStore(events, paths.workspaceDir, () => {});
		const active = new Set<string>();
		const started: string[] = [];
		const releases: (() => void)[] = [];
		const failed = vi.fn();
		const scheduler = new Scheduler({ store, events, activeIds: () => [...active], wakePending: () => {}, onDependencyFailed: failed,
			start: async (task) => { started.push(task.id); active.add(task.id); await new Promise<void>((resolve) => releases.push(resolve)); } });
		const input = { title: "queued", quotes: [], cwd: paths.workspaceDir, scope: [], mode: "readonly" as const, dependsOn: [], autoApprove: true };
		const first = store.create(input).task;
		const second = store.create(input).task;
		const third = store.create(input).task;
		const dependent = store.create({ ...input, dependsOn: [first.id] }).task;
		scheduler.tick();
		expect(started).toEqual([first.id, second.id]);
		expect(third.queue?.reason).toBe("capacity");
		expect(dependent.queue?.reason).toBe("dependency");
		scheduler.tick();
		expect(events.ofKind("capacity").at(-1)?.data.active).toBe(2);
		store.report(first.id, first.runs[0].id, "failed", "上游失败");
		active.delete(first.id);
		releases.shift()!();
		await vi.waitFor(() => expect(started).toContain(third.id));
		expect(dependent.queue?.reason).toBe("dependency_failed");
		scheduler.tick();
		expect(failed).toHaveBeenCalledTimes(1);
		expect(dependent.runs).toHaveLength(0);
		scheduler.dispose();
		for (const release of releases) release();
		expect(supervisor.workers.streamingCount()).toBe(0);
	});

	it.each(["steer", "answer"] as const)("queues an idle worker's %s until a streaming slot is released", async (kind) => {
		const { supervisor, harness } = await setup();
		let releaseSecond!: () => void;
		let releaseThird!: () => void;
		const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
		const thirdGate = new Promise<void>((resolve) => { releaseThird = resolve; });
		const ready = () => fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "完成" }), { stopReason: "toolUse" });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "等待补充", question: "如何继续？", options: ["逐字原话", "停止"] }), { stopReason: "toolUse" }), fauxAssistantMessage("等待。"),
			async () => { await secondGate; return ready(); },
			async () => { await thirdGate; return ready(); },
			fauxAssistantMessage("完成。"),
			(context) => { expect(lastUser(context)).toContain("逐字原话"); return ready(); },
			fauxAssistantMessage("完成。"),
			fauxAssistantMessage("完成。"),
		]);
		const first = createTask(supervisor);
		supervisor.approve(first.id);
		await vi.waitFor(() => expect(supervisor.workers.has(first.id) && supervisor.workers.streamingCount() === 0).toBe(true));
		const second = createTask(supervisor);
		const third = createTask(supervisor);
		supervisor.approve(second.id);
		supervisor.approve(third.id);
		await vi.waitFor(() => expect(supervisor.workers.streamingCount()).toBe(2));
		if (kind === "answer") {
			const id = first.attention!.id;
			supervisor.store.escalateAttention(first.id, id);
			supervisor.answerOption(first.id, id, "逐字原话");
		} else expect((await toolsFor(supervisor)("task_steer", { taskId: first.id, quotes: [{ id: "#fixture" }] })).isError).not.toBe(true);
		const input = first.inputs.at(-1)!;
		expect(input.deliveredAt).toBeUndefined();
		expect(first.queue?.reason).toBe("capacity");
		releaseSecond();
		await vi.waitFor(() => expect(first.ended?.outcome).toBe("done"));
		expect(input.deliveredAt).toBeDefined();
		expect(supervisor.workers.streamingCount()).toBeLessThanOrEqual(2);
		releaseThird();
		await vi.waitFor(() => expect(supervisor.workers.streamingCount()).toBe(0));
	});

	it("recovers an open run as interrupted and requires approval to resume", async () => {
		const { paths, supervisor } = await setup();
		const task = createTask(supervisor);
		supervisor.store.startRun(task.id, "dispatch", "rally-test/worker-1");
		await supervisor.dispose();
		const restored = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
		supervisors.push(restored);
		await restored.start();
		const recovered = restored.store.get(task.id)!;
		expect(taskView(recovered).status).toBe("interrupted");
		expect(recovered.runs).toHaveLength(1);
		const call = toolsFor(restored);
		expect((await call("task_resume", { taskId: task.id, quotes: [{ id: "#fixture" }] })).isError).not.toBe(true);
		expect(taskView(recovered).status).toBe("pending_approval");
		expect(recovered.runs).toHaveLength(1);
	});

	it("keeps UI history and original quote ids when organizing context succeeds", async () => {
		const { supervisor, harness, paths } = await setup(true, 1);
		harness.setResponses([fauxAssistantMessage("已记录。"), fauxAssistantMessage("摘要保留目标与用户原话 ID。")]);
		await supervisor.main.send("COMPACTION_ORIGINAL_WORDS");
		await vi.waitFor(() => expect(supervisor.main.state().messages.some((message) => message.text === "已记录。")).toBe(true));
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		const original = supervisor.main.state().messages.find((message) => message.role === "user")!;
		const history = supervisor.main.state().messages;
		await supervisor.main.reset();
		expect(supervisor.main.state().messages.slice(0, history.length)).toEqual(history);
		expect(supervisor.main.quote({ id: original.id })?.text).toBe("COMPACTION_ORIGINAL_WORDS");
		expect(supervisor.main.isBusy()).toBe(false);
		expect(supervisor.events.ofKind("chat_compacted")).toHaveLength(1);
		expect(readFileSync(paths.eventsFile, "utf8")).not.toContain('"kind":"chat_reset"');
	});

	it("answers the current worker question with frozen user words and rejects stale questions", async () => {
		const { supervisor, harness } = await setup();
		const task = createTask(supervisor);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "需要确认", question: "是否按用户原话继续？" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("等待回答。"),
			(context) => {
				expect(lastUser(context)).toContain("逐字原话");
				expect(lastUser(context)).toContain("#fixture");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已按原话完成" }), { stopReason: "toolUse" });
			}, fauxAssistantMessage("完成。"),
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.attention && supervisor.workers.streamingCount() === 0).toBeTruthy());
		const question = task.attention!.id;
		const call = toolsFor(supervisor);
		expect(getMessageText(await call("task_answer", { taskId: task.id, questionId: "Q-stale", quotes: [{ id: "#fixture" }] }))).toContain("QUESTION_STALE");
		expect((await call("task_answer", { taskId: task.id, questionId: question, quotes: [{ id: "#fixture" }] })).isError).not.toBe(true);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		expect(task.inputs.find((input) => input.kind === "answer")?.body).toContain("逐字原话");
		expect(task.attention).toBeUndefined();
		expect(supervisor.events.ofKind("audit_appended").find((event) => event.data.kind === "answer")?.data).toMatchObject({ questionId: question, actor: "main", basis: ["#fixture"], text: expect.stringContaining("逐字原话") });
	});

	it.each(["fallback", "explicit"] as const)("escalates questions via %s, deduplicates reports and answers options without waking main", async (mode) => {
		const { supervisor, harness, paths } = await setup();
		const task = createTask(supervisor);
		const question = "  保留 <legacy> 接口？\n请逐字展示。 ";
		let workerStep = 0;
		let mainCalls = 0;
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main-1") {
				mainCalls++;
				if (mode === "explicit" && task.attention && !task.attention.escalatedAt && JSON.stringify(context.messages).includes("worker_question"))
					return fauxAssistantMessage(fauxToolCall("escalate", { kind: "question", taskId: task.id, id: task.attention.id }), { stopReason: "toolUse" });
				return fauxAssistantMessage("已记录。");
			}
			workerStep++;
			if (workerStep <= 2) return fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "需要选择", question, options: ["保留", "移除"] }), { stopReason: "toolUse" });
			if (workerStep === 3) {
				expect(getMessageText(context.messages.findLast((message) => message.role === "toolResult"))).toContain('"notifiedMain":false');
				return fauxAssistantMessage("等待回答。");
			}
			if (workerStep === 4) {
				expect(lastUser(context)).toContain("保留");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已保留" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("完成。");
		};
		harness.setResponses(Array(16).fill(route)); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.attention && supervisor.workers.streamingCount() === 0).toBeTruthy());
		const id = task.attention!.id;
		expect(task.attention!.question).toBe(question);
		expect(supervisor.events.ofKind("relay_enqueued").filter((event) => event.data.kind === "worker_question")).toHaveLength(1);
		// Settling an unrelated turn before the relay window must not escalate undelivered questions.
		await supervisor.main.send("先记下其它事项");
		expect(task.attention!.escalatedAt).toBeUndefined();
		await vi.waitFor(() => expect(task.attention?.escalatedAt).toBeTypeOf("number"), { timeout: 10000 });
		await vi.waitFor(() => expect(supervisor.main.isBusy()).toBe(false));
		expect(taskView(task).status).toBe("needs_answer");
		const before = mainCalls;
		const notice = vi.spyOn(supervisor.relay, "notice");
		supervisor.answerOption(task.id, id, "保留");
		expect(notice).toHaveBeenCalledWith(`用户已回答 ${task.id} 的 ${id}：保留`, expect.stringMatching(/^event:/));
		expect(() => supervisor.answerOption(task.id, id, "移除")).toThrow("失效");
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		expect(mainCalls).toBe(before);
		expect(task.inputs.filter((input) => input.kind === "answer")).toHaveLength(1);
		expect(task.attentionHistory?.[0]).toMatchObject({ id, question, answer: { by: "user", basis: [], text: "保留" } });
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.get(task.id)?.attentionHistory).toEqual(task.attentionHistory);
		expect(supervisor.events.ofKind("audit_appended").find((event) => event.data.kind === "answer")?.data).toMatchObject({ taskId: task.id, questionId: id, actor: "user", basis: [], text: "保留" });
	}, 15000);

	it("forwards a typed user answer through main using the real message ID and original words", async () => {
		const { supervisor, harness } = await setup();
		const task = createTask(supervisor);
		let workerStep = 0;
		const original = "保留兼容层，先通知调用方。";
		const route: FauxResponseStep = (context, _options, _state, model) => {
			if (model.id === "main-1") {
				const user = supervisor.main.state().messages.findLast((message) => message.role === "user");
				if (user?.text === original && task.attention)
					return fauxAssistantMessage(fauxToolCall("task_answer", { taskId: task.id, questionId: task.attention.id, quotes: [{ id: user.id }] }), { stopReason: "toolUse" });
				return fauxAssistantMessage("请回答问题。");
			}
			workerStep++;
			if (workerStep === 1) return fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "等答复", question: "是否保留兼容层？" }), { stopReason: "toolUse" });
			if (workerStep === 2) return fauxAssistantMessage("等待。");
			if (workerStep === 3) {
				expect(lastUser(context)).toContain(original);
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已记录用户决定" }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("完成。");
		};
		harness.setResponses(Array(12).fill(route)); supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.attention?.escalatedAt).toBeTypeOf("number"), { timeout: 10000 });
		await supervisor.main.send(original);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		const user = supervisor.main.state().messages.find((message) => message.role === "user" && message.text === original)!;
		expect(task.attentionHistory?.[0].answer).toMatchObject({ by: "main", basis: [user.id], text: expect.stringContaining(original) });
	}, 15000);

	it("steers an option answer into a streaming worker without starting a second run", async () => {
		const { supervisor, harness } = await setup();
		const task = createTask(supervisor);
		let release!: () => void;
		const waiting = new Promise<void>((resolve) => { release = resolve; });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("task_report", { state: "progress", summary: "仍在调查", question: "要兼容旧接口吗？", options: ["保留", "移除"] }), { stopReason: "toolUse" }),
			async () => { await waiting; return fauxAssistantMessage("已完成初步调查。"); },
			(context) => {
				expect(lastUser(context)).toBe("保留");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "已保留" }), { stopReason: "toolUse" });
			}, fauxAssistantMessage("完成。"),
		]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(harness.faux.state.callCount).toBe(2));
		const id = task.attention!.id;
		supervisor.store.escalateAttention(task.id, id);
		supervisor.answerOption(task.id, id, "保留");
		expect(task.inputs.at(-1)?.deliveredAt).toBeDefined();
		expect(supervisor.workers.streamingCount()).toBe(1);
		release();
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		expect(task.runs).toHaveLength(1);
	});

	it("audits approval and cancellation buttons as user actions without fabricated message IDs", async () => {
		const { supervisor, harness } = await setup();
		harness.setResponses([fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "等待用户", question: "是否继续？" }), { stopReason: "toolUse" }), fauxAssistantMessage("等待。")]);
		const task = createTask(supervisor);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.attention && supervisor.workers.streamingCount() === 0).toBeTruthy());
		const id = task.attention!.id;
		supervisor.store.escalateAttention(task.id, id);
		supervisor.cancel(task.id);
		expect(() => supervisor.answerOption(task.id, id, "继续")).toThrow("失效");
		expect(task.attention).toBeUndefined();
		const actions = supervisor.events.ofKind("audit_appended").filter((event) => ["approve", "cancel"].includes(String(event.data.kind)));
		expect(actions.map((event) => event.data)).toEqual([
			expect.objectContaining({ kind: "approve", actor: "button", basis: [], taskId: task.id }),
			expect.objectContaining({ kind: "cancel", actor: "user", basis: [], taskId: task.id }),
		]);
	});

	it("requires renewed approval for a blocked readonly task upgraded to write; event facts stay frozen", async () => {
		const { supervisor, harness } = await setup();
		const task = createTask(supervisor);
		harness.setResponses([fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "需要改项目文件" }), { stopReason: "toolUse" }), fauxAssistantMessage("等待升级。")]);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.runs[0]?.lastReport?.state === "blocked" && supervisor.workers.streamingCount() === 0).toBe(true));
		const call = toolsFor(supervisor);
		expect((await call("task_resume", { taskId: task.id, quotes: [{ id: "#fixture" }], mode: "write", scope: ["README.md"] })).isError).not.toBe(true);
		expect(task.mode).toBe("write");
		expect(taskView(task).status).toBe("pending_approval");
		expect(task.runs).toHaveLength(1);
		expect(task.runs[0].endReason).toBe("blocked");
		const created = supervisor.events.ofKind("task_created")[0].data.task as { mode: string; runs: unknown[] };
		expect(created.mode).toBe("readonly");
		expect(created.runs).toHaveLength(0);
	});

	it("cancels a streaming worker through the task tool without an automatic restart", async () => {
		const { supervisor, harness } = await setup();
		harness.setResponses([async (_context, options) => {
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted) resolve();
				else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			return fauxAssistantMessage("已中断", { stopReason: "aborted" });
		}]);
		const task = createTask(supervisor);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(harness.faux.state.callCount).toBe(1));
		expect((await toolsFor(supervisor)("task_cancel", { taskId: task.id, quotes: [{ id: "#fixture" }] })).isError).not.toBe(true);
		await vi.waitFor(() => expect(supervisor.workers.has(task.id)).toBe(false));
		expect(task.ended?.outcome).toBe("cancelled");
		expect(task.runs).toHaveLength(1);
		expect(task.runs[0].endReason).toBe("cancelled");
		expect(supervisor.events.ofKind("audit_appended").find((event) => event.data.kind === "cancel")?.data).toMatchObject({ taskId: task.id, actor: "main", basis: ["#fixture"] });
	});

	it("steers a relay into a busy main before the next model call and acknowledges only consumed context", async () => {
		const { supervisor, harness } = await setup();
		let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; });
		let calls = 0;
		harness.setResponses([async () => { calls++; await hold; return fauxAssistantMessage("原回复"); }, (context) => {
			calls++; expect(JSON.stringify(context.messages)).toContain("BUSY_RELAY_FACT");
			return fauxAssistantMessage("已处理 worker 汇报。");
		}]);
		await supervisor.main.send("先开始处理");
		await vi.waitFor(() => expect(calls).toBe(1));
		const task = createTask(supervisor); const run = supervisor.store.startRun(task.id, "dispatch", "faux");
		supervisor.store.report(task.id, run.id, "ready", "BUSY_RELAY_FACT");
		expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(0);
		release();
		await vi.waitFor(() => expect(calls).toBe(2));
		expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(1);
		expect(supervisor.events.ofKind("relay_delivered")[0].data.mode).toBe("steer");
	});

	it("recovers a durable report whose outbox enqueue was interrupted", async () => {
		const { supervisor, paths, harness } = await setup();
		const task = createTask(supervisor); const run = supervisor.store.startRun(task.id, "dispatch", "faux");
		supervisor.relay.dispose();
		supervisor.store.report(task.id, run.id, "ready", "SOURCE_GAP_FACT");
		expect(supervisor.events.ofKind("relay_enqueued")).toHaveLength(0);
		await supervisor.dispose();
		let seen = false;
		harness.setResponses([(context) => { seen = true; expect(JSON.stringify(context.messages)).toContain("SOURCE_GAP_FACT"); return fauxAssistantMessage("恢复汇报。"); }]);
		const recovered = await restart(paths, harness);
		await vi.waitFor(() => expect(seen).toBe(true), { timeout: 10000 });
		expect(recovered.events.ofKind("relay_enqueued")).toHaveLength(1);
		expect(recovered.events.ofKind("relay_delivered")).toHaveLength(1);
	}, 15000);

	it("reconciles Pi history after a lost relay receipt without duplicating the fact or system line", async () => {
		const { supervisor, paths, harness } = await setup();
		vi.spyOn(supervisor.relay, "consumed").mockImplementation(() => {});
		let firstRequest = false;
		harness.setResponses([async (_context, options) => {
			firstRequest = true;
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted) resolve();
				else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			return fauxAssistantMessage("中断", { stopReason: "aborted" });
		}]);
		const task = createTask(supervisor); const run = supervisor.store.startRun(task.id, "dispatch", "faux");
		supervisor.store.report(task.id, run.id, "ready", "RECEIPT_GAP_FACT");
		await vi.waitFor(() => expect(firstRequest).toBe(true), { timeout: 10000 });
		const relayId = String(supervisor.events.ofKind("relay_enqueued")[0].data.relayId);
		expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(0);
		await supervisor.dispose();
		let seen = false;
		harness.setResponses([(context) => {
			seen = true; const transcript = JSON.stringify(context.messages);
			expect(transcript.match(/RECEIPT_GAP_FACT/g)).toHaveLength(1);
			expect(transcript).toContain("rally-resume");
			return fauxAssistantMessage("继续处理原汇报。");
		}]);
		const recovered = await restart(paths, harness);
		await vi.waitFor(() => expect(seen).toBe(true), { timeout: 10000 });
		expect(recovered.events.ofKind("relay_enqueued")).toHaveLength(1);
		expect(recovered.events.ofKind("relay_delivered")[0].data.relayId).toBe(relayId);
		expect(recovered.main.state().messages.filter((message) => message.relayId === relayId)).toHaveLength(1);
	}, 15000);

	it("preserves notices through restart without waking main and consumes each on the next user turn", async () => {
		const { supervisor, paths, harness } = await setup();
		supervisor.relay.notice("NOTICE_RESTART_FACT", "fixture-notice");
		expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(0);
		await supervisor.dispose();
		let calls = 0;
		harness.setResponses([(context) => {
			calls++; expect(JSON.stringify(context.messages).match(/NOTICE_RESTART_FACT/g)).toHaveLength(1);
			return fauxAssistantMessage("收到。");
		}]);
		const recovered = await restart(paths, harness);
		await new Promise<void>((resolve) => setTimeout(resolve, 2200));
		expect(calls).toBe(0);
		await recovered.main.send("开始下一轮");
		await vi.waitFor(() => expect(calls).toBe(1));
		expect(recovered.events.ofKind("relay_delivered")[0].data.mode).toBe("notice");
	}, 15000);

	it("retains unread steered relays after stopping main and delivers one copy on the next user turn", async () => {
		const { supervisor, harness } = await setup();
		let calls = 0;
		harness.setResponses([async (_context, options) => {
			calls++;
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted) resolve();
				else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			return fauxAssistantMessage("已停止", { stopReason: "aborted" });
		}, (context) => {
			calls++; expect(JSON.stringify(context.messages).match(/UNREAD_STEER_FACT/g)).toHaveLength(1);
			return fauxAssistantMessage("恢复处理。");
		}]);
		await supervisor.main.send("先处理"); await vi.waitFor(() => expect(calls).toBe(1));
		const task = createTask(supervisor); const run = supervisor.store.startRun(task.id, "dispatch", "faux");
		supervisor.store.report(task.id, run.id, "ready", "UNREAD_STEER_FACT");
		await supervisor.main.abort();
		await new Promise<void>((resolve) => setTimeout(resolve, 2200));
		expect(calls).toBe(1); expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(0);
		await supervisor.main.send("继续");
		await vi.waitFor(() => expect(calls).toBe(2));
		expect(supervisor.events.ofKind("relay_delivered")).toHaveLength(1);
	}, 15000);

	it("keeps an existing worker on its model when the global worker selection changes", async () => {
		const { supervisor, harness } = await setup();
		harness.setResponses([async (_context, _options, _state, model) => {
			expect(model.id).toBe("worker-1");
			await supervisor.models.selectWorker({ provider: "rally-test", model: "worker-2" });
			return fauxAssistantMessage(fauxToolCall("read", { path: "README.md" }), { stopReason: "toolUse" });
		}, (_context, _options, _state, model) => {
			expect(model.id).toBe("worker-1");
			return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "原模型完成" }), { stopReason: "toolUse" });
		}, fauxAssistantMessage("完成。")]);
		const task = createTask(supervisor);
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		expect(task.runs[0].model).toBe("rally-test/worker-1");
		expect((await supervisor.models.state()).worker?.model).toBe("worker-2");
		expect(harness.getPendingResponseCount()).toBe(0);
	});
});
