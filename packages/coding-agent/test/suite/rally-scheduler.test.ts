import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Scheduler } from "../../../../src/main/supervisor/scheduler.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { taskView, type Task } from "../../../../src/shared/task.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally slot priority and one user overflow slot", () => {
	const harnesses: Harness[] = []; const schedulers: Scheduler[] = []; const logs: EventLog[] = [];
	afterEach(() => { for (const scheduler of schedulers.splice(0)) scheduler.dispose(); for (const log of logs.splice(0)) log.close(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup(now: () => number = Date.now) {
		const harness = await createHarness(); harnesses.push(harness); const events = new EventLog(join(harness.tempDir, "events.jsonl")); logs.push(events);
		const store = new TaskStore(events, () => harness.tempDir, () => {}); const active = new Set<string>(); const pending = new Set<string>(); const order: string[] = []; const releases: Array<() => void> = [];
		const scheduler = new Scheduler({ store, events, now, limit: 2, activeIds: () => [...active], pendingIds: () => [...pending], wake: id => { pending.delete(id); active.add(id); order.push(id); }, start: async task => { order.push(task.id); await new Promise<void>(resolve => releases.push(resolve)); }, onDependencyFailed: () => {} }); schedulers.push(scheduler);
		const task = (schedule?: Task["schedule"]) => store.create({ title: "slot", quotes: [], cwd: harness.tempDir, mode: "readonly", scope: [], dependsOn: [], autoApprove: true, schedule }).task;
		const idle = (user = false) => { const item = task(); store.startRun(item.id, "dispatch", "faux"); store.nudge(item.id, "system input"); if (user) store.steer(item.id, [], "user input"); pending.add(item.id); return item; };
		return { store, events, active, pending, scheduler, task, idle, order, releases };
	}
	it("admits user continuation before system input and new work, with only one overflow", async () => {
		const { active, idle, task, scheduler, order } = await setup(); const fresh = task(); const system = idle(); const user = idle(true); const another = idle(true); active.add("busy-1"); active.add("busy-2");
		scheduler.tick(); expect(order).toEqual([user.id]); expect(another.queue?.reason).toBe("capacity"); expect(system.queue?.reason).toBe("capacity"); expect(fresh.queue?.reason).toBe("capacity");
		active.delete("busy-1"); scheduler.tick(); expect(order).toEqual([user.id, another.id]);
		active.delete("busy-2"); scheduler.tick(); expect(order).toHaveLength(2);
		active.delete(user.id); scheduler.tick(); expect(order.at(-1)).toBe(system.id); expect(fresh.runs).toHaveLength(0);
	});
	it("reserves an overflow start for resume and never lends it to first dispatch or approval", async () => {
		const { active, task, store, scheduler, order, releases } = await setup(); const fresh = task(); store.steer(fresh.id, [], "before first run");
		const resumed = task(); const run = store.startRun(resumed.id, "dispatch", "faux"); store.report(resumed.id, run.id, "ready", "done"); store.resume(resumed.id, { autoApprove: true });
		active.add("busy-1"); active.add("busy-2"); scheduler.tick(); scheduler.tick(); expect(order).toEqual([resumed.id]); expect(resumed.runs).toHaveLength(2); expect(fresh.runs).toHaveLength(0);
		for (const release of releases) release(); scheduler.dispose();
	});
	it("does not consume another slot when a job-held task wakes and still honors dependencies", async () => {
		const { active, idle, task, store, scheduler, order } = await setup(); const job = idle(); active.add(job.id); active.add("busy");
		const upstream = task(); const downstream = store.create({ title: "dependent", quotes: [], cwd: upstream.cwd, mode: "readonly", scope: [], dependsOn: [upstream.id], autoApprove: true }).task;
		scheduler.tick(); expect(order).toEqual([job.id]); expect(active.size).toBe(2); expect(downstream.queue).toMatchObject({ reason: "dependency", holder: upstream.id });
	});
	it("orders user wakes by their waiting input rather than the original task age", async () => {
		const { active, idle, scheduler, order } = await setup(); const older = idle(true); const newer = idle(true);
		older.createdAt = 1; newer.createdAt = 2; older.inputs.at(-1)!.at = 200; newer.inputs.at(-1)!.at = 100;
		active.add("busy-1"); active.add("busy-2"); scheduler.tick(); expect(order).toEqual([newer.id]); expect(older.queue?.reason).toBe("capacity");
	});
	it("releases an ended startup reservation and does not let its late settlement clear a resumed run", async () => {
		const { active, idle, task, store, scheduler, order, releases } = await setup(); const first = task(); const second = task(); active.add("busy"); scheduler.tick();
		expect(order).toEqual([first.id]); store.failStalled(first.id, first.runs[0].id, "startup stuck"); scheduler.tick(); expect(order).toEqual([first.id, second.id]);
		store.resume(first.id, { autoApprove: true }); scheduler.tick(); const waiting = idle(true); scheduler.tick(); expect(order).toEqual([first.id, second.id, first.id]);
		releases[0](); await Promise.resolve(); await Promise.resolve(); scheduler.tick(); expect(waiting.queue?.reason).toBe("capacity"); expect(order).toHaveLength(3);
		scheduler.dispose(); for (const release of releases) release();
	});
	it("checks the window again after capacity waits and leaves already-started work alone", async () => {
		let now = Date.parse("2026-11-20T20:59:00Z");
		const t = await setup(() => now);
		const item = t.task({ id: "S-window", dueAt: now, timing: { kind: "interval", minutes: 120, window: { start: "09:00", end: "21:00", timezone: "UTC" } } });
		t.active.add("busy-1"); t.active.add("busy-2"); t.scheduler.tick();
		expect(item.queue?.reason).toBe("capacity");
		now = Date.parse("2026-11-20T21:00:00Z"); t.active.clear(); t.scheduler.tick();
		expect(t.order).toEqual([]);
		expect(item.queue?.reason).toBe("schedule_window");
		expect(taskView(item).statusText).toContain("等待允许运行的时段");
		now = Date.parse("2026-11-21T09:00:00Z"); t.scheduler.tick();
		expect(t.order).toEqual([item.id]);
		expect(item.queue).toBeUndefined();
		now = Date.parse("2026-11-21T21:00:00Z"); t.store.nudge(item.id, "finish current work"); t.pending.add(item.id); t.active.add(item.id); t.scheduler.tick();
		expect(t.order).toEqual([item.id, item.id]);
		expect(item.runs).toHaveLength(1);
		t.scheduler.dispose(); for (const release of t.releases) release();
	});
});
