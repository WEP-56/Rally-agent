import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { TaskSnapshot } from "../../../../src/main/supervisor/task-snapshot.ts";
import { ServiceManager } from "../../../../src/main/supervisor/services.ts";
import { ProcessRegistry } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { readTask } from "../../../../src/main/supervisor/task-read.ts";
import { createWorkerTools } from "../../../../src/main/supervisor/tools.ts";
import { ReadyPattern } from "../../../../src/main/supervisor/ready-pattern.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally services with offline real processes", () => {
	const harnesses: Harness[] = []; const cleanups: (() => Promise<void>)[] = [];
	const fixture = fileURLToPath(new URL("../fixtures/rally-service.cjs", import.meta.url));
	const safeEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" });
	afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup(readyMs = 8000) {
		const harness = await createHarness(); harnesses.push(harness); const cwd = harness.tempDir;
		const lock = new StateDirectoryLock(join(cwd, "state")); const events = new EventLog(join(cwd, "state", "events-0001.jsonl"), undefined, () => lock.assertHeld());
		const audit = new AuditLog(join(cwd, "audit.jsonl"), events); const store = new TaskStore(events, cwd, () => {});
		const task = store.create({ title: "services", quotes: [], cwd, scope: [], mode: "write", dependsOn: [], autoApprove: true }).task;
		const run = store.startRun(task.id, "dispatch", "fixture"); const processes = new ProcessRegistry(join(cwd, "state"), { assertWritable: () => lock.assertHeld(), graceMs: 50 });
		const stopped: string[] = []; const failures: unknown[] = [];
		const options = { store, processes, events, audit, directory: join(cwd, "jobs"), readyMs, stopGraceMs: 50, onChange: () => {}, onUserStop: (service: { id: string }) => { stopped.push(service.id); }, onError: (error: unknown) => { failures.push(error); } };
		const services = new ServiceManager(options);
		cleanups.push(async () => { await services.dispose(); await processes.dispose(); events.close(); lock.release(); expect(failures).toEqual([]); });
		const gate = join(cwd, "release"); const invocation = (mode = "http") => ({ executable: process.execPath, args: [fixture, mode, gate], cwd, env: safeEnv() });
		return { services, store, task, run, events, audit, processes, cwd, invocation, gate, stopped, options };
	}
	const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
	it("terminates a pathological readiness expression without blocking the main event loop", async () => {
		let reject!: (error: Error) => void; const failed = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
		const pattern = new ReadyPattern("(a+)+$", () => { throw new Error("must not match"); }, reject);
		let ticks = 0; const timer = setInterval(() => { ticks++; }, 10);
		try { pattern.test("a".repeat(9000) + "!"); await expect(failed).rejects.toThrow("SERVICE_PATTERN_TIMEOUT"); expect(ticks).toBeGreaterThan(5); }
		finally { clearInterval(timer); await pattern.close(); }
	}, 10000);
	it("discovers a real listening port, survives task termination and tool cancellation, and audits direct user stop", async () => {
		const { services, task, run, store, events, invocation, stopped } = await setup(); const controller = new AbortController();
		const result = await services.start(task, run, { name: "http", command: "fixture", env: { RALLY_SERVICE_TEST: "secret-test-value" } }, controller.signal, invocation());
		expect(result).toMatchObject({ serviceId: "S-1", ready: true, status: "running", pid: expect.any(Number) });
		expect(result.output).toContain("secret-test-value"); expect((await fetch(result.url!)).status).toBe(200); expect(await (await fetch(result.url!)).text()).toBe("真实服务 ✓");
		const child = Number(/PID (\d+)/.exec(result.output)?.[1]); expect(alive(child)).toBe(true); controller.abort();
		store.cancelRunning(task.id, "main", { actor: "user", basis: [] }); expect(services.state().services[0].status).toBe("running"); expect(task.inputs).toEqual([]);
		expect(JSON.stringify(task.services)).not.toContain("secret-test-value");
		await expect(services.stop("S-1", "user")).resolves.toEqual({ stopped: true }); expect(alive(child)).toBe(false); expect(stopped).toEqual(["S-1"]);
		expect(events.ofKind("stop").at(-1)?.data).toMatchObject({ target: "service", source: "user", serviceId: "S-1" }); expect(events.ofKind("audit_appended").at(-1)?.data).toMatchObject({ kind: "stop", source: "user" });
		expect(services.status(task.id, "S-1")).toMatchObject({ status: "stopped", ready: false }); expect(task.inputs).toEqual([]);
	}, 20000);
	it("matches readiness output without a port and records normal exit without waking the worker", async () => {
		const { services, task, run, invocation, gate } = await setup();
		const result = await services.start(task, run, { name: "pattern", command: "fixture", readyPattern: "APP_READY 中文" }, undefined, invocation("pattern"));
		expect(result).toMatchObject({ ready: true, status: "running" }); expect(result.port).toBeUndefined();
		const delayed = await services.start(task, run, { name: "late port", command: "fixture", readyPattern: "APP_READY" }, undefined, invocation("pattern-http"));
		expect(delayed.ready).toBe(true);
		await vi.waitFor(() => expect(services.status(task.id, delayed.serviceId).url).toMatch(/^http:\/\/127\.0\.0\.1:/), { timeout: 5000 });
		expect((await fetch(services.status(task.id, delayed.serviceId).url!)).status).toBe(200);
		writeFileSync(gate, "release"); await vi.waitFor(() => expect(task.services?.[0].status).toBe("exited"), { timeout: 10000 });
		expect(services.status(task.id, "S-1", 1).output).toBe("SERVICE_FINISHED"); expect(task.inputs).toEqual([]);
	}, 15000);
	it("returns ready=false after the window, stops only owned services and rejects invalid starts before execution", async () => {
		const { services, task, run, invocation, cwd, store } = await setup(1500);
		const result = await services.start(task, run, { name: "silent", command: "fixture" }, undefined, invocation("silent"));
		expect(result).toMatchObject({ ready: false, status: "running" });
		expect(() => services.status("T-else", "S-1")).toThrow("SERVICE_NOT_FOUND"); expect(() => services.stop("S-1", "worker", "T-else")).toThrow("SERVICE_NOT_FOUND");
		const read = createWorkerTools({ taskId: "T-dependent", dependsOn: [task.id], store, report: () => { throw new Error("unused"); } }).find(tool => tool.name === "task_read")!;
		expect(JSON.stringify(await read.execute("read", { view: "services", taskId: task.id }, undefined, undefined, {} as never))).toContain("NOT_VISIBLE");
		expect(JSON.stringify(await read.execute("card", { view: "card", taskId: task.id }, undefined, undefined, {} as never))).not.toContain('S-1');
		await expect(services.start(task, run, { name: "bad", command: "fixture", readyPattern: "[" }, undefined, invocation())).rejects.toThrow();
		await expect(services.start(task, run, { name: "bad", command: "fixture", port: 65536 }, undefined, invocation())).rejects.toThrow("SERVICE_PORT_INVALID");
		expect(task.services).toHaveLength(1); expect(existsSync(join(cwd, "jobs", "S-2.log"))).toBe(false);
		await services.stop("S-1", "worker", task.id); expect(services.status(task.id, "S-1").status).toBe("stopped");
	}, 15000);
	it("rejects an occupied port, keeps command failures honest and preserves startup atomicity", async () => {
		const { services, task, run, invocation, events } = await setup();
		const first = await services.start(task, run, { name: "http", command: "fixture" }, undefined, invocation());
		await expect(services.start(task, run, { name: "busy", command: "fixture", port: first.port }, undefined, invocation())).rejects.toThrow("SERVICE_PORT_IN_USE");
		const failed = await services.start(task, run, { name: "exit", command: "fixture" }, undefined, invocation("exit"));
		expect(failed).toMatchObject({ status: "exited", ready: false, exitCode: 7 }); expect(failed.output).toContain("中文 EXIT");
		vi.spyOn(events, "append").mockImplementationOnce(() => { throw new Error("fixture fact failure"); });
		await expect(services.start(task, run, { name: "fail", command: "fixture" }, undefined, invocation())).rejects.toThrow("fixture fact failure");
		expect(task.services).toHaveLength(2);
	}, 20000);
	it("keeps audit failures from stopping a service, and app shutdown stops it without task input", async () => {
		const { services, task, run, invocation, audit } = await setup();
		const result = await services.start(task, run, { name: "http", command: "fixture" }, undefined, invocation()); const child = Number(/PID (\d+)/.exec(result.output)?.[1]);
		vi.spyOn(audit, "append").mockImplementationOnce(() => { throw new Error("audit offline"); });
		expect(() => services.stop("S-1", "user")).toThrow("audit offline"); expect(alive(child)).toBe(true);
		await services.dispose(); expect(alive(child)).toBe(false); expect(task.services?.[0]).toMatchObject({ status: "stopped", reason: "shutdown" }); expect(task.inputs).toEqual([]);
	}, 15000);
	it("restores service facts and output from a snapshot, marks unfinished records interrupted and avoids log ID reuse", async () => {
		const { services, task, run, invocation, store, cwd, events, options } = await setup();
		await services.start(task, run, { name: "http", command: "fixture" }, undefined, invocation()); await services.stop("S-1", "worker", task.id);
		store.recordService({ ...task.services![0], id: "S-2", status: "running", ready: true, endedAt: undefined, reason: undefined }, "service_started");
		const snapshot = new TaskSnapshot(join(cwd, "snapshot.json"), events, () => {}); snapshot.flush(); snapshot.dispose(false);
		const saved = new TaskSnapshot(join(cwd, "snapshot.json"), events, () => {}); const restored = new TaskStore(events, cwd, () => {}, undefined, saved.replay()); saved.dispose(false);
		writeFileSync(join(options.directory, "S-20.log"), "before fact");
		const recovered = new ServiceManager({ ...options, store: restored });
		try {
			recovered.recover(); recovered.recover(); expect(restored.get(task.id)?.services?.[1]).toMatchObject({ status: "stopped", reason: "interrupted", ready: false }); expect(restored.get(task.id)?.inputs).toEqual([]);
			expect(recovered.status(task.id, "S-1").output).toContain("PID");
			expect((readTask(restored, restored.get(task.id)!, { view: "services" }).services as unknown[])).toHaveLength(2);
			const next = await recovered.start(restored.get(task.id)!, run, { name: "http", command: "fixture" }, undefined, invocation()); expect(next.serviceId).toBe("S-21");
		} finally { await recovered.dispose(); }
	}, 20000);
});
