import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { TaskSnapshot } from "../../../../src/main/supervisor/task-snapshot.ts";
import { ScheduledTasks } from "../../../../src/main/supervisor/schedules.ts";
import { Scheduler } from "../../../../src/main/supervisor/scheduler.ts";
import { rallyState } from "../../../../src/main/supervisor/rally-state.ts";
import { applyTask } from "../../../../src/shared/cloud-state.ts";
import type { TaskEvent } from "../../../../src/shared/ipc.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("task archiving and deletion (offline)", () => {
	const harnesses: Harness[] = []; const supervisors: Supervisor[] = [];
	afterEach(async () => {
		await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose()));
		vi.restoreAllMocks();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(join(harness.tempDir, "home")); ensureRallyDirs(paths);
		const updates: TaskEvent[] = [];
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: event => updates.push(event) }); supervisors.push(supervisor);
		const create = (dependsOn: string[] = []) => supervisor.store.create({ title: "归档测试", quotes: [], cwd: paths.workspaceDir, mode: "readonly", scope: [], dependsOn, autoApprove: false }).task;
		const archive = (id: string) => { supervisor.store.cancel(id, "system"); supervisor.archive(id, true); };
		return { paths, supervisor, create, archive, updates };
	}
	it.each(["interrupted", "blocked"] as const)("archives %s work without changing its outcome or restarting on restore", async status => {
		const { paths, supervisor, create } = await setup();
		const task = create();
		const run = supervisor.store.startRun(task.id, "dispatch", "offline");
		if (status === "interrupted") supervisor.store.endRunInterrupted(task.id, "interrupted");
		else supervisor.store.report(task.id, run.id, "blocked", "等待补充条件");
		expect(supervisor.board().tasks[0].status).toBe(status);
		const board = supervisor.archive(task.id, true);
		expect(board.tasks).toHaveLength(1);
		expect(board.tasks[0]).toMatchObject({ status, archivedAt: expect.any(Number), ended: undefined });
		const updatedBoard = applyTask(board, { type: "task", task: supervisor.store.view(task) });
		expect(applyTask(updatedBoard, { type: "task", task: supervisor.store.view(task) }).tasks).toHaveLength(1);
		const state = JSON.parse(rallyState(supervisor.store, 0, 2, false).split("\n")[1]);
		expect(state.tasks).toEqual([]);
		expect(run).toMatchObject({ endedAt: expect.any(Number), endReason: status });
		expect(() => supervisor.store.steer(task.id, [], "继续")).toThrow("task_resume");
		supervisor.snapshot.flush();
		for (const records of [supervisor.events.all(), supervisor.snapshot.replay()]) {
			const store = new TaskStore(supervisor.events, paths.workspaceDir, () => {}, undefined, records);
			const restored = store.get(task.id)!;
			const start = vi.fn(async () => {});
			const wake = vi.fn();
			const scheduler = new Scheduler({ store, events: supervisor.events, activeIds: () => [], pendingIds: () => [task.id], start, wake, onDependencyFailed: vi.fn() });
			try {
				expect(store.board(0, 2).tasks).toHaveLength(1);
				expect(restored.archivedAt).toBeTypeOf("number");
				// Approved tasks must remain idle both in the archive and after restoration.
				store.approve(task.id, "button", []);
				scheduler.tick();
				store.archive(task.id, false);
				scheduler.tick();
				expect(store.board(0, 2).tasks[0]).toMatchObject({ status, archivedAt: undefined });
				expect(start).not.toHaveBeenCalled();
				expect(wake).not.toHaveBeenCalled();
				store.archive(task.id, true);
				store.resume(task.id, { autoApprove: true, note: "继续任务" });
				scheduler.tick();
				expect(restored.archivedAt).toBeUndefined();
				expect(start).toHaveBeenCalledOnce();
				expect(restored.runs).toHaveLength(2);
			} finally { scheduler.dispose(); }
		}
	});
	it.each(["interrupted", "blocked"] as const)("deletes archived %s work while protecting unfinished dependants", async status => {
		const { supervisor, create, archive } = await setup();
		const task = create();
		const run = supervisor.store.startRun(task.id, "dispatch", "offline");
		if (status === "interrupted") supervisor.store.endRunInterrupted(task.id, "interrupted");
		else supervisor.store.report(task.id, run.id, "blocked", "等待补充条件");
		supervisor.archive(task.id, true);
		const child = create([task.id]);
		await expect(supervisor.deleteArchived(task.id)).rejects.toThrow("依赖");
		archive(child.id);
		await supervisor.deleteArchived(task.id);
		expect(supervisor.store.get(task.id)).toBeUndefined();
	});
	it("rejects archiving pending, running, answering, or still-streaming workers", async () => {
		const { supervisor, create } = await setup();
		const task = create();
		expect(() => supervisor.archive(task.id, true)).toThrow("请先");
		const run = supervisor.store.startRun(task.id, "dispatch", "offline");
		supervisor.store.report(task.id, run.id, "progress", "进行中");
		expect(() => supervisor.archive(task.id, true)).toThrow("请先");
		const result = supervisor.store.report(task.id, run.id, "blocked", "等待选择", "选择哪个？");
		supervisor.store.escalateAttention(task.id, result.attention!.id);
		expect(() => supervisor.archive(task.id, true)).toThrow("请先");
		supervisor.store.report(task.id, run.id, "blocked", "已停止", null);
		const streaming = vi.spyOn(supervisor.workers, "streamingIds").mockReturnValue([task.id]);
		expect(() => supervisor.archive(task.id, true)).toThrow("仍在执行");
		streaming.mockRestore();
		supervisor.store.recordJob({ id: "J-1", taskId: task.id, runId: run.id, shell: "powershell", command: "fixture", cwd: task.cwd, status: "running", startedAt: 1 }, "job_started");
		expect(() => supervisor.archive(task.id, true)).toThrow();
		expect(task.archivedAt).toBeUndefined();
		expect(run.endedAt).toBeUndefined();
	});
	it("permanently removes archived tasks and private files, preserves user outputs, and survives both recovery paths", async () => {
		const { paths, supervisor, create, archive, updates } = await setup(); const task = create();
		const session = join(paths.sessionsTasksDir, `${task.id}.jsonl`);
		writeFileSync(session, "PRIVATE_WORKER_SESSION");
		mkdirSync(task.outputDir, { recursive: true }); const output = join(task.outputDir, "report.md"); writeFileSync(output, "USER_OUTPUT");
		supervisor.store.recordJob({ id: "J-91", taskId: task.id, runId: "R-1", shell: "powershell", command: "fixture", cwd: task.cwd, status: "exited", startedAt: 1 }, "job_exited");
		supervisor.store.recordService({ id: "S-92", taskId: task.id, runId: "R-1", name: "fixture", command: "fixture", cwd: task.cwd, status: "stopped", ready: false, startedAt: 1 }, "service_stopped");
		for (const name of ["J-91.log", "S-92.log"]) writeFileSync(join(paths.jobsDir, name), "PRIVATE_LOG");
		supervisor.store.recordAssistant(task.id, { id: "A-1", runId: "R-1", text: "PRIVATE_MESSAGE", blocks: [{ type: "text", text: "PRIVATE_MESSAGE" }], at: 1, streaming: false }, true);
		archive(task.id); supervisor.snapshot.flush();
		await supervisor.deleteArchived(task.id);
		expect(supervisor.store.get(task.id)).toBeUndefined(); expect(supervisor.board().tasks).toHaveLength(0);
		expect(existsSync(session)).toBe(false); expect(existsSync(join(paths.jobsDir, "J-91.log"))).toBe(false); expect(existsSync(join(paths.jobsDir, "S-92.log"))).toBe(false);
		expect(readFileSync(output, "utf8")).toBe("USER_OUTPUT"); expect(updates.at(-1)).toMatchObject({ type: "deleted", taskId: task.id });
		expect(() => supervisor.store.resume(task.id, {})).toThrow("任务不存在");
		// Late old facts cannot resurrect a deleted task, even in the snapshot cache.
		supervisor.events.append("task_updated", { task }); supervisor.snapshot.flush();
		expect(readFileSync(paths.snapshotFile, "utf8")).not.toContain("PRIVATE_MESSAGE");
		await supervisor.dispose();
		const events = new EventLog(paths.eventsFile); const snapshot = new TaskSnapshot(paths.snapshotFile, events);
		try {
			for (const records of [events.all(), snapshot.replay()]) {
				const store = new TaskStore(events, paths.workspaceDir, () => {}, undefined, records);
				expect(store.list()).toHaveLength(0); expect(store.isDeleted(task.id)).toBe(true);
				expect(store.deletedResourceSequence("job")).toBe(91); expect(store.deletedResourceSequence("service")).toBe(92);
				const next = store.create({ ...task, autoApprove: false }).task; expect(Number(next.id.slice(2))).toBeGreaterThan(Number(task.id.slice(2)));
			}
		} finally { snapshot.dispose(); events.close(); }
	});
	it("rejects active/unarchived/referenced tasks and keeps restore and resume out of a pending deletion", async () => {
		const { supervisor, create, archive } = await setup(); const task = create();
		await expect(supervisor.deleteArchived(task.id)).rejects.toThrow("只能彻底删除");
		supervisor.store.cancel(task.id, "system"); await expect(supervisor.deleteArchived(task.id)).rejects.toThrow("只能彻底删除");
		supervisor.archive(task.id, true); const child = create([task.id]);
		await expect(supervisor.deleteArchived(task.id)).rejects.toThrow("依赖"); archive(child.id);
		let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
		vi.spyOn(supervisor.workers, "closeTask").mockImplementationOnce(() => wait);
		const pending = supervisor.deleteArchived(task.id);
		try {
			expect(() => supervisor.archive(task.id, false)).toThrow("正在删除");
			expect(() => supervisor.store.resume(task.id, {})).toThrow("正在删除");
			expect(() => create([task.id])).toThrow("正在删除");
			await expect(supervisor.deleteArchived(task.id)).rejects.toThrow("正在删除");
		} finally { release(); }
		await pending;
	});
	it("keeps a task recoverable when resource cleanup fails", async () => {
		const { supervisor, create, archive } = await setup(); const task = create(); archive(task.id);
		vi.spyOn(supervisor.workers, "closeTask").mockRejectedValueOnce(new Error("fixture cleanup failed"));
		await expect(supervisor.deleteArchived(task.id)).rejects.toThrow("fixture cleanup failed");
		expect(supervisor.store.get(task.id)).toBeDefined(); expect(supervisor.events.ofKind("task_deleted")).toHaveLength(0);
		expect(() => supervisor.archive(task.id, false)).not.toThrow();
	});
	it("continues the next scheduled worker after its last occurrence was deleted", async () => {
		const { paths, supervisor, archive } = await setup();
		let now = Date.now(); const schedules = new ScheduledTasks(supervisor.events, supervisor.store, () => false, () => {}, () => now);
		try {
			const plan = schedules.create({ title: "定时归档", mode: "readonly", cwd: paths.workspaceDir, timing: { kind: "interval", minutes: 1 } }, [{ messageId: "#1", text: "每分钟检查", kind: "user", at: now }]);
			now += 60000; schedules.poll(); const first = supervisor.store.list()[0]; archive(first.id); await supervisor.deleteArchived(first.id);
			expect(schedules.list()[0]).toMatchObject({ lastTaskDeleted: true, enabled: true });
			now += 60000; schedules.poll(); const next = supervisor.store.list()[0]; expect(next.id).not.toBe(first.id);
			expect(supervisor.board().tasks[0].schedule).toEqual({ id: plan.id, dueAt: now, timing: { kind: "interval", minutes: 1 }, revision: 1 });
			expect(schedules.list()[0].lastTaskDeleted).toBe(false);
		} finally { schedules.dispose(); }
	});
});
