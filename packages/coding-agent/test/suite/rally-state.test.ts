import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { rallyState } from "../../../../src/main/supervisor/rally-state.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally dynamic state", () => {
	const harnesses: Harness[] = [];
	afterEach(() => { for (const h of harnesses.splice(0)) h.cleanup(); });
	async function setup() {
		const h = await createHarness(); harnesses.push(h);
		const events = new EventLog(join(h.tempDir, "events.jsonl"));
		const store = new TaskStore(events, h.tempDir, () => {});
		const create = (title: string) => store.create({ title, quotes: [{ messageId: "#1", kind: "user", text: "original", at: 1 }], cwd: h.tempDir, scope: ["src"], mode: "write", dependsOn: [], autoApprove: false }).task;
		return { events, store, create, dir: h.tempDir };
	}
	it("includes every open task, queue and pending action with exact question/gate fields", async () => {
		const { events, store, create } = await setup();
		for (let i = 0; i < 24; i++) create(`Pending ${i}`);
		const task = create("Question"); const run = store.startRun(task.id, "dispatch", "faux");
		store.report(task.id, run.id, "blocked", "x".repeat(500), "  Exact question?\n", [" A ", "B"]);
		store.escalateAttention(task.id, task.attention!.id);
		store.setQueue(task.id, "capacity");
		const now = Date.now();
		store.recordGate(task.id, { id: "G-1", runId: run.id, toolCallId: "call", tool: "git", action: "exact action", cwd: task.cwd, scope: ["a"], alternative: "keep", arguments: { args: ["restore", "a"] }, requestedAt: now, expiresAt: now + 10000 }, "gate_requested");
		const count = events.all().length;
		const raw = rallyState(store, 2, 2, false, now);
		const state = JSON.parse(raw.slice(raw.indexOf("\n") + 1));
		expect(state.tasks).toHaveLength(25); expect(state.capacity).toEqual({ active: 2, limit: 2 });
		expect(state.tasks.find((t: { id: string }) => t.id === task.id)).toMatchObject({ scope: ["src"], quoteIds: ["#1"], queue: { reason: "capacity" }, lastReport: { truncated: true } });
		expect(state.questions[0]).toMatchObject({ taskId: task.id, question: "  Exact question?\n", options: [" A ", "B"], waitingOn: "user" });
		expect(state.gates[0]).toMatchObject({ id: "G-1", action: "exact action", scope: ["a"], alternative: "keep", waitingOn: "main", arguments: { args: ["restore", "a"] } });
		expect(events.all()).toHaveLength(count);
		expect(JSON.parse(rallyState(store, 0, 2, true, now + 20000).split("\n")[1]).gates).toEqual([]);
		store.cancelRunning(task.id, "main");
		const ended = JSON.parse(rallyState(store, 0, 2, false).split("\n")[1]);
		expect(ended.questions).toEqual([]); expect(ended.gates).toEqual([]); expect(ended.tasks).toHaveLength(24);
		expect(ended.recentEnded[0]).toMatchObject({ id: task.id, outcome: "cancelled" });
	});
	it("excludes answered questions and gates belonging to ended runs after replay", async () => {
		const { store, create, dir } = await setup(); const task = create("stale"); const run = store.startRun(task.id, "dispatch", "faux");
		store.report(task.id, run.id, "blocked", "waiting", "question");
		store.answerAttention(task.id, task.attention!.id, "answer", "main", ["#1"]);
		expect(JSON.parse(rallyState(store, 0, 2, false).split("\n")[1]).questions).toEqual([]);
		store.endRunInterrupted(task.id, "interrupted");
		const recovered = new TaskStore(new EventLog(join(dir, "events.jsonl")), dir, () => {});
		const state = JSON.parse(rallyState(recovered, 0, 2, false).split("\n")[1]);
		expect(state.tasks[0].status).toBe("interrupted"); expect(state.questions).toEqual([]); expect(state.gates).toEqual([]);
	});
});
