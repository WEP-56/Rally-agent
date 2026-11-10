import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { managedGitRunner } from "../../../../src/main/supervisor/git-runner.ts";
import { processIdentity, stopProcessTree } from "../../../../src/main/supervisor/process-identity.ts";
import { ProcessRegistry, type OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally owned process lifecycle (offline real processes)", () => {
	const harnesses: Harness[] = [];
	const registries: ProcessRegistry[] = [];
	const locks: StateDirectoryLock[] = [];
	const children: ChildProcess[] = [];
	const supervisors: Supervisor[] = [];
	const tree = fileURLToPath(new URL("../fixtures/rally-process-tree.cjs", import.meta.url));
	const safeEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" });
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose()));
		await Promise.all(registries.splice(0).map(registry => registry.dispose()));
		for (const child of children.splice(0)) {
			if (child.exitCode !== null || child.signalCode !== null) continue;
			const closed = once(child, "close"); child.kill("SIGKILL"); await closed;
		}
		for (const lock of locks.splice(0)) lock.release();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const cwd = harness.tempDir; const state = join(cwd, "state");
		const lock = new StateDirectoryLock(state); locks.push(lock);
		const stopped: { entry: OwnedProcess; reason: string; result: string }[] = [];
		const registry = new ProcessRegistry(state, { assertWritable: () => lock.assertHeld(), graceMs: 60, onStopped: (entry, reason, result) => { stopped.push({ entry, reason, result }); } });
		registries.push(registry);
		return { cwd, state, registry, stopped, lock };
	}
	function command(cwd: string, ...args: string[]) { return { executable: process.execPath, args: [tree, ...args], cwd, env: safeEnv() }; }
	function empty(registry: ProcessRegistry) { expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]); }
	function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }

	it("persists identity before executing and drains UTF-8 output without persisting environment secrets", async () => {
		const { cwd, registry, stopped } = await setup(); let output = ""; let stderr = "";
		const run = command(cwd, "inspect", registry.file); run.env = { ...run.env, RALLY_TEST_SENTINEL: "private-fixture" };
		expect(await registry.run(run, { kind: "git", taskId: "T-1" }, { onStdout: data => { output += data; }, onStderr: data => { stderr += data; } })).toBe(0);
		const [first, ...lines] = output.split("\n"); const observed = JSON.parse(first);
		expect(observed).toMatchObject({ sentinel: "private-fixture", entries: [{ pid: observed.parent, taskId: "T-1" }] });
		expect(lines.join("\n")).toBe("完成 ✓\n".repeat(20000)); expect(stderr).toBe("stderr ✓\n");
		expect(JSON.stringify(observed.entries)).not.toContain("private-fixture");
		expect(stopped).toMatchObject([{ reason: "completed", result: "killed" }]); empty(registry);
	}, 20000);

	it("cancels the real command and its child, then removes the durable entry", async () => {
		const { cwd, registry, stopped } = await setup(); const controller = new AbortController();
		let ready!: (pids: { root: number; leaf: number }) => void; let output = "";
		const observed = new Promise<{ root: number; leaf: number }>(resolve => { ready = resolve; });
		const result = registry.run(command(cwd), { kind: "git" }, { signal: controller.signal, onStdout: data => { output += data; if (output.includes("\n")) ready(JSON.parse(output.trim())); }, onStderr: () => {} });
		const rejected = expect(result).rejects.toThrow("PROCESS_ABORTED");
		const pids = await observed; expect(alive(pids.root)).toBe(true); expect(alive(pids.leaf)).toBe(true);
		controller.abort(); await rejected;
		expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false); empty(registry);
		expect(stopped).toMatchObject([{ reason: "cancelled", result: "killed" }]);
	}, 20000);

	it("skips a live PID with a different creation time and preserves a malformed registry", async () => {
		const { cwd, registry, lock, stopped, state } = await setup();
		const child = spawn(process.execPath, [tree, "leaf"], { cwd, env: safeEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); children.push(child);
		await once(child.stdout!, "data"); const identity = await processIdentity(child.pid!); expect(identity).toBeDefined();
		const entry = { ...identity!, created: `${identity!.created}0`, id: randomUUID(), kind: "git" };
		writeFileSync(registry.file, JSON.stringify({ version: 1, processes: [entry, { ...entry, id: randomUUID(), pid: process.pid }] }));
		const recovered = new ProcessRegistry(state, { assertWritable: () => lock.assertHeld(), onStopped: (item, reason, result) => { stopped.push({ entry: item, reason, result }); } }); registries.push(recovered);
		await recovered.recover(); expect(alive(child.pid!)).toBe(true); empty(recovered);
		expect(stopped).toHaveLength(2); expect(stopped.every(item => item.result === "identity_mismatch" && item.reason === "recovery")).toBe(true);
		const damaged = '{"version":1,"processes":[{"pid":2}]}'; writeFileSync(registry.file, damaged);
		expect(() => new ProcessRegistry(state, { assertWritable: () => lock.assertHeld() })).toThrow("PROCESS_REGISTRY_INVALID");
		expect(readFileSync(registry.file, "utf8")).toBe(damaged);
	}, 20000);

	it("never executes a command when registry persistence fails, and can dispose after that failure", async () => {
		const { cwd, registry } = await setup(); mkdirSync(registry.file);
		const marker = join(cwd, "must-not-exist");
		await expect(registry.run(command(cwd, "mark", marker), { kind: "git" }, { onStdout: () => {}, onStderr: () => {} })).rejects.toThrow();
		expect(existsSync(marker)).toBe(false); await registry.dispose();
	}, 20000);

	it("stops admitted commands during disposal and rejects subsequent work", async () => {
		const { cwd, registry } = await setup(); let ready!: () => void;
		const observed = new Promise<void>(resolve => { ready = resolve; });
		const result = registry.run(command(cwd), { kind: "git" }, { onStdout: () => ready(), onStderr: () => {} });
		const rejected = expect(result).rejects.toThrow("PROCESS_ABORTED"); await observed;
		await registry.dispose(); await rejected; empty(registry);
		await expect(registry.run(command(cwd), { kind: "git" }, { onStdout: () => {}, onStderr: () => {} })).rejects.toThrow("PROCESS_REGISTRY_CLOSED");
	}, 20000);

	it("keeps failed termination facts recoverable and reports shutdown failure", async () => {
		const { cwd, state, lock } = await setup();
		const broken = new ProcessRegistry(state, { assertWritable: () => lock.assertHeld(), onStopped: () => { throw new Error("fixture event write failed"); } });
		await expect(broken.run(command(cwd, "mark", join(cwd, "ran")), { kind: "git" }, { onStdout: () => {}, onStderr: () => {} })).rejects.toThrow("fixture event write failed");
		const entries = JSON.parse(readFileSync(broken.file, "utf8")).processes as OwnedProcess[];
		expect(entries).toHaveLength(1); expect(alive(entries[0].pid)).toBe(false);
		await expect(broken.run(command(cwd), { kind: "git" }, { onStdout: () => {}, onStderr: () => {} })).rejects.toThrow("PROCESS_REGISTRY_FAILED");
		await expect(broken.dispose()).rejects.toThrow("PROCESS_SHUTDOWN_FAILED");
		expect(() => new StateDirectoryLock(state)).toThrow("STATE_DIRECTORY_LOCKED");
		const recovered = new ProcessRegistry(state, { assertWritable: () => lock.assertHeld() }); registries.push(recovered);
		await recovered.recover(); empty(recovered);
	}, 20000);

	it("cleans a missing executable and rejects a pre-aborted command before launch", async () => {
		const { cwd, registry } = await setup();
		await expect(registry.run({ ...command(cwd), executable: join(cwd, "missing-command.exe") }, { kind: "git" }, { onStdout: () => {}, onStderr: () => {} })).rejects.toThrow("PROCESS_EXEC_FAILED");
		empty(registry);
		const controller = new AbortController(); controller.abort(); const marker = join(cwd, "never");
		await expect(registry.run(command(cwd, "mark", marker), { kind: "git" }, { signal: controller.signal, onStdout: () => {}, onStderr: () => {} })).rejects.toThrow();
		expect(existsSync(marker)).toBe(false); empty(registry);
	}, 20000);

	it("recovers a crashed owner's tree before starting the real Supervisor main session", async () => {
		const harness = await createHarness(); harnesses.push(harness);
		const cwd = harness.tempDir; const paths = resolveRallyPaths(cwd);
		const owner = spawn(process.execPath, [fileURLToPath(new URL("../fixtures/rally-process-owner.ts", import.meta.url)), cwd], { env: safeEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(owner);
		const ready = (await once(owner, "message"))[0] as { type: string; root: number; leaf: number }; expect(ready.type).toBe("ready");
		const entries = JSON.parse(readFileSync(join(paths.stateDir, "processes.json"), "utf8")).processes as OwnedProcess[];
		const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
		expect(alive(ready.root)).toBe(true); expect(alive(ready.leaf)).toBe(true);
		const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} }); supervisors.push(supervisor);
		const start = supervisor.main.start.bind(supervisor.main);
		vi.spyOn(supervisor.main, "start").mockImplementationOnce(async () => {
			expect(alive(ready.root)).toBe(false); expect(alive(ready.leaf)).toBe(false); expect(alive(entries[0].pid)).toBe(false);
			await start();
		});
		try {
			await supervisor.start(); empty(supervisor.processes);
			expect(supervisor.events.ofKind("process_stopped")).toMatchObject([{ data: { reason: "recovery", result: "killed", taskId: "fixture-owner" } }]);
		} finally { for (const entry of entries) await stopProcessTree(entry, 0); }
	}, 25000);

	it("executes managed Git with separate metadata stderr and retains the real exit code", async () => {
		const { cwd, registry, stopped } = await setup(); const git = managedGitRunner(registry, "T-git");
		const version = await git(cwd, ["--version"], { outputDir: cwd, readonly: true }); expect(version.output).toContain("git version"); expect(version.exitCode).toBe(0);
		const failed = await git(cwd, ["status"], { outputDir: cwd, metadata: true, readonly: true }); expect(failed.exitCode).not.toBe(0); expect(failed.output).toBe("");
		expect(stopped.every(item => item.entry.taskId === "T-git")).toBe(true); empty(registry);
	}, 20000);

	it("passes explicit UTF-8 stdin to the managed command", async () => {
		const { cwd, registry } = await setup(); let output = "";
		const result = await registry.run({ executable: process.execPath, args: ["-e", "process.stdin.setEncoding('utf8');process.stdin.on('data',data=>process.stdout.write(data));"], stdin: "stdin 中文 ✓\n", cwd, env: safeEnv() }, { kind: "git" }, { onStdout: text => { output += text; }, onStderr: () => {} });
		expect(result).toBe(0); expect(output).toBe("stdin 中文 ✓\n"); empty(registry);
	}, 15000);
});
