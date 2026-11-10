import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally state directory OS lock", () => {
	const harnesses: Harness[] = [];
	const locks: StateDirectoryLock[] = [];
	const children: ChildProcess[] = [];
	afterEach(async () => {
		await Promise.all(children.splice(0).map(async child => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
		}));
		for (const lock of locks.splice(0)) lock.release();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		return join(harness.tempDir, "state");
	}
	function acquire(dir: string) { const lock = new StateDirectoryLock(dir); locks.push(lock); return lock; }
	async function child(dir: string, executable = process.execPath, fixture = "rally-state-lock-child.ts") {
		const env = Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
		const worker = spawn(executable, [fileURLToPath(new URL(`../fixtures/${fixture}`, import.meta.url)), dir], {
			stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true, env: { ...env, ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" },
		});
		children.push(worker);
		expect((await once(worker, "message"))[0]).toEqual({ type: "ready" });
		return worker;
	}
	async function command(child: ChildProcess, command: string) {
		const response = once(child, "message"); child.send(command); return (await response)[0] as { type: string; error?: string };
	}
	it("excludes the same directory and junction aliases, permits independent directories and never removes the lock file", async () => {
		const dir = await setup(); const first = acquire(dir);
		expect(() => acquire(dir)).toThrow("STATE_DIRECTORY_LOCKED");
		const alias = `${dir}-alias`; symlinkSync(dir, alias, process.platform === "win32" ? "junction" : "dir");
		expect(() => acquire(alias)).toThrow("STATE_DIRECTORY_LOCKED");
		acquire(`${dir}-other`).assertHeld();
		first.release(); first.release();
		expect(existsSync(first.file)).toBe(true);
		expect(() => first.assertHeld()).toThrow("STATE_DIRECTORY_UNLOCKED");
		acquire(alias).assertHeld();
	});
	it("retains ownership with a blocked event loop and recovers immediately after a killed owner", async () => {
		const dir = await setup(); const owner = await child(dir);
		expect(await command(owner, "acquire")).toEqual({ type: "acquired" });
		expect(await command(owner, "block")).toEqual({ type: "blocked" });
		expect(() => acquire(dir)).toThrow("STATE_DIRECTORY_LOCKED");
		const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
		const next = acquire(dir); next.assertHeld(); expect(existsSync(next.file)).toBe(true);
	});
	it("has exactly one winner when separate processes race to create the initial lock", async () => {
		const dir = await setup(); const racers = await Promise.all(Array.from({ length: 4 }, () => child(dir)));
		const results = await Promise.all(racers.map(racer => command(racer, "acquire")));
		expect(results.filter(result => result.type === "acquired")).toHaveLength(1);
		expect(results.filter(result => result.error?.includes("STATE_DIRECTORY_LOCKED"))).toHaveLength(3);
		const winner = racers[results.findIndex(result => result.type === "acquired")];
		expect(await command(winner, "release")).toEqual({ type: "released" });
		acquire(dir).assertHeld();
	});
	it("preserves a damaged lock file and closes the failed connection", async () => {
		const dir = await setup(); const first = acquire(dir); first.release();
		const damaged = "invalid sqlite file".repeat(50); writeFileSync(first.file, damaged);
		expect(() => acquire(dir)).toThrow("STATE_DIRECTORY_LOCK_FAILED");
		expect(readFileSync(first.file, "utf8")).toBe(damaged);
		// Repair this disposable fixture only; production never deletes or replaces lock files.
		writeFileSync(first.file, ""); acquire(dir).assertHeld();
	});
	it.skipIf(process.platform !== "win32")("shares the OS lock with the shipped Electron runtime in Node mode", async () => {
		const dir = await setup();
		const electron = fileURLToPath(new URL("../../../../node_modules/electron/dist/electron.exe", import.meta.url));
		const owner = await child(dir, electron);
		expect(await command(owner, "acquire")).toEqual({ type: "acquired" });
		expect(() => acquire(dir)).toThrow("STATE_DIRECTORY_LOCKED");
		expect(await command(owner, "release")).toEqual({ type: "released" });
		acquire(dir).assertHeld();
	});
	it("retains Supervisor ownership after a session shutdown failure until the process exits", async () => {
		const home = await setup(); const dir = join(home, ".rally", "state");
		const owner = await child(home, process.execPath, "rally-shutdown-lock-child.ts");
		expect(await command(owner, "shutdown-failure")).toMatchObject({ type: "failed", error: expect.stringContaining("state lock retained until exit") });
		expect(() => acquire(dir)).toThrow("STATE_DIRECTORY_LOCKED");
		const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited;
		acquire(dir).assertHeld();
	}, 15000);
});
