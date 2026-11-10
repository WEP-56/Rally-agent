import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { Relay, type RelayMessage, type RelayMode } from "../../../../src/main/supervisor/relay.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally durable relay (no provider calls)", () => {
	const harnesses: Harness[] = [];
	const relays: Relay[] = [];
	afterEach(() => {
		for (const relay of relays.splice(0)) relay.dispose();
		vi.useRealTimers(); vi.restoreAllMocks();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(segmentBytes?: number) {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
		const events = new EventLog(paths.eventsFile, segmentBytes);
		const store = new TaskStore(events, paths.workspaceDir, () => {});
		const transport = { isBusy: vi.fn(() => false), canReceiveRelay: vi.fn(() => true),
			sendRelay: vi.fn(async (_items: RelayMessage[], _mode: RelayMode) => {}), addSystemLine: vi.fn() };
		const relay = new Relay(transport, events, store); relays.push(relay);
		const task = store.create({ title: "中继任务", cwd: paths.workspaceDir, quotes: [], scope: [], dependsOn: [], mode: "readonly", autoApprove: false }).task;
		const run = store.startRun(task.id, "dispatch", "faux");
		vi.useFakeTimers(); relay.start();
		return { paths, events, store, transport, relay, task, run };
	}

	it("coalesces in arrival order and acknowledges consumption rather than send acceptance", async () => {
		const { events, relay, task, transport } = await setup();
		const first = relay.enqueue({ kind: "worker_report", task, state: "blocked", summary: "先到" }, ["one"]);
		const second = relay.enqueue({ kind: "worker_report", task, state: "ready", summary: "后到" }, ["two"]);
		expect(relay.enqueue({ kind: "worker_report", task, state: "ready", summary: "重复" }, ["one"])).toBe(first);
		await vi.advanceTimersByTimeAsync(1999); expect(transport.sendRelay).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(transport.sendRelay).toHaveBeenCalledExactlyOnceWith([
			{ id: first, text: expect.stringContaining("先到") }, { id: second, text: expect.stringContaining("后到") },
		], "turn");
		expect(events.ofKind("relay_delivered")).toHaveLength(0);
		relay.consumed([first, first, second]); relay.consumed([first]);
		expect(events.ofKind("relay_delivered").map((event) => event.data.relayId)).toEqual([first, second]);
	});

	it("flushes older windowed reports before a new busy-main steer", async () => {
		const { relay, task, transport } = await setup();
		const first = relay.enqueue({ kind: "worker_report", task, state: "blocked", summary: "first" });
		transport.isBusy.mockReturnValue(true);
		const second = relay.enqueue({ kind: "worker_report", task, state: "ready", summary: "second" });
		expect(transport.sendRelay.mock.calls[0][0].map((item) => item.id)).toEqual([first, second]);
		expect(transport.sendRelay.mock.calls[0][1]).toBe("steer");
		await vi.advanceTimersByTimeAsync(2000); expect(transport.sendRelay).toHaveBeenCalledTimes(1);
	});

	it("recovers queued payloads with stable IDs, skips receipts and keeps source dedup across restart", async () => {
		const { paths, relay, task, transport } = await setup(512);
		const done = relay.enqueue({ kind: "worker_report", task, state: "ready", summary: "已送达" }, ["done"]);
		const pending = relay.enqueue({ kind: "worker_report", task, state: "blocked", summary: "待补送" }, ["pending"]);
		relay.consumed([done]); relay.dispose();
		const events = new EventLog(paths.eventsFile);
		const store = new TaskStore(events, paths.workspaceDir, () => {});
		const recovered = new Relay(transport, events, store); relays.push(recovered); recovered.start();
		expect(recovered.enqueue({ kind: "worker_report", task, state: "ready", summary: "不应再发" }, ["done"])).toBe(done);
		await vi.advanceTimersByTimeAsync(2000);
		expect(transport.sendRelay.mock.calls[0][0]).toEqual([{ id: pending, text: expect.stringContaining("待补送") }]);
		const next = recovered.enqueue({ kind: "worker_report", task, state: "ready", summary: "新报告" });
		expect(Number(next.slice(2))).toBeGreaterThan(Number(pending.slice(2)));
	});

	it("reconstructs reports and grouped interruptions when a crash precedes enqueue", async () => {
		const { paths, events, relay, store, task, run, transport } = await setup();
		store.report(task.id, run.id, "blocked", "落盘但未入队");
		store.endRunInterrupted(task.id, "interrupted");
		expect(events.ofKind("relay_enqueued")).toHaveLength(0);
		relay.dispose();
		const recoveredLog = new EventLog(paths.eventsFile);
		const recoveredStore = new TaskStore(recoveredLog, paths.workspaceDir, () => {});
		const recovered = new Relay(transport, recoveredLog, recoveredStore); relays.push(recovered); recovered.start();
		recovered.captureSources();
		expect(recoveredLog.ofKind("relay_enqueued").map((event) => event.data.kind)).toEqual(["worker_report", "interrupted"]);
		await vi.advanceTimersByTimeAsync(2000);
		expect(transport.sendRelay.mock.calls[0][0][0].text).toContain("落盘但未入队");
		expect(transport.sendRelay.mock.calls[0][0][1].text).toContain("interrupted");
	});

	it("retries a failed send with the same payload and does not drop model-unavailable items", async () => {
		const { relay, task, transport, events } = await setup();
		transport.canReceiveRelay.mockReturnValue(false);
		const id = relay.enqueue({ kind: "worker_report", task, state: "ready", summary: "可靠投递" });
		await vi.advanceTimersByTimeAsync(30000); expect(transport.sendRelay).not.toHaveBeenCalled();
		transport.canReceiveRelay.mockReturnValue(true);
		transport.sendRelay.mockRejectedValueOnce(new Error("transport failed"));
		relay.available(); await vi.advanceTimersByTimeAsync(2000);
		expect(events.ofKind("relay_failed")).toHaveLength(1); expect(events.ofKind("relay_delivered")).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1000);
		expect(transport.sendRelay.mock.calls[1]).toEqual(transport.sendRelay.mock.calls[0]);
		relay.consumed([id]); await vi.advanceTimersByTimeAsync(30000);
		expect(transport.sendRelay).toHaveBeenCalledTimes(2);
	});

	it("replays notices without a wake and discards questions invalidated before delivery", async () => {
		const { relay, store, task, run, events, transport, paths } = await setup();
		store.report(task.id, run.id, "blocked", "问", "选择？", ["甲", "乙"]); relay.captureSources();
		store.report(task.id, run.id, "ready", "已自行解决");
		relay.notice("用户点击了按钮", "notice-source"); relay.dispose(); transport.sendRelay.mockClear();
		const log = new EventLog(paths.eventsFile);
		const replay = new Relay(transport, log, new TaskStore(log, paths.workspaceDir, () => {})); relays.push(replay); replay.start();
		expect(transport.sendRelay.mock.calls[0][1]).toBe("notice");
		expect(transport.sendRelay.mock.calls[0][0][0].text).toContain("用户点击了按钮");
		await vi.advanceTimersByTimeAsync(2000);
		expect(log.ofKind("relay_discarded")).toHaveLength(1);
		expect(transport.sendRelay.mock.calls.at(-1)?.[0].map((item) => item.text).join()).not.toContain("选择？");
		expect(events.ofKind("relay_delivered")).toHaveLength(0);
	});

	it("keeps events appendable after a torn final line and does not publish failed disk writes", async () => {
		const { paths, events } = await setup();
		appendFileSync(paths.eventsFile, '{"seq":999,"kind":"relay_enqueued"', "utf8");
		const replay = new EventLog(paths.eventsFile); const last = replay.all().at(-1)!.seq;
		replay.append("notice_enqueued", { text: "after torn line" });
		expect(new EventLog(paths.eventsFile).all().at(-1)).toMatchObject({ seq: last + 1, data: { text: "after torn line" } });
		const before = events.all().length;
		renameSync(paths.eventsFile, `${paths.eventsFile}.backup`); mkdirSync(paths.eventsFile);
		expect(() => events.append("notice_enqueued", {})).toThrow();
		expect(events.all()).toHaveLength(before);
	});

	it("persists a custom-only Pi conversation before any assistant reply", async () => {
		const { paths } = await setup();
		const session = SessionManager.create(paths.mainCwd, join(paths.sessionsMainDir, "custom-only"));
		session.appendCustomMessageEntry("rally-relay", "<rally-event relayId=\"R-1\">fact</rally-event>", false, { relayIds: ["R-1"] });
		const file = session.getSessionFile()!;
		expect(existsSync(file)).toBe(true);
		expect(readFileSync(file, "utf8")).toContain("rally-relay");
		expect(SessionManager.open(file).getBranch()).toContainEqual(expect.objectContaining({ type: "custom_message", details: { relayIds: ["R-1"] } }));
	});

	it("retries source capture after an outbox disk failure without losing its cursor", async () => {
		const { relay, store, task, run, events, transport } = await setup();
		store.report(task.id, run.id, "ready", "OUTBOX_DISK_RETRY");
		const append = events.append.bind(events);
		let fail = true;
		vi.spyOn(events, "append").mockImplementation((kind, data) => {
			if (kind === "relay_enqueued" && fail) { fail = false; throw new Error("disk failure"); }
			return append(kind, data);
		});
		expect(() => relay.captureSources()).toThrow("disk failure");
		await vi.advanceTimersByTimeAsync(1000);
		expect(events.ofKind("relay_enqueued")).toHaveLength(1);
		expect(transport.sendRelay.mock.calls[0][0][0].text).toContain("OUTBOX_DISK_RETRY");
	});
});
