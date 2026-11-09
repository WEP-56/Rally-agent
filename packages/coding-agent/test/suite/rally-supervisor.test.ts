import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt, getCurrentTools, type TranscriptContext } from "@rally/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ModelStore } from "../../../../src/main/model-store.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createMainTaskTools } from "../../../../src/main/supervisor/tools.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { Scheduler } from "../../../../src/main/supervisor/scheduler.ts";
import { taskView } from "../../../../src/shared/task.ts";
import type { ExtensionToolContext } from "../../src/index.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("Rally production supervisor integration (offline faux provider)", () => {
	const harnesses: Harness[] = [];
	const supervisors: Supervisor[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		for (const supervisor of supervisors.splice(0)) supervisor.dispose();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});

	async function setup(workerConfigured = true, keepRecentTokens = 20000) {
		const harness = await createHarness({ provider: "rally-test", models: [{ id: "main-1" }, { id: "worker-1" }, { id: "worker-2" }] });
		harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home"));
		ensureRallyDirs(paths);
		writeFileSync(join(paths.agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens } }));
		mkdirSync(paths.workspaceDir, { recursive: true });
		writeFileSync(join(paths.workspaceDir, "README.md"), "# Fixture README\nfirst twenty lines\n");
		writeFileSync(join(paths.workspaceDir, "AGENTS.md"), "RALLY_PROJECT_INSTRUCTIONS_SENTINEL");
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
	function lastUser(context: TranscriptContext) { return getMessageText(context.messages.findLast((message) => message.role === "user")); }
	function createTask(supervisor: Supervisor, overrides: Partial<Parameters<Supervisor["store"]["create"]>[0]> = {}) {
		return supervisor.store.create({ title: "离线任务", quotes: [{ messageId: "#fixture", kind: "user", text: "用户原话", at: Date.now() }], cwd: supervisor.paths.workspaceDir, scope: [], mode: "readonly", dependsOn: [], autoApprove: supervisor.board().autoApprove, ...overrides }).task;
	}
	function toolsFor(supervisor: Supervisor) {
		const tools = createMainTaskTools({ store: supervisor.store, workspaceDir: supervisor.paths.workspaceDir, currentProject: () => null, autoApprove: () => supervisor.board().autoApprove,
			quote: (ref) => ref.id === "#fixture" ? { messageId: ref.id, kind: "user", text: "逐字原话", at: Date.now() } : null,
			tick: () => supervisor.scheduler.tick(), board: () => supervisor.board(), abortWorker: (id) => { void supervisor.workers.abort(id); },
			deliverSteer: (id, text) => { supervisor.workers.deliver(id, text, supervisor.store.get(id)?.inputs.at(-1)?.id); },
			deliverAnswer: (id, text) => { supervisor.workers.deliver(id, text, supervisor.store.get(id)?.inputs.at(-1)?.id); } });
		return (name: string, params: unknown) => {
			const tool = tools.find((item) => item.name === name);
			if (!tool) throw new Error(`Missing ${name}`);
			return tool.execute("test", params, undefined, undefined, {} as ExtensionToolContext);
		};
	}

	it("declares Rally roles/tools and runs dispatch → approval → worker read/report → main relay", async () => {
		const { harness, paths, supervisor } = await setup();
		const original = "派发一个任务：让 worker 读取 README 前 20 行并汇报";
		harness.setResponses([
			(context) => {
				const prompt = getCurrentSystemPrompt(context.messages);
				expect(prompt).toContain("Rally");
				expect(prompt).not.toContain("You are a coding assistant running inside pi");
				expect(prompt).not.toContain("Pi documentation");
				expect(toolNames(context)).toEqual(expect.arrayContaining(["read", "grep", "find", "ls", "task_dispatch", "task_approve", "task_update", "task_steer", "task_answer", "task_resume", "task_cancel", "task_read"]));
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
				expect(toolNames(context)).toEqual(expect.arrayContaining(["task_report", "task_read", "bash", "powershell"]));
				expect(toolNames(context)).not.toContain("task_dispatch");
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
		expect(harness.getPendingResponseCount()).toBe(0);
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
		const base = { title: "valid", quotes: [{ id: "#fixture" }], mode: "readonly" };
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

	it("queues an idle worker's steer until a streaming slot is released", async () => {
		const { supervisor, harness } = await setup();
		let releaseSecond!: () => void;
		let releaseThird!: () => void;
		const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
		const thirdGate = new Promise<void>((resolve) => { releaseThird = resolve; });
		const ready = () => fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "完成" }), { stopReason: "toolUse" });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("task_report", { state: "blocked", summary: "等待补充" }), { stopReason: "toolUse" }), fauxAssistantMessage("等待。"),
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
		expect((await toolsFor(supervisor)("task_steer", { taskId: first.id, quotes: [{ id: "#fixture" }] })).isError).not.toBe(true);
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
		supervisor.dispose();
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
	});

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
