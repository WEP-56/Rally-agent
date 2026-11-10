import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { GateService } from "../../../../src/main/supervisor/gates.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { taskView } from "../../../../src/shared/task.ts";
import { readTask } from "../../../../src/main/supervisor/task-read.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally gates (isolated state, no provider calls)", () => {
	const harnesses: Harness[] = [];
	const services: GateService[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		for (const gates of services.splice(0)) gates.dispose();
		vi.useRealTimers();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
		const events = new EventLog(paths.eventsFile);
		const store = new TaskStore(events, paths.workspaceDir, () => {});
		const audit = new AuditLog(paths.auditFile, events);
		const options = { store, audit, events, requested: vi.fn(), notice: vi.fn(),
			quote: (ref: { id: string }) => ref.id === "#allowed" ? { messageId: ref.id } : null };
		const gates = new GateService(options); services.push(gates);
		const task = store.create({ title: "Gate test", cwd: paths.workspaceDir, quotes: [], scope: [], dependsOn: [], mode: "write", autoApprove: true }).task;
		const run = store.startRun(task.id, "dispatch", "faux");
		const description = { action: "删除 dist", scope: ["dist"], alternative: "保留文件" };
		const request = (args = { target: "dist" }, signal?: AbortSignal) => gates.request(task, run.id, "call", "mcp__fixture__echo", args, description, signal);
		return { paths, events, store, audit, gates, options, task, run, description, request };
	}

	it("requires complete context and real user quotes even with auto approval; freezes the request", async () => {
		const { gates, task, run, description, request, options, paths, store } = await setup();
		expect(() => gates.request(task, run.id, "bad", "mcp__fixture__echo", {}, {}, undefined)).toThrow("action");
		expect(task.gates).toBeUndefined();
		const args = { target: "dist" };
		const waiting = request(args);
		const gate = task.gates![0];
		args.target = "src"; description.scope[0] = "src";
		expect(gate.arguments).toEqual({ target: "dist" });
		expect(gate.scope).toEqual(["dist"]);
		expect(options.requested).toHaveBeenCalledOnce();
		expect(taskView(task).status).toBe("needs_gate");
		expect(readTask(store, task, { view: "report" })).toMatchObject({ gates: [expect.objectContaining({ id: gate.id })] });
		expect(() => request()).toThrow("当前内门");
		expect(() => gates.decide(gate.id, "allow", "main", [], "允许")).toThrow("原话");
		expect(() => gates.decide(gate.id, "allow", "main", [{ id: "#invented" }], "允许")).toThrow("不是用户原话");
		expect(() => gates.decide(gate.id, "allow", "user", [], "点击")).toThrow("尚未转交");
		gates.decide(gate.id, "allow", "main", [{ id: "#allowed" }], "用户指定清理 dist");
		expect(await waiting).toMatchObject({ value: "allow", actor: "main", basis: ["#allowed"] });
		expect(() => gates.decide(gate.id, "allow", "main", [{ id: "#allowed" }], "再试")).toThrow("已决定");
		expect(readTask(store, task, { view: "report" })).toMatchObject({ gates: [] });
		const audit = readFileSync(paths.auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		expect(audit).toEqual([expect.objectContaining({ kind: "gate", gateId: gate.id, decision: "allow", actor: "main", basis: ["#allowed"], scope: ["dist"] })]);
	});

	it("denies after 120 seconds and rejects a decision at the deadline", async () => {
		const { gates, request, task, events } = await setup();
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
		const waiting = request(); const id = task.gates![0].id;
		vi.setSystemTime(Date.now() + 120_000);
		expect(() => gates.decide(id, "allow", "main", [{ id: "#allowed" }], "too late")).toThrow("已超时");
		expect(await waiting).toMatchObject({ value: "deny", actor: "system", reason: expect.stringContaining("GATE_TIMEOUT") });
		expect(events.ofKind("gate_timeout")).toHaveLength(1);
	});

	it("escalates verbatim with a ten-minute deadline; repeated escalation cannot extend it", async () => {
		const { gates, task, request } = await setup();
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
		const waiting = request(); const id = task.gates![0].id;
		gates.fallback([id]);
		const original = task.gates![0];
		expect(original.escalatedAt).toBe(Date.now());
		await vi.advanceTimersByTimeAsync(599_000);
		gates.escalate(task.id, id);
		expect(task.gates![0].expiresAt).toBe(original.expiresAt);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await waiting).toMatchObject({ value: "deny", reason: expect.stringContaining("GATE_TIMEOUT") });
	});

	it("accepts a user decision only on an escalated card and allows main denial without quotes", async () => {
		const { gates, task, request, options } = await setup();
		let waiting = request(); let id = task.gates!.at(-1)!.id;
		gates.escalate(task.id, id);
		gates.decide(id, "allow", "user", [], "用户点击");
		expect(await waiting).toMatchObject({ value: "allow", actor: "user", basis: [] });
		expect(options.notice).toHaveBeenCalledOnce();
		waiting = request(); id = task.gates!.at(-1)!.id;
		gates.decide(id, "deny", "main", [], "换做法");
		expect(await waiting).toMatchObject({ value: "deny", actor: "main", reason: "换做法" });
	});

	it("settles cancelled calls and shutdown without leaving stale authorization", async () => {
		const { gates, task, request } = await setup();
		const controller = new AbortController();
		const cancelled = request(undefined, controller.signal); const first = task.gates![0].id;
		controller.abort();
		expect(await cancelled).toMatchObject({ value: "deny", actor: "system" });
		expect(() => gates.escalate(task.id, first)).toThrow("已决定");
		const stopping = request(); gates.dispose();
		expect(await stopping).toMatchObject({ value: "deny", reason: expect.stringContaining("shutting down") });
		expect(() => request()).toThrow("已结束");
	});

	it("fails closed if the audit cannot persist and recovers unfinished gates as denied", async () => {
		const { gates, task, request, audit, store, options, paths } = await setup();
		const waiting = request(); const original = structuredClone(task.gates![0]);
		const spy = vi.spyOn(audit, "append").mockImplementationOnce(() => { throw new Error("disk full"); });
		expect(() => gates.decide(original.id, "allow", "main", [{ id: "#allowed" }], "用户原话")).toThrow("disk full");
		expect(task.gates![0].decision).toBeUndefined();
		spy.mockRestore();
		gates.decide(original.id, "deny", "main", [], "停止"); await waiting;
		// Reproduce a persisted request with no decided event at process loss.
		store.recordGate(task.id, { ...original, id: "G-42" }, "gate_requested");
		const restoredStore = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		const restored = new GateService({ ...options, store: restoredStore }); services.push(restored);
		expect(restoredStore.get(task.id)?.gates?.at(-1)?.decision).toMatchObject({ value: "deny", actor: "system", reason: expect.stringContaining("restarted") });
		expect(() => restored.decide("G-42", "allow", "user", [], "late")).toThrow("已决定");
	});
});
