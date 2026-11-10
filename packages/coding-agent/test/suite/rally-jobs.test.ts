import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { TaskSnapshot } from "../../../../src/main/supervisor/task-snapshot.ts";
import { JobManager } from "../../../../src/main/supervisor/jobs.ts";
import { shellCommand } from "../../../../src/main/supervisor/job-tools.ts";
import { ProcessRegistry } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { resolveRallyPaths } from "../../../../src/main/paths.ts";
import { stopProcessTree } from "../../../../src/main/supervisor/process-identity.ts";
import type { OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally jobs with offline real subprocesses", () => {
	const harnesses: Harness[] = []; const cleanups: (() => Promise<void>)[] = [];
	const fixture = fileURLToPath(new URL("../fixtures/rally-job.cjs", import.meta.url));
	const safeEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" });
	afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup(foregroundSeconds = 0.02, deliver = true) {
		const harness = await createHarness(); harnesses.push(harness); const cwd = harness.tempDir;
		const lock = new StateDirectoryLock(join(cwd, "state"));
		const events = new EventLog(join(cwd, "state", "events-0001.jsonl"), undefined, () => lock.assertHeld());
		const store = new TaskStore(events, cwd, () => {});
		const task = store.create({ title: "jobs", quotes: [], cwd, scope: [], mode: "write", dependsOn: [], autoApprove: true }).task;
		const run = store.startRun(task.id, "dispatch", "fixture");
		const processes = new ProcessRegistry(join(cwd, "state"), { assertWritable: () => lock.assertHeld(), graceMs: 50 });
		const completed: string[] = []; const failures: unknown[] = [];
		const settingsFile = join(cwd, "settings.json"); const directory = join(cwd, "jobs");
		const options = { store, processes, directory, settingsFile, foregroundSeconds, stopGraceMs: 50,
			onDone: (job: Parameters<TaskStore["jobDone"]>[0], text: string) => { completed.push(text); if (deliver) store.jobDone(job, text); }, onBusyChange: () => {}, onError: (error: unknown) => { failures.push(error); } };
		const jobs = new JobManager(options);
		cleanups.push(async () => { await jobs.dispose(); await processes.dispose(); events.close(); lock.release(); expect(failures).toEqual([]); });
		const gate = join(cwd, "release.json");
		const invocation = { executable: process.execPath, args: [fixture, gate], cwd, env: safeEnv() };
		return { cwd, events, store, task, run, jobs, completed, invocation, gate, options, processes, settingsFile };
	}
	const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

	it("returns foreground exit code, duration, UTF-8 output and full log without a completion wake", async () => {
		const { jobs, task, run, invocation, completed } = await setup(10);
		const result = await jobs.execute(task, run, "bash", "fixture", { ...invocation, args: ["-e", "console.log('前台 ✓');process.exit(3)"] });
		expect(result).toMatchObject({ exitCode: 3, output: "前台 ✓", durationMs: expect.any(Number) });
		expect(readFileSync(result.logPath, "utf8")).toBe("前台 ✓\n"); expect(completed).toEqual([]); expect(task.jobs?.[0].status).toBe("exited");
	}, 15000);

	it("returns to the worker, detaches tool cancellation, reads immediately and delivers one bounded completion", async () => {
		const { jobs, task, run, invocation, gate, completed, store } = await setup(); const controller = new AbortController();
		const result = await jobs.execute(task, run, "bash", "fixture", invocation, undefined, controller.signal);
		expect(result).toMatchObject({ background: true, jobId: "J-1" }); controller.abort();
		await vi.waitFor(() => expect(jobs.output(task.id, "J-1").output).toContain("READY"), { timeout: 10000 });
		expect(jobs.hasRunning(task.id)).toBe(true); expect(jobs.output(task.id, "J-1").status).toBe("running");
		const pid = Number(/READY (\d+)/.exec(jobs.output(task.id, "J-1").output)?.[1]); expect(alive(pid)).toBe(true);
		writeFileSync(gate, JSON.stringify({ exitCode: 7 }));
		await vi.waitFor(() => expect(task.jobs?.[0].status).toBe("exited"), { timeout: 10000 });
		expect(jobs.hasRunning(task.id)).toBe(false); expect(completed).toHaveLength(1);
		expect(completed[0]).toContain('exit="7"'); expect(completed[0]).toContain("line-250 中文"); expect(completed[0]).not.toContain("line-1 中文");
		expect(jobs.output(task.id, "J-1", 2).output).toBe("line-250 中文\nJOB_FINISHED_SENTINEL");
		expect(task.inputs.filter(input => input.kind === "job_done")).toHaveLength(1);
		expect(store.jobDone(task.jobs![0], "duplicate")).toBeNull();
	}, 15000);

	it("enforces task ownership and kills every running job on task termination without waking", async () => {
		const { jobs, task, run, invocation, store, completed } = await setup();
		await Promise.all([jobs.execute(task, run, "bash", "first", invocation), jobs.execute(task, run, "bash", "second", invocation)]);
		await vi.waitFor(() => expect(task.jobs?.every(job => jobs.output(task.id, job.id).output.includes("READY"))).toBe(true), { timeout: 10000 });
		expect(() => jobs.output("T-else", "J-1")).toThrow("JOB_NOT_FOUND"); await expect(jobs.kill("T-else", "J-1")).rejects.toThrow("JOB_NOT_FOUND");
		const pids = task.jobs!.map(job => Number(/READY (\d+)/.exec(jobs.output(task.id, job.id).output)?.[1]));
		store.cancelRunning(task.id, "main", { actor: "user", basis: [] });
		expect(await jobs.killTask(task.id)).toBe(2); expect(task.jobs?.every(job => job.status === "killed")).toBe(true); expect(pids.every(pid => !alive(pid))).toBe(true);
		expect(completed).toEqual([]); expect(task.inputs).toEqual([]);
	}, 15000);

	it("uses immediate force termination for explicit timeout and ordinary job_kill remains observable", async () => {
		const { jobs, task, run, invocation, completed } = await setup(); const started = Date.now();
		await jobs.execute(task, run, "bash", "timeout fixture", invocation, 1.5);
		await vi.waitFor(() => expect(task.jobs?.[0]).toMatchObject({ status: "killed", reason: "timeout", exitCode: 124 }), { timeout: 6000 });
		expect(Date.now() - started).toBeLessThan(5000); expect(completed).toHaveLength(1);
		await jobs.execute(task, run, "bash", "kill fixture", invocation);
		expect(await jobs.kill(task.id, "J-2")).toEqual({ killed: true }); expect(jobs.output(task.id, "J-2").status).toBe("killed"); expect(completed).toHaveLength(2);
	}, 15000);

	it("restores job facts and logs from snapshots, repairs a missing completion input and never reuses a log ID", async () => {
		const { jobs, task, run, invocation, gate, events, cwd, options } = await setup(0.02, false);
		await jobs.execute(task, run, "bash", "fixture", invocation); writeFileSync(gate, '{"exitCode":0}');
		await vi.waitFor(() => expect(task.jobs?.[0].status).toBe("exited"), { timeout: 10000 }); expect(task.inputs).toEqual([]);
		const snapshot = new TaskSnapshot(join(cwd, "snapshot.json"), events, () => {}); snapshot.flush(); snapshot.dispose(false);
		const saved = new TaskSnapshot(join(cwd, "snapshot.json"), events, () => {});
		const restored = new TaskStore(events, cwd, () => {}, undefined, saved.replay()); saved.dispose(false);
		writeFileSync(join(options.directory, "J-20.log"), "orphan before job_started");
		const recovered = new JobManager({ ...options, store: restored });
		try {
			recovered.recover(); recovered.recover(); expect(restored.get(task.id)?.inputs.filter(input => input.kind === "job_done")).toHaveLength(1);
			restored.recordJob({ ...task.jobs![0], id: "J-19", status: "running", endedAt: undefined, exitCode: undefined }, "job_started");
			recovered.recover(); recovered.recover();
			expect(restored.get(task.id)?.jobs?.find(job => job.id === "J-19")).toMatchObject({ status: "killed", reason: "interrupted" });
			expect(restored.get(task.id)?.inputs.filter(input => input.kind === "job_done")).toHaveLength(1);
			expect(recovered.output(task.id, "J-1", 1).output).toBe("JOB_FINISHED_SENTINEL");
			const result = await recovered.execute(restored.get(task.id)!, run, "bash", "next", invocation); expect(result).toMatchObject({ background: true, jobId: "J-21" });
		} finally { await recovered.dispose(); }
	}, 15000);

	it("reads the foreground setting, rejects polling guards, and preserves shell cwd/env/UTF-8", async () => {
		const { jobs, task, run, options, invocation, settingsFile, cwd } = await setup();
		for (const command of ["sleep 2", " Start-Sleep -Seconds 2", "timeout /t 9", "timeout.exe /t 9"]) expect(() => shellCommand("bash", command, task)).toThrow("NO_POLLING");
		const bash = shellCommand("bash", "printf '中文 ✓'", task); bash.env = { ...safeEnv(), ...Object.fromEntries(Object.entries(bash.env).filter(([key]) => /^(?:RALLY_|LANG|LC_ALL|PYTHONIO)/.test(key))) };
		expect(bash.cwd).toBe(task.cwd); expect(bash.env.RALLY_TASK_ID).toBe(task.id);
		writeFileSync(settingsFile, `\uFEFF${JSON.stringify({ jobs: { foregroundSeconds: 10 } })}`);
		const configured = new JobManager({ ...options, foregroundSeconds: undefined });
		try {
			const result = await configured.execute(task, run, "bash", "printf", bash); expect(result).toMatchObject({ exitCode: 0, output: "中文 ✓" });
			if (process.platform === "win32") {
				const ps = shellCommand("powershell", "Write-Output '中文 ✓'", task); ps.env = safeEnv();
				expect(await configured.execute(task, run, "powershell", "Write-Output", ps)).toMatchObject({ exitCode: 0, output: "中文 ✓" });
			}
			writeFileSync(settingsFile, JSON.stringify({ jobs: { foregroundSeconds: -1 } }));
			await expect(configured.execute(task, run, "bash", "invalid", invocation)).rejects.toThrow("JOB_SETTINGS_INVALID");
			const controller = new AbortController(); controller.abort();
			await expect(jobs.execute(task, run, "bash", "aborted", invocation, undefined, controller.signal)).rejects.toThrow();
			expect(existsSync(join(cwd, "never"))).toBe(false);
		} finally { await configured.dispose(); }
	}, 20000);

	it("does not spawn when the initial job fact fails, and does not expose an uncommitted completion input", async () => {
		const { jobs, task, run, invocation, events, store } = await setup(10);
		vi.spyOn(events, "append").mockImplementationOnce(() => { throw new Error("fixture job write failed"); });
		await expect(jobs.execute(task, run, "bash", "must not launch", invocation)).rejects.toThrow("fixture job write failed");
		expect(task.jobs).toBeUndefined(); expect(jobs.activeTaskIds()).toEqual([]);
		const job = { id: "J-2", taskId: task.id, runId: run.id, shell: "bash" as const, command: "completed fixture", cwd: task.cwd, status: "exited" as const, startedAt: Date.now(), endedAt: Date.now(), backgroundedAt: Date.now(), exitCode: 0 };
		store.recordJob(job, "job_exited");
		vi.spyOn(events, "append").mockImplementationOnce(() => { throw new Error("fixture input write failed"); });
		expect(() => store.jobDone(job, "completion")).toThrow("fixture input write failed"); expect(task.inputs).toEqual([]);
		expect(store.jobDone(job, "completion")?.jobId).toBe("J-2");
	});

	it("cleans an orphaned running job before recovery marks its run interrupted, preserving output without waking it", async () => {
		const harness = await createHarness(); harnesses.push(harness); const paths = resolveRallyPaths(harness.tempDir);
		const owner = spawn(process.execPath, [fileURLToPath(new URL("../fixtures/rally-job-owner.ts", import.meta.url)), harness.tempDir], { env: safeEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
		let diagnostics = ""; owner.stderr?.on("data", data => { diagnostics += data; });
		let entries: OwnedProcess[] = []; let supervisor: Supervisor | undefined;
		try {
			const ready = (await once(owner, "message"))[0] as { type: string; taskId: string }; expect(ready.type).toBe("ready");
			const log = join(paths.jobsDir, "J-1.log");
			await vi.waitFor(() => expect(readFileSync(log, "utf8"), diagnostics + readFileSync(paths.eventsFile, "utf8").split("\n").filter(Boolean).at(-1)).toContain("READY"), { timeout: 10000 });
			entries = JSON.parse(readFileSync(join(paths.stateDir, "processes.json"), "utf8")).processes;
			expect(entries).toMatchObject([{ kind: "job", taskId: ready.taskId, jobId: "J-1" }]);
			const pid = Number(/READY (\d+)/.exec(readFileSync(log, "utf8"))?.[1]);
			const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited; expect(alive(pid)).toBe(true);
			supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
			await supervisor.start(); expect(alive(pid)).toBe(false);
			const task = supervisor.store.get(ready.taskId)!;
			expect(task.jobs?.[0]).toMatchObject({ status: "killed", reason: "interrupted" });
			expect(task.runs.at(-1)?.endReason).toBe("interrupted"); expect(task.inputs).toEqual([]);
			expect(supervisor.jobs.output(task.id, "J-1").output).toContain("READY"); expect(supervisor.jobs.activeTaskIds()).toEqual([]);
		} finally {
			if (owner.exitCode === null && owner.signalCode === null) { const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited; }
			const registryFile = join(paths.stateDir, "processes.json");
			if (!entries.length && existsSync(registryFile)) entries = JSON.parse(readFileSync(registryFile, "utf8")).processes;
			for (const entry of entries) await stopProcessTree(entry, 0);
			await supervisor?.dispose();
		}
	}, 25000);
});
