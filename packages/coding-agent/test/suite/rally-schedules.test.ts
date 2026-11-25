import { join } from "node:path";
import { mkdirSync, rmdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { nextOccurrence, ScheduledTasks } from "../../../../src/main/supervisor/schedules.ts";
import { isScheduleTimeAllowed } from "../../../../src/main/supervisor/schedule-timing.ts";
import type { ScheduleTiming } from "../../../../src/shared/schedules.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("local scheduled workers", () => {
	const harnesses: Harness[] = []; const logs: EventLog[] = []; const services: ScheduledTasks[] = [];
	afterEach(() => { services.splice(0).forEach(service => service.dispose()); logs.splice(0).forEach(log => log.close()); harnesses.splice(0).forEach(harness => harness.cleanup()); });
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const events = new EventLog(join(harness.tempDir, "events.jsonl")); logs.push(events);
		const store = new TaskStore(events, harness.tempDir, () => {});
		let now = Date.parse("2026-11-20T00:00:00Z"); let auto = false; let ticks = 0;
		const make = () => { const service = new ScheduledTasks(events, store, () => auto, () => ticks++, () => now); services.push(service); return service; };
		const service = make();
		const create = () => service.create({ title: "整理笔记", cwd: harness.tempDir, mode: "readonly", timing: { kind: "interval", minutes: 1 } }, [{ messageId: "#1", kind: "user", text: "每分钟整理笔记", at: now }]);
		return { service, store, events, make, create, at: (iso: string) => now = Date.parse(iso), advance: (ms: number) => now += ms, approve: () => auto = true, ticks: () => ticks };
	}
	it("dispatches original quotes using current approval, blocks overlap and coalesces missed occurrences", async () => {
		const t = await setup(); const plan = t.create(); t.service.poll(); expect(t.store.list()).toHaveLength(0);
		t.advance(60000); t.service.poll(); const task = t.store.list()[0]; expect(task.quotes).toEqual(plan.quotes); expect(task.approval.state).toBe("pending");
		expect(t.store.board(0, 2).tasks[0].schedule).toEqual({ id: plan.id, dueAt: plan.nextAt, timing: plan.timing });
		t.advance(3600000); t.service.poll(); expect(t.store.list()).toHaveLength(1);
		t.store.cancel(task.id, "system"); t.approve(); t.service.poll(); expect(t.store.list()).toHaveLength(2); expect(t.store.list().find(x => x.id !== task.id)?.approval.state).toBe("approved");
		t.service.poll(); expect(t.store.list()).toHaveLength(2); expect(t.ticks()).toBe(2);
	});
	it("replays paused/deleted plans and stops after disposal", async () => {
		const t = await setup(); const plan = t.create(); t.service.update(plan.id, false); t.advance(60000); t.make().poll(); expect(t.store.list()).toHaveLength(0);
		t.service.update(plan.id, true); t.advance(60000); const restored = t.make(); restored.poll(); expect(t.store.list()).toHaveLength(1);
		restored.update(plan.id, null); expect(t.make().list()).toHaveLength(0); restored.dispose(); expect(() => restored.create(plan, plan.quotes)).toThrow();
	});
	it("recovers a crash between task creation and schedule checkpoint without duplicate dispatch", async () => {
		const t = await setup(); const plan = t.create();
		t.store.create({ ...plan, scope: [], dependsOn: [], autoApprove: false, dispatchKey: `schedule:${plan.id}:${plan.nextAt}` });
		t.advance(60000); t.make().poll(); expect(t.store.list()).toHaveLength(1); expect(t.make().list()[0].lastTaskId).toBe(t.store.list()[0].id);
		expect(t.store.board(0, 2).tasks[0].schedule).toEqual({ id: plan.id, dueAt: plan.nextAt });
	});
	it("one-shot fires once across restart", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		t.service.create({ ...template, timing: { kind: "once", at: template.nextAt } }, template.quotes);
		t.advance(60000); t.service.poll(); t.make().poll(); expect(t.store.list()).toHaveLength(1); expect(t.make().list()[0].enabled).toBe(false);
	});
	it("keeps interval cadence after late polls and makes repeated enable requests idempotent", async () => {
		const t = await setup(); const plan = t.create();
		t.advance(45000); t.service.update(plan.id, true); expect(t.service.list()[0].nextAt).toBe(plan.nextAt);
		t.advance(20000); t.service.poll(); expect(t.service.list()[0].nextAt).toBe(plan.nextAt + 60000);
		t.service.update(plan.id, false, { actor: "main", quotes: plan.quotes });
		expect(t.events.ofKind("schedule_changed").at(-1)?.data.source).toEqual({ actor: "main", quotes: plan.quotes });
	});
	it("disables a plan when its directory disappears and can recover after repair", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		const cwd = join(template.cwd, "scheduled-work"); mkdirSync(cwd);
		const plan = t.service.create({ ...template, cwd }, template.quotes); rmdirSync(cwd);
		t.advance(60000); t.service.poll(); expect(t.store.list()).toHaveLength(0); expect(t.service.list()[0]).toMatchObject({ enabled: false, error: expect.any(String) });
		mkdirSync(cwd); t.service.update(plan.id, true); t.advance(60000); t.service.poll(); expect(t.store.list()).toHaveLength(1);
	});
	it("restores schedules and occurrence keys from disk and deduplicates creation retries", async () => {
		const t = await setup(); const plan = t.create(); expect(t.create().id).toBe(plan.id);
		t.advance(60000); t.service.poll(); t.service.dispose();
		const harness = harnesses.at(-1)!; t.events.close();
		const events = new EventLog(join(harness.tempDir, "events.jsonl")); logs.push(events);
		const store = new TaskStore(events, harness.tempDir, () => {});
		const recovered = new ScheduledTasks(events, store, () => true, () => {}, () => plan.nextAt + 86400000); services.push(recovered);
		recovered.poll(); expect(store.list()).toHaveLength(1); expect(recovered.list()[0].lastTaskId).toBe(store.list()[0].id);
		expect(store.board(0, 2).tasks[0].schedule).toEqual({ id: plan.id, dueAt: plan.nextAt, timing: plan.timing });
	});
	it("does not catch up at night and coalesces late recovery within the next window", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		const plan = t.service.create({ ...template, timing: { kind: "interval", minutes: 120, window: { start: "09:00", end: "21:00", timezone: "Asia/Shanghai" } } }, template.quotes);
		expect(plan.nextAt).toBe(Date.parse("2026-11-20T01:00:00Z"));
		t.at("2026-11-20T14:00:00Z"); const recovered = t.make(); recovered.poll();
		expect(t.store.list()).toHaveLength(0);
		expect(recovered.list()[0].nextAt).toBe(Date.parse("2026-11-21T01:00:00Z"));
		t.at("2026-11-21T02:37:00Z"); recovered.poll(); recovered.poll();
		expect(t.store.list()).toHaveLength(1);
		expect(recovered.list()[0].nextAt).toBe(Date.parse("2026-11-21T03:00:00Z"));
	});
	it("skips catch-up on excluded weekdays", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		t.service.create({ ...template, timing: { kind: "daily", time: "09:00", timezone: "UTC", weekdays: [1, 2, 3, 4, 5] } }, template.quotes);
		t.at("2026-11-21T12:00:00Z"); t.service.poll();
		expect(t.store.list()).toHaveLength(0);
		expect(t.service.list()[0].nextAt).toBe(Date.parse("2026-11-23T09:00:00Z"));
	});
	it("edits timing in place, preserves authorization and keeps dispatched workers frozen", async () => {
		const t = await setup(); const plan = t.create(); t.advance(60000); t.service.poll();
		const first = t.store.list()[0];
		const timing: ScheduleTiming = { kind: "interval", minutes: 120, window: { start: "09:00", end: "21:00", timezone: "Asia/Shanghai", weekdays: [5, 1, 3] } };
		const change = { messageId: "#2", kind: "user" as const, at: plan.nextAt, text: "改成周一三五，9 点到 21 点每两小时，原来的事继续做" };
		t.service.update(plan.id, undefined, { actor: "main", quotes: [change] }, timing);
		const updated = t.service.list()[0];
		expect(updated).toMatchObject({ id: plan.id, enabled: true, lastTaskId: first.id, quotes: [...plan.quotes, change] });
		expect(first.schedule?.timing).toEqual(plan.timing);
		expect(first.quotes).toEqual(plan.quotes);
		t.at("2026-11-20T04:00:00Z"); t.service.poll(); expect(t.store.list()).toHaveLength(1);
		t.service.update(plan.id, true, { actor: "main", quotes: [change] }, { ...timing, window: { ...timing.window!, weekdays: [1, 3, 5] } });
		expect(t.service.list()[0].nextAt).toBe(updated.nextAt);
		t.store.cancel(first.id, "system"); t.service.poll();
		const second = t.store.list().find(task => task.id !== first.id)!;
		expect(second.quotes).toEqual([...plan.quotes, change]);
		expect(second.schedule?.timing).toEqual(updated.timing);
		expect(t.service.list()[0].nextAt).toBe(Date.parse("2026-11-20T05:00:00Z"));
		t.service.update(plan.id, false);
		t.service.update(plan.id, undefined, { actor: "main", quotes: [change] }, { kind: "daily", time: "08:00", timezone: "UTC" });
		expect(t.make().list()[0].enabled).toBe(false);
		expect(() => t.service.update(plan.id, null, { actor: "user" }, timing)).toThrow();
	});
	it("deduplicates equivalent weekday lists but keeps different weekday rules distinct", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		const timing: ScheduleTiming = { kind: "daily", time: "09:00", timezone: "UTC", weekdays: [5, 1, 3, 1] };
		const first = t.service.create({ ...template, timing }, template.quotes);
		expect(t.service.create({ ...template, timing: { ...timing, weekdays: [1, 3, 5] } }, template.quotes).id).toBe(first.id);
		expect(t.service.create({ ...template, timing: { ...timing, weekdays: [2, 4] } }, template.quotes).id).not.toBe(first.id);
	});
	it("recovers an already-created occurrence outside the window without losing its checkpoint", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		const plan = t.service.create({ ...template, timing: { kind: "interval", minutes: 120, window: { start: "09:00", end: "21:00", timezone: "Asia/Shanghai" } } }, template.quotes);
		const task = t.store.create({ ...plan, scope: [], dependsOn: [], autoApprove: false, dispatchKey: `schedule:${plan.id}:${plan.nextAt}`, schedule: { id: plan.id, dueAt: plan.nextAt, timing: plan.timing } }).task;
		t.at("2026-11-20T15:00:00Z"); const recovered = t.make(); recovered.poll();
		expect(t.store.list()).toHaveLength(1);
		expect(recovered.list()[0]).toMatchObject({ lastTaskId: task.id, nextAt: Date.parse("2026-11-21T01:00:00Z") });
	});
	it("surfaces interrupted workers and blocks future occurrences until they are resolved", async () => {
		const t = await setup(); t.approve(); t.create(); t.advance(60000); t.service.poll();
		const task = t.store.list()[0]; t.store.startRun(task.id, "dispatch", "faux"); t.store.endRunInterrupted(task.id, "interrupted");
		t.advance(86400000); const recovered = t.make(); recovered.poll();
		expect(t.store.list()).toHaveLength(1);
		expect(recovered.list()[0].waitingFor).toMatchObject({ taskId: task.id, status: "interrupted" });
		expect(recovered.context()).not.toContain("waitingFor");
		t.store.cancel(task.id, "system"); recovered.poll();
		expect(t.store.list()).toHaveLength(2);
	});
	it("wakes a queued first start when its saved window reopens even if the plan was deleted", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		const plan = t.service.create({ ...template, timing: { kind: "interval", minutes: 120, window: { start: "09:00", end: "21:00", timezone: "Asia/Shanghai" } } }, template.quotes);
		t.at("2026-11-20T01:00:00Z"); t.service.poll();
		const task = t.store.list()[0]; t.store.setQueue(task.id, "schedule_window"); t.service.update(plan.id, null);
		const before = t.ticks(); t.at("2026-11-20T14:00:00Z"); t.service.poll(); expect(t.ticks()).toBe(before);
		t.at("2026-11-21T01:00:00Z"); t.service.poll(); expect(t.ticks()).toBe(before + 1);
	});
	it("allows repairing an expired one-shot with a future time without changing its ID", async () => {
		const t = await setup(); const template = t.create(); t.service.update(template.id, null);
		const plan = t.service.create({ ...template, timing: { kind: "once", at: template.nextAt } }, template.quotes);
		t.advance(60000); t.service.poll();
		expect(() => t.service.update(plan.id, true)).toThrow("未来时间");
		t.service.update(plan.id, true, { actor: "main", quotes: plan.quotes }, { kind: "once", at: plan.nextAt + 60000 });
		expect(t.service.list()[0]).toMatchObject({ id: plan.id, enabled: true, nextAt: plan.nextAt + 60000 });
	});
	it("does not repeat a daily occurrence when daylight saving time falls back", () => {
		expect(nextOccurrence({ kind: "daily", time: "01:30", timezone: "America/New_York" }, Date.parse("2026-11-01T05:30:00Z"))).toBe(Date.parse("2026-11-02T06:30:00Z"));
	});
	it("validates intervals, dates, zones and computes daily wall time", () => {
		const now = Date.parse("2026-11-20T00:00:00Z");
		expect(nextOccurrence({ kind: "daily", time: "09:00", timezone: "Asia/Shanghai" }, now)).toBe(Date.parse("2026-11-20T01:00:00Z"));
		expect(() => nextOccurrence({ kind: "interval", minutes: 0 }, now)).toThrow();
		expect(() => nextOccurrence({ kind: "once", at: now }, now)).toThrow();
		expect(() => nextOccurrence({ kind: "once", at: Number.MAX_VALUE }, now)).toThrow();
		expect(() => nextOccurrence({ kind: "daily", time: "25:00", timezone: "UTC" }, now)).toThrow();
		expect(() => nextOccurrence({ kind: "daily", time: "09:00", timezone: "invalid" }, now)).toThrow();
	});
	it("anchors daytime intervals at opening, excluding the closing minute", () => {
		const timing: ScheduleTiming = { kind: "interval", minutes: 120, window: { start: "09:00", end: "21:00", timezone: "Asia/Shanghai" } };
		expect(nextOccurrence(timing, Date.parse("2026-11-20T00:00:00Z"))).toBe(Date.parse("2026-11-20T01:00:00Z"));
		expect(nextOccurrence(timing, Date.parse("2026-11-20T01:00:00Z"))).toBe(Date.parse("2026-11-20T03:00:00Z"));
		expect(nextOccurrence(timing, Date.parse("2026-11-20T11:00:00Z"))).toBe(Date.parse("2026-11-21T01:00:00Z"));
		expect(isScheduleTimeAllowed(timing, Date.parse("2026-11-20T13:00:00Z"))).toBe(false);
	});
	it("assigns an overnight window to its opening weekday", () => {
		const timing: ScheduleTiming = { kind: "interval", minutes: 60, window: { start: "22:00", end: "02:00", timezone: "UTC", weekdays: [5] } };
		expect(nextOccurrence(timing, Date.parse("2026-11-20T23:00:00Z"))).toBe(Date.parse("2026-11-21T00:00:00Z"));
		expect(isScheduleTimeAllowed(timing, Date.parse("2026-11-21T01:59:00Z"))).toBe(true);
		expect(isScheduleTimeAllowed(timing, Date.parse("2026-11-21T02:00:00Z"))).toBe(false);
		expect(nextOccurrence(timing, Date.parse("2026-11-21T01:00:00Z"))).toBe(Date.parse("2026-11-27T22:00:00Z"));
	});
	it("supports whole selected days and skips a weekly local time missing during DST", () => {
		expect(nextOccurrence({ kind: "interval", minutes: 180, window: { start: "00:00", end: "24:00", timezone: "UTC", weekdays: [1] } }, Date.parse("2026-11-23T23:00:00Z"))).toBe(Date.parse("2026-11-30T00:00:00Z"));
		expect(nextOccurrence({ kind: "daily", time: "02:30", timezone: "America/New_York", weekdays: [7] }, Date.parse("2026-03-08T05:00:00Z"))).toBe(Date.parse("2026-03-15T06:30:00Z"));
	});
	it("skips nonexistent interval slots and avoids repeated slots after DST fallback recovery", () => {
		const timing: ScheduleTiming = { kind: "interval", minutes: 30, window: { start: "01:00", end: "04:00", timezone: "America/New_York" } };
		expect(nextOccurrence(timing, Date.parse("2026-03-08T06:30:00Z"))).toBe(Date.parse("2026-03-08T07:00:00Z"));
		expect(nextOccurrence(timing, Date.parse("2026-11-01T05:30:00Z"))).toBe(Date.parse("2026-11-01T07:00:00Z"));
		expect(nextOccurrence(timing, Date.parse("2026-11-01T06:10:00Z"), Date.parse("2026-11-01T05:30:00Z"))).toBe(Date.parse("2026-11-01T07:00:00Z"));
	});
	it("rejects ambiguous or invalid windows and weekdays", () => {
		const now = Date.parse("2026-11-20T00:00:00Z");
		const window = { start: "09:00", end: "21:00", timezone: "UTC" };
		for (const invalid of [{ ...window, start: "24:00" }, { ...window, end: "09:00" }, { ...window, weekdays: [] }, { ...window, weekdays: [0] }, { ...window, weekdays: [8] }, { ...window, timezone: "" }]) {
			expect(() => nextOccurrence({ kind: "interval", minutes: 60, window: invalid }, now)).toThrow();
		}
		expect(() => nextOccurrence({ kind: "interval", minutes: 721, window }, now)).toThrow();
	});
});
