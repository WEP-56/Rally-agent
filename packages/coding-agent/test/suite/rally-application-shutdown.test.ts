import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationShutdown, APPLICATION_SHUTDOWN_MS } from "../../../../src/main/application-shutdown.ts";
import { ProcessShutdownGuard } from "../../../../src/main/shutdown-guard.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { resolveRallyPaths } from "../../../../src/main/paths.ts";
import { createHarness, type Harness } from "./harness.ts";

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
describe("Rally application exit deadline (no UI)", () => {
	const harnesses: Harness[] = []; const children: ChildProcess[] = []; const supervisors: Supervisor[] = [];
	afterEach(async () => {
		vi.useRealTimers(); vi.restoreAllMocks();
		for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; }
		await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose()));
		for (const harness of harnesses.splice(0)) harness.cleanup();
	}, 30000);
	it("arms before cleanup, drains once, cancels the guard and exits only after all writes finish", async () => {
		const order: string[] = []; let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
		const app = new ApplicationShutdown({ guard: { arm: async ms => { expect(ms).toBe(APPLICATION_SHUTDOWN_MS); order.push("armed"); }, cancel: async () => { order.push("cancelled"); } },
			close: async () => { order.push("closing"); await hold; order.push("saved"); }, exit: code => { order.push(`exit:${code}`); }, report: () => {} });
		const pending = app.run(); expect(app.run()).toBe(pending); await vi.waitFor(() => expect(order).toEqual(["armed", "closing"]));
		release(); await pending; expect(order).toEqual(["armed", "closing", "saved", "cancelled", "exit:0"]);
	});
	it("retains a failure exit code and handles guard startup failure without skipping cleanup", async () => {
		const errors: unknown[] = []; const exit = vi.fn(); const close = vi.fn(async () => { throw new Error("close failed"); }); const cancel = vi.fn(async () => {});
		const app = new ApplicationShutdown({ close, exit, report: error => { errors.push(error); }, guard: { arm: async () => { throw new Error("guard failed"); }, cancel } });
		await app.run(true); expect(close).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce(); expect(exit).toHaveBeenCalledExactlyOnceWith(1); expect(errors).toHaveLength(2);
	});
	it("uses the local fallback deadline if the helper fails, without declaring cleanup complete", async () => {
		vi.useFakeTimers(); let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); const exit = vi.fn(); const report = vi.fn();
		const app = new ApplicationShutdown({ timeoutMs: 100, close: () => pending, exit, report, guard: { arm: async () => { throw new Error("missing helper"); }, cancel: async () => {} } });
		const closing = app.run(); await vi.advanceTimersByTimeAsync(15100); expect(exit).toHaveBeenCalledExactlyOnceWith(1); expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("APPLICATION_SHUTDOWN_TIMEOUT") }));
		release(); await closing; expect(exit).toHaveBeenCalledOnce();
	});
	it("exits with an error if guard cancellation fails, after cleanup completed", async () => {
		const close = vi.fn(async () => {}); const exit = vi.fn(); const report = vi.fn(); const failure = new Error("guard cancellation failed");
		const app = new ApplicationShutdown({ close, exit, report, guard: { arm: async () => {}, cancel: async () => { throw failure; } } });
		await app.run(); expect(close).toHaveBeenCalledOnce(); expect(report).toHaveBeenCalledWith(failure); expect(exit).toHaveBeenCalledExactlyOnceWith(1);
	});
	it("still cleans up a failed startup when shutdown preparation rejects", async () => {
		const harness = await createHarness(); harnesses.push(harness); const paths = resolveRallyPaths(harness.tempDir);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, onStartupFailure: async () => { throw new Error("guard preparation failed"); } }); supervisors.push(supervisor);
		vi.spyOn(supervisor.main, "start").mockRejectedValue(new Error("startup failed")); const dispose = vi.spyOn(supervisor, "dispose");
		await expect(supervisor.start()).rejects.toThrow("Rally startup and cleanup failed"); expect(dispose).toHaveBeenCalledOnce();
		const lock = new StateDirectoryLock(paths.stateDir); lock.release();
	});
	it("rejects a missing guard executable and allows repeated cleanup", async () => {
		const guard = new ProcessShutdownGuard(join(process.cwd(), "missing-shutdown-host.ts"));
		await expect(guard.arm(60000)).rejects.toThrow("SHUTDOWN_GUARD_EXITED"); const closed = guard.cancel(); expect(guard.cancel()).toBe(closed); await closed;
	});
	it.each(["hang", "block", "startup", "normal"])("exits a real %s owner and its tree, preserving lock exclusivity and restart recovery", async mode => {
		const harness = await createHarness(); harnesses.push(harness); const paths = resolveRallyPaths(harness.tempDir);
		const env = { ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1", RALLY_CODING_AGENT_DIR: paths.agentDir };
		const child = spawn(process.execPath, [fileURLToPath(new URL("../fixtures/rally-shutdown-owner.ts", import.meta.url)), harness.tempDir, mode], { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(child);
		let diagnostics = ""; child.stderr?.on("data", data => { diagnostics += data; });
		const [ready] = await once(child, "message") as [{ type: string; taskId: string; pids: { root: number; leaf: number }; entries: { pid: number }[] }]; expect(ready.type, diagnostics).toBe("ready");
		const armed = once(child, "message"); const exited = once(child, "exit"); child.send("shutdown"); expect((await armed)[0]).toMatchObject({ type: "armed" });
		expect(() => new StateDirectoryLock(paths.stateDir)).toThrow("STATE_DIRECTORY_LOCKED");
		const [code] = await exited; expect(code === 0).toBe(mode === "normal");
		for (const pid of [ready.pids.root, ready.pids.leaf, ...ready.entries.map(entry => entry.pid)]) await vi.waitFor(() => expect(alive(pid), `survivor ${pid}: ${diagnostics}`).toBe(false), { timeout: 3000 });
		const restored = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(restored); await restored.start();
		expect(restored.store.get(ready.taskId)?.runs[0].endReason).toBe("interrupted");
	}, 20000);
});
