import { join } from "node:path";
import { mkdirSync, rmdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { nextOccurrence, ScheduledTasks } from "../../../../src/main/supervisor/schedules.ts";
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
		return { service, store, events, make, create, advance: (ms: number) => now += ms, approve: () => auto = true, ticks: () => ticks };
	}
	it("dispatches original quotes using current approval, blocks overlap and coalesces missed occurrences", async () => {
		const t = await setup(); const plan = t.create(); t.service.poll(); expect(t.store.list()).toHaveLength(0);
		t.advance(60000); t.service.poll(); const task = t.store.list()[0]; expect(task.quotes).toEqual(plan.quotes); expect(task.approval.state).toBe("pending");
		expect(t.store.board(0, 2).tasks[0].schedule).toEqual({ id: plan.id, dueAt: plan.nextAt });
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
		expect(store.board(0, 2).tasks[0].schedule).toEqual({ id: plan.id, dueAt: plan.nextAt });
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
});
