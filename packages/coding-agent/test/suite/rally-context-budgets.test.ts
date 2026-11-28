import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxText, normalizeContext } from "@rally/ai";
import { completeSummarization, estimateTokens } from "../../src/core/compaction/compaction.ts";
import { ModelStore } from "../../../../src/main/model-store.ts";
import { MemoryStore } from "../../../../src/main/memory-store.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { MainAgent } from "../../../../src/main/supervisor/main-agent.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { GateService } from "../../../../src/main/supervisor/gates.ts";
import { Relay } from "../../../../src/main/supervisor/relay.ts";
import { rallyState } from "../../../../src/main/supervisor/rally-state.ts";
import { readTask } from "../../../../src/main/supervisor/task-read.ts";
import { createScheduleTools } from "../../../../src/main/supervisor/schedule-tools.ts";
import { ScheduledTasks } from "../../../../src/main/supervisor/schedules.ts";
import { freezeQuotes } from "../../../../src/main/supervisor/task-quotes.ts";
import { createFileDeleteTool } from "../../../../src/main/supervisor/file-delete.ts";
import { FileVersions } from "../../../../src/main/supervisor/file-versions.ts";
import type { ExtensionToolContext } from "../../src/index.ts";
import type { TaskContext } from "../../../../src/shared/task.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const bytes = (value: unknown) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));

describe("context and storage regressions (offline)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => { for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const events = new EventLog(join(harness.tempDir, "events.jsonl"));
		const store = new TaskStore(events, harness.tempDir, () => {});
		const task = store.create({ title: "review fixture", cwd: harness.tempDir, scope: [], dependsOn: [], quotes: [], mode: "write", autoApprove: true }).task;
		const run = store.startRun(task.id, "dispatch", "faux");
		const audit = new AuditLog(join(harness.tempDir, "audit.jsonl"), events);
		return { harness, events, store, task, run, audit };
	}

	it("PR history search returns a message that authorization cannot resolve", async () => {
		const { harness } = await setup();
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const events = new EventLog(paths.eventsFile);
		events.append("chat_message", { n: 1, role: "user", at: 1000, text: "Publish this repository", delivery: { status: "done" } });
		events.append("chat_reset", { conversationId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
		events.append("chat_message", { n: 2, role: "user", at: 2000, text: "Continue the previous request" });
		const models = new ModelStore(paths.modelsFile); await models.whenReady();
		const main = new MainAgent(paths, events, () => {}, { models });
		try {
			expect(main.search({ id: "#1" }).messages).toHaveLength(1);
			expect(main.quote({ id: "#1" })).toBeNull();
			expect(() => freezeQuotes({ quote: ref => main.quote(ref) }, [{ id: "#1" }])).toThrow("无法引用");

		} finally { await main.dispose(); events.close(); }
	});

	it("oversized generic gates preserve exact evidence and require user review", async () => {
		const { events, store, task, run, audit } = await setup();
		const relay = new Relay({ isBusy: () => false, canReceiveRelay: () => false, sendRelay: async () => {}, addSystemLine: () => {} }, events, store);
		const gates = new GateService({ events, store, audit, quote: () => null, notice: () => {}, requested: (task, gate) => { relay.enqueue({ kind: "gate_request", task, gate }); } });
		const text = "payload".repeat(150000);
		const waiting = gates.request(task, run.id, "call", "mcp__fixture__publish", { text }, { action: "Publish document", scope: ["document"], alternative: "Do not publish" });
		const stateBytes = bytes(rallyState(store, 1, 3, true));
		const gate = task.gates![0];
		expect(gate.userOnly).toBe(true);
		expect(JSON.parse(readFileSync(gate.detailsFile!.path, "utf8")).arguments.text).toBe(text);
		expect(() => gates.decide(gate.id, "allow", "main", [], "test")).toThrow("必须由用户");
		expect(stateBytes).toBeLessThan(26000); expect(events.ofKind("relay_enqueued")).toHaveLength(0);

		gates.decide(task.gates![0].id, "deny", "user", [], "review only"); await waiting;
		gates.dispose(); relay.dispose(); events.close();
	});

	it("rejects oversized reports before mutation", async () => {
		const { events, store, task, run } = await setup();
		expect(() => store.report(task.id, run.id, "blocked", "Short summary", "Q".repeat(1000000))).toThrow("question");
		expect(task.attention).toBeUndefined();
		const stateBytes = bytes(rallyState(store, 1, 3, false));
		expect(stateBytes).toBeLessThan(26000);

		events.close();
	});

	it("pages changed files independently and reports only count and examples", async () => {
		const { events, store, task, harness } = await setup();
		store.recordChangedFiles(task.id, Array.from({ length: 10000 }, (_, i) => join(harness.tempDir, "node_modules", `module-${i}`, "dist", "index.js")));
		const page = readTask(store, task, { view: "files", limit: 1 });
		const report = readTask(store, task, { view: "report" });
		expect(Array.isArray(page.changedFiles) && page.changedFiles.length).toBe(1);
		expect(bytes(page)).toBeLessThan(4096); expect(report.changedFilesCount).toBe(10000);
		expect(page.changedFilesPaging).toMatchObject({ total: 10000, nextOffset: 1 });

		events.close();
	});

	it("delete audit storage grows linearly and survives restart", async () => {
		const { events, store, task, run, harness } = await setup();
		const size = () => readdirSync(harness.tempDir).filter(name => name.startsWith("events") && name.endsWith(".jsonl")).reduce((total, name) => total + statSync(join(harness.tempDir, name)).size, 0);
		let first = 0;
		for (let i = 0; i < 400; i++) {
			store.recordAccess(task.id, { toolCallId: "delete", runId: run.id, tool: "file_delete", kind: "fs_delete", at: 1, target: `/repo/node_modules/${String(i).padStart(5, "0")}/dist/${"x".repeat(45)}.js` });
			if (i === 199) first = size();
		}
		const second = size();
		expect(second / first).toBeLessThan(2.1);
		expect(new TaskStore(events, harness.tempDir, () => {}).get(task.id)!.changedFiles).toHaveLength(400);

		events.close();
	});

	it("schedule tool pages summaries and leaves frozen background on demand", async () => {
		const { events, store, harness } = await setup();
		const schedules = new ScheduledTasks(events, store, () => false, () => {});
		const context: TaskContext[] = Array.from({ length: 15 }, (_, i) => ({ source: "chat", id: `#${i + 1}`, role: "user", turnId: `#${i + 1}`, text: "B".repeat(4000), at: 1 }));
		for (let i = 0; i < 10; i++) schedules.create({ title: `Plan ${i}`, cwd: harness.tempDir, mode: "readonly", timing: { kind: "interval", minutes: 60 }, context }, [{ messageId: "#1", kind: "user", text: "Every hour", at: 1 }]);
		const tool = createScheduleTools(() => schedules, () => null).find(tool => tool.name === "schedule_list")!;
		const resultBytes = bytes(await tool.execute("list", {}, undefined, undefined, {} as ExtensionToolContext));
		expect(resultBytes).toBeLessThan(16000);

		schedules.dispose(); events.close();
	});

	it("external notebook edits cannot bypass injection budgets", async () => {
		const { events, audit, harness } = await setup();
		const directory = join(harness.tempDir, "memory"); mkdirSync(directory);
		writeFileSync(join(directory, "USER.md"), "M".repeat(500000));
		const memory = new MemoryStore(directory, events, audit);
		const state = memory.context();
		expect(bytes(state)).toBeLessThan(3000);
		expect(state).toContain("unavailable"); expect(state).toContain("MEMORY_OVER_BUDGET");
		expect(readFileSync(join(directory, "USER.md"), "utf8")).toHaveLength(500000);

		events.close();
	});

	it("late oversized snapshots are stopped before any provider request", async () => {
		const harness = await createHarness({ models: [{ id: "tiny", contextWindow: 4096, maxTokens: 256 }], settings: { compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 256 } } });
		harnesses.push(harness);
		const transform = harness.session.agent.transformContext;
		harness.session.agent.transformContext = async (messages, signal) => [...(transform ? await transform(messages, signal) : messages), { role: "custom", customType: "rally-state", display: false, timestamp: 1, content: "S".repeat(200000) }];
		let incomingChars = 0;
		harness.setResponses([context => {
			incomingChars = context.messages.map(getMessageText).join("\n").length;

			return fauxAssistantMessage([fauxText("offline response")]);
		}]);
		await harness.session.sendUserMessage("hello");
		expect(incomingChars).toBe(0);
		expect(JSON.stringify(harness.session.messages)).toContain("CONTEXT_BUDGET_EXCEEDED");

	});

	it("summarizes an oversized legacy result in bounded chunks with combined usage", async () => {
		const harness = await createHarness({ models: [{ id: "small", contextWindow: 4096, maxTokens: 512 }] });
		harnesses.push(harness);
		let calls = 0;
		const source = "SOURCE_START " + "large historical output ".repeat(3000) + " SOURCE_END";
		let seen = "";
		const result = await completeSummarization(harness.getModel(), normalizeContext({ messages: [{ role: "user", content: source, timestamp: 1 }] }), {}, (_model, context) => {
			calls++;
			expect(context.messages.reduce((sum, message) => sum + estimateTokens(message), 0)).toBeLessThan(3072);
			seen += context.messages.map(getMessageText).join("\n");
			const stream = createAssistantMessageEventStream();
			const message = fauxAssistantMessage("rolling summary");
			message.usage.input = 10;
			queueMicrotask(() => { stream.push({ type: "done", reason: "stop", message }); stream.end(message); });
			return stream;
		});
		expect(calls).toBeGreaterThan(1);
		expect(seen).toContain("SOURCE_START");
		expect(seen).toContain("SOURCE_END");
		expect(result.usage.input).toBe(calls * 10);
	});

	it("deletion dry-run saves full risks and bounds every list", async () => {
		const { events, store, task, run, audit, harness } = await setup();
		const cwd = join(harness.tempDir, "cwd"); mkdirSync(cwd); task.cwd = cwd;
		const outside = join(harness.tempDir, "outside"); mkdirSync(outside);
		for (let i = 0; i < 600; i++) writeFileSync(join(outside, `${String(i).padStart(4, "0")}-${"f".repeat(70)}.txt`), "x");
		const gates = new GateService({ events, store, audit, quote: () => null, notice: () => {}, requested: () => {} });
		const tool = createFileDeleteTool({ task, run, store, gates, versions: new FileVersions(harness.sessionManager), isActive: () => true });
		const result = await tool.execute("preview", { paths: [outside], recursive: true }, undefined, undefined, { cwd } as ExtensionToolContext);
		expect("preview" in result.details && result.details.preview).toHaveLength(50);
		expect("outsideCwd" in result.details && result.details.outsideCwd).toHaveLength(50);
		expect(result.details.outsideCwdCount).toBe(601);
		expect(bytes(result.content)).toBeLessThan(26000);

		gates.dispose(); events.close();
	});
});
