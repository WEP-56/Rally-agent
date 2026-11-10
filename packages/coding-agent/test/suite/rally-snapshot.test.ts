import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskSnapshot } from "../../../../src/main/supervisor/task-snapshot.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally task snapshots", () => {
	const harnesses: Harness[] = []; const caches: TaskSnapshot[] = [];
	afterEach(() => { for (const c of caches.splice(0)) c.dispose(); vi.useRealTimers(); for (const h of harnesses.splice(0)) h.cleanup(); });
	async function setup() {
		const h = await createHarness(); harnesses.push(h);
		const file = join(h.tempDir, "snapshot.json"); const eventFile = join(h.tempDir, "events-0001.jsonl");
		const events = new EventLog(eventFile, 512);
		const cache = new TaskSnapshot(file, events); caches.push(cache);
		const store = new TaskStore(events, h.tempDir, () => {});
		const create = () => store.create({ title: "snapshot", quotes: [], cwd: h.tempDir, scope: [], dependsOn: [], mode: "write", autoApprove: false }).task;
		const recover = () => {
			const log = new EventLog(eventFile, 512); const snapshot = new TaskSnapshot(file, log); caches.push(snapshot);
			return { log, snapshot, store: new TaskStore(log, h.tempDir, () => {}, undefined, snapshot.replay()), full: new TaskStore(log, h.tempDir, () => {}) };
		};
		return { dir: h.tempDir, file, events, eventFile, cache, store, create, recover };
	}
	it("restores cached task/tool/message/access state plus uncached tail exactly as full replay", async () => {
		const { cache, store, create, recover, events } = await setup(); const task = create(); const run = store.startRun(task.id, "dispatch", "faux");
		store.report(task.id, run.id, "blocked", "waiting", "exact question", ["yes", "no"]);
		store.recordTool(task.id, { id: "tool", runId: run.id, name: "write", input: "a", status: "running", startedAt: 1 });
		store.recordTool(task.id, { id: "tool", runId: run.id, name: "write", input: "a", status: "ok", startedAt: 1, endedAt: 2 });
		store.recordAssistant(task.id, { id: "message", runId: run.id, at: 1, text: "saved", blocks: [{ type: "text", text: "saved" }], streaming: false }, true);
		store.recordAccess(task.id, { toolCallId: "write", runId: run.id, tool: "write", at: 1, kind: "fs_write", target: "a" });
		expect(cache.flush()).toBe(true); const seq = events.lastSeq();
		store.answerAttention(task.id, task.attention!.id, "yes", "main", ["#1"]);
		store.endRunInterrupted(task.id, "interrupted");
		const result = recover(); expect(result.snapshot.loadedSeq).toBe(seq);
		expect(result.store.board(0, 2, 100)).toEqual(result.full.board(0, 2, 100)); expect(result.store.access(task.id)).toEqual(result.full.access(task.id));
		expect(result.snapshot.replay().length).toBeLessThan(result.log.all().length);
		expect(result.store.create({ title: "next", quotes: [], cwd: task.cwd, scope: [], dependsOn: [], mode: "readonly", autoApprove: false }).task.id).not.toBe(task.id);
	});
	it("preserves the one stall retry through snapshots and replay, with a new allowance on explicit resume", async () => {
		const { cache, store, create, recover, events } = await setup(); const task = create(); const run = store.startRun(task.id, "dispatch", "faux");
		expect(store.recordStallRetry(task.id, run.id)).toBe(true); expect(store.recordStallRetry(task.id, run.id)).toBe(false); expect(events.ofKind("run_stall_retry")).toHaveLength(1); cache.flush();
		const restored = recover(); expect(restored.store.get(task.id)?.runs[0].stallRetries).toBe(1); expect(restored.store.recordStallRetry(task.id, run.id)).toBe(false);
		restored.store.failStalled(task.id, run.id, "still silent"); expect(restored.store.get(task.id)?.runs[0].endReason).toBe("stalled");
		restored.store.resume(task.id, { autoApprove: true }); const next = restored.store.startRun(task.id, "resume", "faux"); expect(next.stallRetries).toBeUndefined(); expect(restored.store.recordStallRetry(task.id, next.id)).toBe(true);
	});
	it("does not capture live streaming text or mutate committed events through recovered tasks", async () => {
		const { cache, store, create, recover, events, file } = await setup(); const task = create();
		store.recordAssistant(task.id, { id: "draft", runId: "run", at: 1, text: "LIVE_ONLY", blocks: [{ type: "text", text: "LIVE_ONLY" }], streaming: true }, false);
		expect(cache.flush()).toBe(true); expect(readFileSync(file, "utf8")).not.toContain("LIVE_ONLY");
		const recovered = recover(); expect(recovered.store.assistantMessages(task.id)).toEqual([]);
		const original = JSON.stringify(recovered.log.all()); recovered.store.get(task.id)!.title = "uncommitted";
		expect(JSON.stringify(recovered.log.all())).toBe(original); expect(JSON.stringify(events.all())).not.toContain("uncommitted");
	});
	it("reconstructs writes committed before their following task snapshot", async () => {
		const { cache, store, create, recover, events } = await setup(); const task = create();
		events.append("access_recorded", { taskId: task.id, access: { toolCallId: "write", runId: "run", tool: "write", at: 1, kind: "fs_write", target: "crash.txt" } });
		expect(store.get(task.id)!.changedFiles).toBeUndefined(); cache.flush();
		expect(recover().store.get(task.id)!.changedFiles).toEqual(["crash.txt"]);
	});
	it("preserves first-seen tool and message ordering when earlier entries finish last", async () => {
		const { cache, store, create, recover } = await setup(); const task = create();
		for (const id of ["a", "b", "a", "a"]) {
			store.recordTool(task.id, { id, runId: "run", name: "read", input: "", status: "ok", startedAt: 1 });
			store.recordAssistant(task.id, { id, runId: "run", at: 1, text: id, blocks: [{ type: "text", text: id }], streaming: false }, true);
		}
		cache.flush(); const result = recover();
		expect(result.store.timeline(task.id).map(c => c.id)).toEqual(["a", "b"]);
		expect(result.store.assistantMessages(task.id).map(m => m.id)).toEqual(["a", "b"]);
		expect(result.store.board(0, 2, 100)).toEqual(result.full.board(0, 2, 100));
	});
	it("falls back on corrupt, unsupported, ahead or different-history snapshots", async () => {
		const { file, cache, create, recover, eventFile } = await setup(); create(); cache.flush();
		const valid = readFileSync(file, "utf8");
		for (const invalid of ["{broken", JSON.stringify({ ...JSON.parse(valid), version: 99 }), JSON.stringify({ ...JSON.parse(valid), snapshotSeq: 999 }), valid.replace('"snapshot"', '"tampered"')]) {
			writeFileSync(file, invalid); const r = recover(); expect(r.snapshot.loadedSeq).toBe(0); expect(r.snapshot.warning).toContain("回退"); expect(r.store.list()).toEqual(r.full.list());
		}
		writeFileSync(file, valid); const event = JSON.parse(readFileSync(eventFile, "utf8")); event.at += 1; writeFileSync(eventFile, `${JSON.stringify(event)}\n`);
		const changed = recover(); expect(changed.snapshot.loadedSeq).toBe(0); expect(changed.snapshot.warning).toContain("回退");
	});
	it("writes after 200 committed events, after 30 seconds, and on disposal", async () => {
		const { cache, events, file } = await setup(); vi.useFakeTimers();
		// Construct under the fake clock so its interval is controlled too.
		const timedFile = `${file}.timed`; const timed = new TaskSnapshot(timedFile, events); caches.push(timed);
		for (let i = 0; i < 200; i++) events.append("capacity", { i });
		await Promise.resolve(); expect(JSON.parse(readFileSync(timedFile, "utf8")).snapshotSeq).toBe(200);
		events.append("capacity", {}); await vi.advanceTimersByTimeAsync(30000);
		expect(JSON.parse(readFileSync(timedFile, "utf8")).snapshotSeq).toBe(201);
		events.append("capacity", {}); timed.dispose(); expect(JSON.parse(readFileSync(timedFile, "utf8")).snapshotSeq).toBe(202);
		cache.dispose();
	});
	it("keeps committed facts recoverable when snapshot replacement fails, then retries", async () => {
		const { cache, events, file, dir, create, recover } = await setup(); create(); cache.flush();
		renameSync(file, `${file}.backup`); mkdirSync(file); events.append("capacity", {});
		expect(cache.flush()).toBe(false); expect(cache.warning).toContain("保存失败");
		expect(recover().store.list()).toHaveLength(1);
		renameSync(file, `${file}.directory`); expect(cache.flush()).toBe(true); expect(cache.warning).toBeUndefined();
		expect(readdirSync(dir).filter(name => name.endsWith(".tmp"))).toEqual([]); expect(existsSync(file)).toBe(true);
	});
});
