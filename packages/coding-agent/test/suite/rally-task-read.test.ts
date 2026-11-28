import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionToolContext, ToolDefinition } from "../../src/index.ts";
import type { Task, TaskRun } from "../../../../src/shared/task.ts";
import type { TaskGate } from "../../../../src/shared/gate.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { createMainTaskTools, createWorkerTools, type TaskToolHost } from "../../../../src/main/supervisor/tools.ts";
import { modelTaskCard, readTask, type TaskReadParams } from "../../../../src/main/supervisor/task-read.ts";
import { createHarness, getMessageText } from "./harness.ts";

describe("compact model task views", () => {
	const cleanups: (() => void)[] = [];
	afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

	async function setup() {
		const harness = await createHarness();
		const events = new EventLog(join(harness.tempDir, "events.jsonl"));
		const store = new TaskStore(events, harness.tempDir, () => {});
		cleanups.push(() => { events.close(); harness.cleanup(); });
		const create = (dependsOn: string[] = []) => store.create({ title: "Task read regression", cwd: harness.tempDir, mode: "write", scope: [join(harness.tempDir, "src")],
			quotes: [{ messageId: "#1", kind: "user", text: "ORIGINAL_REQUIREMENT", at: 1 }], note: "ROUTING_NOTE", dependsOn, autoApprove: false,
			context: [{ source: "memory", file: "USER", text: "FROZEN_BACKGROUND" }] }).task;
		const host: TaskToolHost = { store, workspaceDir: harness.tempDir, autoApprove: () => false, quote: () => null,
			tick() {}, deliverSteer: () => "queued_for_worker", deliverAnswer: () => "queued_for_worker", abortWorker() {},
			board: () => store.board(1, 3), roleWorker: () => undefined };
		const main = createMainTaskTools(host).find(tool => tool.name === "task_read")!;
		return { store, events, create, main };
	}

	function call(tool: ToolDefinition, params: TaskReadParams = {}) {
		return tool.execute("read-fixture", params, undefined, undefined, {} as ExtensionToolContext);
	}
	function fillHistory(task: Task, run: TaskRun, count: number) {
		task.jobs = Array.from({ length: count }, (_, index) => ({ id: `J-${index + 1}`, taskId: task.id, runId: run.id, shell: "bash", command: "OLD_COMMAND_" + "x".repeat(1000),
			cwd: task.cwd, status: "exited", startedAt: index, endedAt: index + 1, exitCode: 0 }));
		task.services = [{ id: "S-1", taskId: task.id, runId: run.id, name: "preview", command: "SERVICE_COMMAND", cwd: task.cwd, status: "running", ready: true, startedAt: 1 }];
		task.inputs = [{ id: "I-1", kind: "job_done", jobId: "J-1", body: "JOB_OUTPUT_" + "z".repeat(60000), at: 1 }];
		task.attentionHistory = [{ id: "Q-old", runId: run.id, question: "OLD_QUESTION", askedAt: 1, answer: { by: "user", basis: ["#2"], text: "OLD_ANSWER", at: 2 } }];
		task.gates = [gate(run, { id: "G-old", arguments: { command: "OLD_GATE_ARGUMENT" }, decision: { value: "deny", actor: "user", basis: [], reason: "OLD_GATE_REASON", at: 2 } })];
		task.changedFiles = Array.from({ length: count }, (_, index) => `CHANGED_FILE_${index}`);
		run.lastReport = { state: "progress", summary: "REPORT_PROSE_" + "s".repeat(8000), at: 2 };
	}
	function gate(run: TaskRun, patch: Partial<TaskGate> = {}): TaskGate {
		return { id: "G-pending", runId: run.id, toolCallId: "gate-call", tool: "git", action: "REQUESTED_ACTION", cwd: "fixture", scope: [],
			alternative: "keep files", arguments: {}, requestedAt: 1, expiresAt: Date.now() + 60000, ...patch };
	}

	it("keeps board/card small as command and notification history grows while the UI retains full records", async () => {
		const { store, create, main } = await setup();
		const task = create(); const run = store.startRun(task.id, "dispatch", "offline");
		fillHistory(task, run, 1);
		const small = getMessageText(await call(main, { taskId: task.id }));
		fillHistory(task, run, 109);
		const before = JSON.stringify(task);
		const card = getMessageText(await call(main, { taskId: task.id }));
		const board = getMessageText(await call(main));
		expect(card.length).toBeLessThan(2500); expect(board.length).toBeLessThan(2500);
		expect(card.length - small.length).toBeLessThan(20);
		for (const text of [card, board]) {
			for (const marker of ["OLD_COMMAND", "SERVICE_COMMAND", "JOB_OUTPUT", "ORIGINAL_REQUIREMENT", "ROUTING_NOTE", "FROZEN_BACKGROUND", "OLD_QUESTION", "OLD_ANSWER", "OLD_GATE_ARGUMENT", "OLD_GATE_REASON", "REPORT_PROSE", "CHANGED_FILE"]) expect(text).not.toContain(marker);
		}
		expect(JSON.parse(card).card).toMatchObject({ id: task.id, cwd: task.cwd, scope: task.scope, jobs: { total: 109, running: 0 }, services: { total: 1, running: 1 },
			counts: { inputs: 1, context: 1, requirements: 1, changedFiles: 109 }, lastReport: { state: "progress", at: 2 } });
		expect(JSON.stringify(task)).toBe(before);
		const ui = store.board(1, 3).tasks[0];
		expect(ui.jobs).toHaveLength(109); expect(ui.inputs?.[0].body).toContain("JOB_OUTPUT"); expect(ui.lastReport?.summary).toContain("REPORT_PROSE");
	});

	it("returns exact historical details only through the requested paginated view", async () => {
		const { store, create, main } = await setup();
		const task = create(); const run = store.startRun(task.id, "dispatch", "offline"); fillHistory(task, run, 109);
		const first = JSON.parse(getMessageText(await call(main, { taskId: task.id, view: "jobs", limit: 2 })));
		expect(first).toMatchObject({ offset: 0, total: 109, nextOffset: 2 });
		expect(first.jobs.map((job: { id: string }) => job.id)).toEqual(["J-109", "J-108"]);
		expect(first.jobs[0].command).toBe(task.jobs![108].command);
		const last = JSON.parse(getMessageText(await call(main, { taskId: task.id, view: "jobs", offset: 108, limit: 2 })));
		expect(last).toMatchObject({ nextOffset: null, jobs: [{ id: "J-1" }] });
		for (const [view, field, expected] of [
			["services", "services", task.services], ["inputs", "inputs", task.inputs], ["context", "context", task.context],
			["requirements", "quotes", task.quotes], ["questions", "questions", task.attentionHistory], ["gates", "gates", task.gates],
		] as const) {
			const result = JSON.parse(getMessageText(await call(main, { taskId: task.id, view, limit: 1 })));
			expect(result[field]).toEqual(expected); expect(result).toMatchObject({ offset: 0, total: 1, nextOffset: null });
			expect((await call(main, { taskId: task.id, view, offset: -1 })).isError).toBe(true);
		}
		expect(JSON.parse(getMessageText(await call(main, { taskId: task.id, view: "requirements" }))).note).toBe(task.note);
		expect(JSON.parse(getMessageText(await call(main, { taskId: task.id, view: "report" }))).report.summary).toBe(run.lastReport!.summary);
	});

	it("keeps actionable state visible without replaying gate arguments or resolved questions", async () => {
		const { store, create } = await setup(); const task = create(); const run = store.startRun(task.id, "dispatch", "offline");
		task.jobs = [{ id: "J-live", taskId: task.id, runId: run.id, shell: "bash", command: "not on card", cwd: task.cwd, status: "running", startedAt: 1 }];
		task.gates = [gate(run), gate(run, { id: "G-expired", expiresAt: 1 }), gate(run, { id: "G-old-run", runId: "old-run" })];
		task.attention = { id: "Q-current", runId: run.id, askedAt: 1, question: "CURRENT_QUESTION", escalatedAt: 2 };
		expect(modelTaskCard(task)).toMatchObject({ status: "needs_gate", pendingGates: 1, attention: { id: "Q-current", waitingOn: "user" }, jobs: { total: 1, running: 1 } });
		task.gates[0].decision = { value: "deny", actor: "user", basis: [], reason: "no", at: 3 };
		expect(modelTaskCard(task)).toMatchObject({ status: "needs_answer", pendingGates: 0 });
		expect(readTask(store, task, { view: "report" })).toMatchObject({ attention: { question: "CURRENT_QUESTION" } });
		task.attention.answer = { by: "user", basis: [], text: "ANSWER_BODY", at: 4 };
		expect(modelTaskCard(task).attention).toBeUndefined();
		task.ended = { outcome: "done", by: "worker", at: 5, reason: "LONG_FINAL_SUMMARY" };
		expect(modelTaskCard(task)).toMatchObject({ status: "done", ended: { outcome: "done", at: 5 } });
		expect(JSON.stringify(modelTaskCard(task))).not.toMatch(/LONG_FINAL_SUMMARY|ANSWER_BODY|REQUESTED_ACTION/);
	});

	it("preserves worker visibility and desktop-only gate redaction in the new detail views", async () => {
		const { store, create } = await setup();
		const upstream = create(), own = create([upstream.id]), unrelated = create();
		const run = store.startRun(upstream.id, "dispatch", "offline"); fillHistory(upstream, run, 2);
		upstream.gates = [gate(run, { userOnly: true, arguments: { text: "DESKTOP_ONLY_SECRET" }, action: "PRIVATE_ACTION" })];
		const worker = createWorkerTools({ store, taskId: own.id, dependsOn: own.dependsOn, report: () => ({ taskId: own.id, ended: false, notifiedMain: false }) }).find(tool => tool.name === "task_read")!;
		expect(JSON.parse(getMessageText(await call(worker))).card.id).toBe(own.id);
		expect(getMessageText(await call(worker, { taskId: upstream.id }))).not.toMatch(/OLD_COMMAND|FROZEN_BACKGROUND|DESKTOP_ONLY_SECRET|PRIVATE_ACTION/);
		for (const view of ["board", "services", "context"] as const) expect((await call(worker, { taskId: upstream.id, view })).isError).toBe(true);
		for (const view of ["jobs", "inputs", "requirements", "questions", "gates"] as const) expect((await call(worker, { taskId: unrelated.id, view })).isError).toBe(true);
		expect(JSON.parse(getMessageText(await call(worker, { view: "context" }))).context).toEqual(own.context);
		expect(JSON.parse(getMessageText(await call(worker, { taskId: upstream.id, view: "jobs", limit: 1 }))).jobs[0].id).toBe("J-2");
		const gates = getMessageText(await call(worker, { taskId: upstream.id, view: "gates" }));
		expect(gates).toContain('"userOnly":true'); expect(gates).not.toMatch(/DESKTOP_ONLY_SECRET|PRIVATE_ACTION/);
	});

	it("retains full persisted records after compact reads and restart", async () => {
		const { store, events, create, main } = await setup(); const task = create(); const run = store.startRun(task.id, "dispatch", "offline");
		fillHistory(task, run, 109);
		store.recordJob(task.jobs![0], "job_exited");
		await call(main); await call(main, { taskId: task.id });
		const restored = new TaskStore(events, task.cwd, () => {}); const recovered = restored.get(task.id)!;
		expect(recovered.jobs).toEqual(task.jobs); expect(recovered.inputs).toEqual(task.inputs); expect(recovered.context).toEqual(task.context);
		expect(JSON.stringify(readTask(restored, recovered, { view: "card" })).length).toBeLessThan(2500);
		expect(readTask(restored, recovered, { view: "jobs", offset: 108 })).toMatchObject({ jobs: [task.jobs![0]], total: 109, nextOffset: null });
	});
});
