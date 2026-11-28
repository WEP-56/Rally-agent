
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools, validateToolArguments } from "@rally/ai";
import type { FauxResponseStep } from "@rally/ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionToolContext, ToolDefinition } from "../../src/index.ts";
import { freezeTaskContext, recentChatContext, taskContextSummary, type TaskContextSources } from "../../../../src/main/supervisor/task-context.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { TaskSnapshot } from "../../../../src/main/supervisor/task-snapshot.ts";
import { createMainTaskTools, createWorkerTools, type TaskToolHost } from "../../../../src/main/supervisor/tools.ts";
import { createScheduleTools } from "../../../../src/main/supervisor/schedule-tools.ts";
import { ScheduledTasks } from "../../../../src/main/supervisor/schedules.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ExternalWorkerSession } from "../../../../src/main/supervisor/external-worker-session.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import type { ChatLine } from "../../../../src/shared/ipc.ts";
import type { TaskContext } from "../../../../src/shared/task.ts";
import { defaultModel } from "../../../../src/shared/models.ts";
import { createHarness, getMessageText } from "./harness.ts";

function call(tools: ToolDefinition[], name: string, params: unknown) {
	return tools.find(tool => tool.name === name)!.execute("fixture", params, undefined, undefined, {} as ExtensionToolContext);
}
function text(value: Awaited<ReturnType<typeof call>>) { return value.content.map(part => part.type === "text" ? part.text : "").join(""); }
const line = (n: number, role: ChatLine["role"], text: string): ChatLine => ({ id: "#" + n, role, text, at: n * 100, streaming: false });
const history = [
	line(1, "user", "The project is in D:/example."),
	line(2, "assistant", "I will use that project."),
	line(3, "assistant", "Another reply in the same round."),
	line(4, "user", "Please inspect it."),
];
const sources: TaskContextSources = {
	recentTurns: count => recentChatContext(history, count, "#4"),
	memory: file => "- " + file + " complete notebook. [inferred; #1]\n",
};

describe("simple worker background switches", () => {
	const cleanups: (() => void | Promise<void>)[] = [];
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
		vi.restoreAllMocks(); vi.unstubAllEnvs();
	}, 30000);

	it("counts user rounds, excludes tool/thinking/system data and anchors before the actual current request", () => {
		const messages = [
			...history.slice(0, 3),
			{ ...line(5, "assistant", ""), blocks: [{ type: "thinking" as const, text: "HIDDEN" }] },
			line(6, "system", "SYSTEM"),
			{ ...line(7, "assistant", "RELAY"), relayId: "R-1" },
			{ ...line(8, "assistant", "IN_FLIGHT"), streaming: true },
			line(9, "user", "second round"),
			line(10, "assistant", "second reply"),
			line(11, "user", "current request"),
			line(12, "assistant", "dispatch preamble"),
			line(13, "user", "newer queued message"),
		];
		const selected = recentChatContext(messages, 2, "#11");
		expect(selected.map(entry => entry.text)).toEqual([
			history[0].text, history[1].text, history[2].text, "second round", "second reply",
		]);
		expect(taskContextSummary(selected)).toMatchObject({ turns: 2, messages: 5, truncatedMessages: 0 });
		expect(recentChatContext(messages, 1, "#11").map(entry => entry.text)).toEqual(["second round", "second reply"]);
		expect(recentChatContext(messages, 0, "#11")).toEqual([]);
		expect(recentChatContext(messages, 3, "#missing")).toEqual([]);
	});

	it("automatically bounds long Unicode text and keeps all requested rounds represented", () => {
		const messages = Array.from({ length: 32 }, (_, i) => [
			line(i * 2 + 1, "user", "😀".repeat(5000)), line(i * 2 + 2, "assistant", "好".repeat(5000)),
		]).flat();
		const selected = recentChatContext(messages, 30);
		expect(taskContextSummary(selected)).toEqual({ turns: 30, messages: 60, memoryFiles: [], truncatedMessages: 60 });
		expect(selected.reduce((sum, entry) => sum + [...entry.text].length, 0)).toBeLessThanOrEqual(60000);
		expect(selected[0]).toMatchObject({ id: "#5", turnId: "#5" });
		expect(selected[0].text).toBe("😀".repeat(1000));
	});

	it("copies all three notebooks only when enabled and independently preserves or clears each part", () => {
		const readMemory = vi.fn(sources.memory);
		const source = { ...sources, memory: readMemory };
		expect(freezeTaskContext({}, source)).toBeUndefined();
		expect(freezeTaskContext({ context: 0, memory: 0 })).toEqual([]);
		expect(readMemory).not.toHaveBeenCalled();
		const both = freezeTaskContext({ context: 1, memory: 1 }, source)!;
		expect(taskContextSummary(both)).toMatchObject({ turns: 1, memoryFiles: ["USER", "PREFERENCES", "RECENT"] });
		for (const file of ["USER", "PREFERENCES", "RECENT"]) expect(both.some(entry => entry.text.includes(file + " complete notebook"))).toBe(true);
		const memoryOnly = freezeTaskContext({ context: 0 }, source, both)!;
		expect(memoryOnly).toHaveLength(3);
		expect(memoryOnly.every(entry => entry.source === "memory")).toBe(true);
		expect(freezeTaskContext({ memory: 0 }, source, both)).toEqual(both.filter(entry => entry.source === "chat"));
		const legacy: TaskContext[] = [{ source: "chat", id: "#old", role: "assistant", at: 1, text: "Old persisted excerpt" }];
		expect(freezeTaskContext({ memory: 0 }, source, legacy)).toEqual(legacy);
		expect(() => freezeTaskContext({ memory: 1 }, { ...source, memory: () => "x".repeat(5000) })).toThrow("预算");
	});

	it.each([-1, 31, 1.5, NaN])("rejects invalid round counts before reading sources: %s", context => {
		const recentTurns = vi.fn(sources.recentTurns);
		expect(() => freezeTaskContext({ context }, { ...sources, recentTurns })).toThrow("0–30");
		expect(recentTurns).not.toHaveBeenCalled();
	});

	async function storeFixture() {
		const harness = await createHarness();
		const events = new EventLog(join(harness.tempDir, "events.jsonl"));
		const store = new TaskStore(events, () => harness.tempDir, () => {});
		cleanups.push(() => { events.close(); harness.cleanup(); });
		const host: TaskToolHost = { store, workspaceDir: harness.tempDir, autoApprove: () => false,
			quote: ref => ref.id === "#4" ? { messageId: "#4", kind: "user", text: history[3].text, at: 400 } : null,
			recentQuoteIds: () => ["#4"],
			contextSources: sources, tick: () => {}, deliverSteer: () => "queued_for_worker", deliverAnswer: () => "queued_for_worker", abortWorker: () => {},
			board: () => store.board(0, 2), roleWorker: () => undefined };
		const tools = createMainTaskTools(host);
		const params = { title: "Inspect project", cwd: harness.tempDir, mode: "readonly", quotes: [{ id: "#4" }] };
		return { harness, events, store, host, tools, params };
	}

	it("validates both switches and quotes before dispatch, deduplicates and restores the frozen payload", async () => {
		const { harness, events, store, tools, params } = await storeFixture();
		for (const invalid of [{ quotes: [{ id: "#2" }] }, { context: [] }, { context: 31 }, { memory: 2 }, { memory: true }]) {
			expect((await call(tools, "task_dispatch", { ...params, ...invalid })).isError).toBe(true);
		}
		expect(store.list()).toHaveLength(0);
		const first = JSON.parse(text(await call(tools, "task_dispatch", { ...params, context: 3, memory: 1 })));
		expect(first.context).toMatchObject({ turns: 1, messages: 3, memoryFiles: ["USER", "PREFERENCES", "RECENT"] });
		expect(JSON.parse(text(await call(tools, "task_dispatch", { ...params, context: 3, memory: 1 })))).toMatchObject({ taskId: first.taskId, reused: true });
		const plain = JSON.parse(text(await call(tools, "task_dispatch", params)));
		expect(plain.taskId).not.toBe(first.taskId);
		expect(store.get(plain.taskId)?.context).toBeUndefined();
		const snapshot = new TaskSnapshot(join(harness.tempDir, "snapshot.json"), events);
		try {
			expect(snapshot.flush()).toBe(true);
			const restored = new TaskStore(events, () => harness.tempDir, () => {}, undefined, snapshot.replay());
			expect(restored.get(first.taskId)?.context).toEqual(freezeTaskContext({ context: 3, memory: 1 }, sources));
		} finally { snapshot.dispose(); }
	});

	it("replaces or clears background on update/resume and keeps it out of upstream cards", async () => {
		const { store, tools, params } = await storeFixture();
		const created = JSON.parse(text(await call(tools, "task_dispatch", { ...params, context: 1, memory: 1 })));
		await call(tools, "task_update", { taskId: created.taskId, quotes: params.quotes, context: 0 });
		expect(taskContextSummary(store.get(created.taskId)?.context)).toMatchObject({ turns: 0, memoryFiles: ["USER", "PREFERENCES", "RECENT"] });
		await call(tools, "task_update", { taskId: created.taskId, quotes: params.quotes, context: 1 });
		const run = store.startRun(created.taskId, "dispatch", "fixture");
		store.report(created.taskId, run.id, "ready", "done");
		const child = store.create({ ...params, quotes: [], context: freezeTaskContext({ context: 1 }, sources), scope: [], dependsOn: [created.taskId], autoApprove: false, mode: "readonly" }).task;
		const workerTools = createWorkerTools({ store, taskId: child.id, dependsOn: child.dependsOn, report: () => ({ taskId: child.id, ended: false, notifiedMain: false }) });
		expect(JSON.parse(text(await call(workerTools, "task_read", { view: "card" }))).card.counts.context).toBe(3);
		expect(JSON.parse(text(await call(workerTools, "task_read", { view: "context" }))).context).toHaveLength(3);
		expect(JSON.parse(text(await call(workerTools, "task_read", { taskId: created.taskId, view: "card" }))).card.counts.context).toBe(0);
		expect(text(await call(workerTools, "task_read", { taskId: created.taskId, view: "context" }))).toContain("NOT_VISIBLE");
		await call(tools, "task_resume", { taskId: created.taskId, quotes: params.quotes, memory: 0 });
		expect(taskContextSummary(store.get(created.taskId)?.context)).toMatchObject({ turns: 1, memoryFiles: [] });
	});

	it("accepts intact Unicode notes up to 2000 characters and explains invalid quote references", async () => {
		const { store, tools, params } = await storeFixture();
		const invalid = await call(tools, "task_dispatch", { ...params, quotes: [...params.quotes, { id: "#missing" }] });
		expect(invalid.isError).toBe(true);
		expect(text(invalid)).toContain('quotes[1].id="#missing"');
		expect(text(invalid)).toContain("最近可引用的用户消息 ID：#4");
		expect(text(invalid)).toContain("chat_search");
		const note = "好😀".repeat(1000);
		const tool = tools.find(item => item.name === "task_dispatch")!;
		expect(() => validateToolArguments(tool, fauxToolCall("task_dispatch", { ...params, note }))).not.toThrow();
		const created = JSON.parse(text(await call(tools, "task_dispatch", { ...params, note })));
		expect(store.get(created.taskId)?.note).toBe(note);
		const overflow = await call(tools, "task_update", { taskId: created.taskId, quotes: params.quotes, note: note + "多" });
		expect(overflow.isError).toBe(true);
		expect(text(overflow)).toContain("2001 字符");
		expect(text(overflow)).toContain("不会自动截断");
		expect(store.get(created.taskId)?.note).toBe(note);
		const longerEnglish = "reference ".repeat(100).trim();
		expect((await call(tools, "task_update", { taskId: created.taskId, quotes: params.quotes, note: longerEnglish })).isError).not.toBe(true);
		expect(store.get(created.taskId)?.note).toBe(longerEnglish);
	});
	it("freezes a schedule's numeric selection and copies its background to occurrences", async () => {
		const { events, store, host, params } = await storeFixture();
		let now = Date.now();
		const service = new ScheduledTasks(events, store, () => false, () => {}, () => now);
		cleanups.push(() => service.dispose());
		const tools = createScheduleTools(() => service, host.quote, sources);
		const receipt = JSON.parse(text(await call(tools, "schedule_create", { ...params, context: 3, memory: 1, timing: { kind: "interval", minutes: 1 } })));
		const plan = service.list()[0];
		expect(receipt.id).toBe(plan.id);
		expect(receipt.context).not.toEqual(plan.context);
		expect(plan.context).toEqual(freezeTaskContext({ context: 3, memory: 1 }, sources));
		expect(service.context()).not.toContain("complete notebook");
		now += 60000; service.poll();
		expect(store.list()[0].context).toEqual(plan.context);
		const restored = new ScheduledTasks(events, store, () => false, () => {}, () => now);
		cleanups.push(() => restored.dispose());
		expect(restored.list()[0].context).toEqual(plan.context);
	});
	it("updates schedule work and independently refreshes or clears its background through the tool", async () => {
		const { events, store, host, params } = await storeFixture();
		const service = new ScheduledTasks(events, store, () => false, () => {});
		cleanups.push(() => service.dispose());
		const tools = createScheduleTools(() => service, host.quote, sources, host.recentQuoteIds);
		const receipt = JSON.parse(text(await call(tools, "schedule_create", { ...params, note: "初始备注", context: 1, memory: 1, timing: { kind: "interval", minutes: 60 } })));
		const plan = service.list()[0];
		expect(receipt.context).not.toEqual(plan.context);
		expect(receipt.id).toBe(plan.id);
		const update = { id: plan.id, quotes: params.quotes, title: "Updated project", mode: "write", note: "更新后的项目", memory: 0 };
		await call(tools, "schedule_update", update);
		expect(service.list()[0]).toMatchObject({ title: update.title, mode: "write", note: update.note, nextAt: plan.nextAt, revision: 2, context: plan.context!.filter((entry: TaskContext) => entry.source === "chat") });
		await call(tools, "schedule_update", { id: plan.id, quotes: params.quotes, context: 0, memory: 1, note: "" });
		expect(service.list()[0].context).toEqual(freezeTaskContext({ context: 0, memory: 1 }, sources));
		expect(service.list()[0].note).toBeUndefined();
		const before = service.list();
		await expect(call(tools, "schedule_update", { ...update, quotes: [{ id: "#missing" }] })).rejects.toThrow('quotes[0].id="#missing"');
		await expect(call(tools, "schedule_update", { ...update, context: 31 })).rejects.toThrow("0–30");
		await expect(call(tools, "schedule_update", { id: plan.id, quotes: params.quotes, enabled: null, memory: 0 })).rejects.toThrow("不能同时");
		expect(service.list()).toEqual(before);
		await call(tools, "schedule_update", { id: plan.id, quotes: params.quotes });
		expect(service.list()).toEqual(before);
	});

	it.each([
		{ executor: "rally", memory: 0 }, { executor: "rally", memory: 1 },
		{ executor: "claude-code", memory: 1 }, { executor: "codex", memory: 1 },
	] as const)("dispatches three rounds to $executor with memory=$memory without chat_search", async ({ executor, memory }) => {
		vi.stubEnv("PI_OFFLINE", "1");
		const harness = await createHarness({ provider: "context-test", models: [{ id: "main" }, { id: "worker" }] });
		const paths = resolveRallyPaths(join(harness.tempDir, "home"));
		ensureRallyDirs(paths); mkdirSync(paths.memoryDir, { recursive: true });
		for (const file of ["USER", "PREFERENCES", "RECENT"]) writeFileSync(join(paths.memoryDir, file + ".md"), "- FULL_" + file + "_NOTEBOOK\n");
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
		cleanups.push(async () => { await supervisor.dispose(); harness.cleanup(); });
		await supervisor.models.save([{ id: "context-test", name: "Offline", protocol: "messages", baseUrl: "http://localhost:0", apiKey: "faux", models: harness.models.map(model => defaultModel(model.id)) }]);
		const runtime = (await supervisor.models.whenReady())!;
		runtime.registerProvider("context-test", { api: harness.faux.api, apiKey: "faux", baseUrl: "http://localhost:0", models: harness.models.map(model => ({ ...model, type: "chat" as const })) });
		supervisor.models.setActive({ provider: "context-test", model: "main", thinkingLevel: "off" });
		await supervisor.models.selectWorker({ provider: "context-test", model: "worker", thinkingLevel: "off" });
		let roleId: string | undefined;
		if (executor !== "rally") roleId = supervisor.roleWorkers.save({ id: "external", name: "External", avatar: null, summary: "fixture", personality: "", workstyle: "", recommendedSkills: [], executor, externalModel: "fixture" }, () => false, () => true)[0].id;
		let workerText = "";
		if (executor !== "rally") vi.spyOn(ExternalWorkerSession, "start").mockImplementation(async options => Object.assign(Object.create(ExternalWorkerSession.prototype) as ExternalWorkerSession, {
			prompt: async (content: unknown) => { workerText = JSON.stringify(content); options.onText?.("RALLY_STATUS: ready\nFinished"); return "end_turn"; }, close: async () => {},
		}));
		await supervisor.start();
		for (let round = 0; round < 4; round++) {
			harness.setResponses([fauxAssistantMessage("Reply number " + round)]);
			await supervisor.main.send("User round " + round);
			await vi.waitFor(() => expect(supervisor.main.state().messages.some(line => line.text === "Reply number " + round && !line.streaming) && !supervisor.main.isBusy()).toBe(true));
		}
		let dispatched = false;
		const admitted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const queueAnotherMessage = executor === "rally" && memory === 0;
		cleanups.push(() => release.resolve());
		const respond: FauxResponseStep = async (context, _options, _state, model) => {
			if (model.id === "worker") {
				workerText = context.messages.map(getMessageText).join("\n");
				return fauxAssistantMessage(fauxToolCall("task_report", { state: "ready", summary: "done" }), { stopReason: "toolUse" });
			}
			if (!dispatched) {
				dispatched = true;
				const schema = getCurrentTools(context.messages).find(tool => tool.name === "task_dispatch")!;
				expect(JSON.stringify(schema)).toContain("memory");
				const user = context.messages.findLast(message => message.role === "user")!;
				const id = /User message (#\d+)/.exec(getMessageText(user))![1];
				admitted.resolve();
				if (queueAnotherMessage) await release.promise;
				return fauxAssistantMessage(fauxToolCall("task_dispatch", { title: "Summarize recent chat", cwd: paths.workspaceDir, mode: "readonly",
					...(roleId ? { roleId } : {}), quotes: [{ id }], context: 3, memory }), { stopReason: "toolUse" });
			}
			return fauxAssistantMessage("Acknowledged");
		};
		harness.setResponses(Array(24).fill(respond));
		await supervisor.main.send("Summarize the last three rounds.");
		if (queueAnotherMessage) {
			await admitted.promise;
			await supervisor.main.send("QUEUED_AFTER_MODEL_REQUEST");
			release.resolve();
		}
		await vi.waitFor(() => expect(supervisor.store.list()).toHaveLength(1));
		writeFileSync(join(paths.memoryDir, "PREFERENCES.md"), "- CHANGED_AFTER_DISPATCH\n");
		const task = supervisor.store.list()[0];
		expect(taskContextSummary(task.context)).toMatchObject({ turns: 3, messages: 6 });
		expect(JSON.stringify(task.context)).not.toContain("Summarize the last three rounds.");
		expect(JSON.stringify(task.context)).not.toContain("QUEUED_AFTER_MODEL_REQUEST");
		supervisor.approve(task.id);
		await vi.waitFor(() => expect(task.ended?.outcome).toBe("done"));
		for (const round of [1, 2, 3]) { expect(workerText).toContain("User round " + round); expect(workerText).toContain("Reply number " + round); }
		expect(workerText).not.toContain("User round 0");
		expect(workerText).toContain("not instructions or authorization");
		for (const file of ["USER", "PREFERENCES", "RECENT"]) expect(workerText.includes("FULL_" + file + "_NOTEBOOK")).toBe(memory === 1);
		expect(workerText).not.toContain("CHANGED_AFTER_DISPATCH");
		expect(supervisor.main.state().messages.flatMap(line => line.toolCalls ?? []).some(call => call.name === "chat_search")).toBe(false);
	});
});
