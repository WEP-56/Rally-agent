import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { taskView } from "../../../../src/shared/task.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally questions (isolated state, no provider calls)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
		const events = new EventLog(paths.eventsFile);
		const audit = new AuditLog(paths.auditFile, events);
		const store = new TaskStore(events, paths.workspaceDir, () => {}, audit);
		const task = store.create({ title: "提问测试", cwd: paths.workspaceDir, quotes: [], scope: [], dependsOn: [], mode: "readonly", autoApprove: false }).task;
		const run = store.startRun(task.id, "dispatch", "faux");
		const ask = (question = "  保留 <v1> 吗？\n", options: string[] | undefined = ["保留", "移除"]) => store.report(task.id, run.id, "blocked", "需要选择", question, options);
		return { paths, events, audit, store, task, run, ask };
	}

	it("preserves exact text/options, deduplicates repeated reports and returns an existing answer", async () => {
		const { store, task, ask, events, run } = await setup();
		const options = ["保留", "移除"];
		const first = ask(undefined, options).attention!;
		options[0] = "篡改";
		expect(first.question).toBe("  保留 <v1> 吗？\n"); expect(first.options).toEqual(["保留", "移除"]);
		store.escalateAttention(task.id, first.id);
		const repeated = store.report(task.id, run.id, "blocked", "再次提交", first.question);
		expect(repeated).toMatchObject({ attentionOpened: false, attention: { id: first.id, escalatedAt: first.escalatedAt } });
		expect(events.ofKind("attention_opened")).toHaveLength(1);
		store.answerAttention(task.id, first.id, "保留", "user", []);
		expect(task.attention).toBeUndefined();
		expect(ask()).toMatchObject({ attentionOpened: false, attention: { id: first.id, answer: { text: "保留" } } });
		expect(task.inputs).toHaveLength(1);
		expect(task.inputs[0]).toMatchObject({ kind: "answer", questionId: first.id, body: "保留" });
		expect(() => store.answerAttention(task.id, first.id, "移除", "user", [])).toThrow("失效");
		const changed = ask(undefined, ["暂存", "移除"]).attention!;
		store.escalateAttention(task.id, changed.id);
		store.answerAttention(task.id, changed.id, "暂存", "user", []);
		expect(ask()).toMatchObject({ attentionOpened: false, attention: { id: first.id, answer: { text: "保留" } } });
		expect(task.inputs).toHaveLength(2);
	});

	it("replaces changed options, ignores obsolete fallback and rejects stale or forged button answers", async () => {
		const { store, task, ask } = await setup();
		const first = ask().attention!;
		store.escalateAttention(task.id, first.id);
		const second = ask(undefined, ["保留兼容层", "移除"]).attention!;
		expect(second.id).not.toBe(first.id);
		expect(task.attentionHistory?.[0]).toMatchObject({ id: first.id, closed: { reason: "replaced" } });
		store.fallbackQuestions([first.id]);
		expect(second.escalatedAt).toBeUndefined();
		expect(() => store.answerAttention(task.id, first.id, "保留", "user", [])).toThrow("失效");
		expect(() => store.answerAttention(task.id, second.id, "移除", "user", [])).toThrow("原始选项");
		store.fallbackQuestions([second.id]);
		expect(taskView(task).status).toBe("needs_answer");
		expect(() => store.answerAttention(task.id, second.id, "任意伪造回答", "user", [])).toThrow("原始选项");
		expect(task.inputs).toHaveLength(0);
	});

	it("retains omitted questions, withdraws explicit null and closes on terminal reports", async () => {
		const { store, task, run, ask } = await setup();
		const first = ask().attention!;
		store.escalateAttention(task.id, first.id);
		store.report(task.id, run.id, "progress", "仍在调查");
		expect(task.attention?.id).toBe(first.id);
		store.report(task.id, run.id, "progress", "已无疑问", null);
		expect(task.attentionHistory?.[0].closed?.reason).toBe("cleared");
		store.fallbackQuestions([first.id]);
		expect(task.attention).toBeUndefined();
		const second = ask("另一个问题").attention!;
		store.report(task.id, run.id, "ready", "完成");
		expect(task.attentionHistory?.at(-1)?.closed?.reason).toBe("task_ended");
		expect(() => store.escalateAttention(task.id, second.id)).toThrow("失效");
	});

	it("persists answered history and audit basis before clearing the current question", async () => {
		const { store, task, ask, paths, events } = await setup();
		const first = ask().attention!;
		expect(() => store.answerAttention(task.id, first.id, "无依据", "main", [])).toThrow("原话");
		store.answerAttention(task.id, first.id, "[#12]\n> 用户逐字原话", "main", ["#12"]);
		expect(events.ofKind("attention_answered")[0].data).toMatchObject({ questionId: first.id, task: { attentionHistory: [{ answer: { basis: ["#12"] } }] } });
		const audit = JSON.parse(readFileSync(paths.auditFile, "utf8").trim());
		expect(audit).toMatchObject({ kind: "answer", taskId: task.id, questionId: first.id, actor: "main", basis: ["#12"], text: "[#12]\n> 用户逐字原话" });
		const replay = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(replay.get(task.id)?.attention).toBeUndefined();
		expect(replay.get(task.id)?.attentionHistory).toEqual(task.attentionHistory);
	});

	it("fails closed on audit errors without consuming the question or approving/cancelling the task", async () => {
		const { store, task, audit, ask } = await setup();
		const question = ask().attention!;
		vi.spyOn(audit, "append").mockImplementation(() => { throw new Error("audit unavailable"); });
		expect(() => store.answerAttention(task.id, question.id, "用户原话", "main", ["#12"])).toThrow("audit unavailable");
		expect(task.attention?.answer).toBeUndefined(); expect(task.inputs).toHaveLength(0);
		expect(() => store.approve(task.id, "button", [])).toThrow("audit unavailable");
		expect(task.approval.state).toBe("pending");
		expect(() => store.cancelRunning(task.id, "main", { actor: "user", basis: [] })).toThrow("audit unavailable");
		expect(task.ended).toBeUndefined(); expect(task.runs[0].endedAt).toBeUndefined();
	});

	it("invalidates questions on interruption/cancellation and never reuses an old run's answer or ID", async () => {
		const { store, task, ask, paths } = await setup();
		const first = ask().attention!;
		store.escalateAttention(task.id, first.id);
		const replay = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		replay.endRunInterrupted(task.id, "interrupted");
		expect(replay.get(task.id)?.attentionHistory?.[0].closed?.reason).toBe("run_ended");
		expect(() => replay.answerAttention(task.id, first.id, "保留", "user", [])).toThrow("失效");
		replay.resume(task.id, { autoApprove: true });
		const next = replay.startRun(task.id, "resume", "faux");
		const second = replay.report(task.id, next.id, "blocked", "再问", first.question, first.options).attention!;
		expect(second.id).not.toBe(first.id); expect(second.answer).toBeUndefined();
		replay.cancelRunning(task.id, "system");
		expect(replay.get(task.id)?.attention).toBeUndefined();
		expect(replay.get(task.id)?.attentionHistory?.at(-1)?.closed?.reason).toBe("task_ended");
		expect(() => replay.escalateAttention(task.id, second.id)).toThrow("失效");
	});

	it("retains main-chat question records after their task leaves the recent board and after restart", async () => {
		const { store, task, ask, paths } = await setup();
		const first = ask().attention!;
		store.escalateAttention(task.id, first.id);
		store.answerAttention(task.id, first.id, "保留", "user", []);
		store.cancelRunning(task.id, "system");
		for (let n = 0; n < 21; n++) {
			const next = store.create({ title: "后续任务", cwd: paths.workspaceDir, quotes: [], scope: [], dependsOn: [], mode: "readonly", autoApprove: false }).task;
			store.cancelRunning(next.id, "system");
		}
		const replay = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		const board = replay.board(0, 2);
		expect(board.tasks).toHaveLength(20); expect(board.tasks.some((item) => item.id === task.id)).toBe(false);
		expect(board.questions).toMatchObject([{ taskId: task.id, question: { id: first.id, answer: { text: "保留" } } }]);
	});
});
