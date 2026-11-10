import { existsSync, readFileSync } from "node:fs";
import { fork } from "node:child_process";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { TerminalSession, terminalShell } from "../../../../src/main/terminal-session.ts";
import { processIdentity } from "../../../../src/main/supervisor/process-identity.ts";
import { terminalSize } from "../../../../src/shared/terminal.ts";
import type { TerminalMessage } from "../../../../src/main/terminal-protocol.ts";
import { createHarness, type Harness } from "./harness.ts";

const fixture = resolve("test/fixtures/rally-terminal.cjs");
const safeEnv = () => Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP", "ProgramFiles"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
async function until(check: () => boolean, timeout = 10000) { const end = Date.now() + timeout; while (!check()) { if (Date.now() >= end) throw new Error("Terminal fixture timed out"); await delay(20); } }
describe.skipIf(process.platform !== "win32")("Rally user terminal (real ConPTY, no UI/API)", () => {
	const harnesses: Harness[] = []; const sessions: TerminalSession[] = [];
	afterEach(async () => { await Promise.all(sessions.splice(0).map(session => session.close())); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup(autoAck = true) {
		const harness = await createHarness(); harnesses.push(harness); const messages: TerminalMessage[] = []; let output = ""; let seq = 0;
		const session = new TerminalSession({ cwd: harness.tempDir, size: { cols: 100, rows: 30 }, shell: process.execPath, args: [fixture], env: safeEnv() }, message => {
			messages.push(message); if (message.type === "data") { output += message.data; seq = message.seq; if (autoAck) session.ack(seq); }
		}); sessions.push(session);
		await session.start(); await until(() => output.includes('"ready":true'));
		return { session, harness, messages, output: () => output, seq: () => seq };
	}
	it("selects PowerShell and rejects invalid dimensions", () => {
		expect(existsSync(terminalShell())).toBe(true); expect(terminalShell({ SystemRoot: process.env.SystemRoot, ProgramFiles: "Z:\\missing", PATH: "" })).toMatch(/WindowsPowerShell/);
		for (const size of [{ cols: 0, rows: 10 }, { cols: 80, rows: NaN }, { cols: 10000, rows: 10 }]) expect(() => terminalSize(size)).toThrow("TERMINAL_SIZE_INVALID");
	});
	it("starts in the real cwd, streams UTF-8, resizes, accepts Ctrl+C and reports exit", async () => {
		const { session, harness, output, messages } = await setup();
		expect(output()).toContain('"tty":true'); expect(output()).toContain(JSON.stringify(harness.tempDir)); expect(output()).not.toContain('"electron"');
		session.write("中文🙂\r"); await until(() => output().includes('"echo":"中文🙂"'));
		session.resize({ cols: 120, rows: 40 }); await until(() => output().includes('"cols":120'));
		session.write("\x03"); await until(() => output().includes('"interrupted":true'));
		session.write("exit\r"); await until(() => messages.some(message => message.type === "exit")); expect(messages).toContainEqual({ type: "exit", exitCode: 7 });
	}, 25000);
	it("runs the selected real PowerShell in the requested directory", async () => {
		const harness = await createHarness(); harnesses.push(harness); let output = ""; let code: number | undefined;
		const session = new TerminalSession({ cwd: harness.tempDir, size: { cols: 160, rows: 40 }, env: safeEnv(), args: ["-NoLogo", "-NoProfile", "-Command", "[Console]::WriteLine(('RALLY' + '_PS:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path)))); exit 0"] }, message => { if (message.type === "data") { output += message.data; session.ack(message.seq); } if (message.type === "exit") code = message.exitCode; }); sessions.push(session);
		await session.start(); await until(() => code !== undefined); expect(code).toBe(0); expect(output).toContain(`RALLY_PS:${Buffer.from(harness.tempDir).toString("base64")}`);
	}, 25000);
	it("pauses high-volume output until acknowledged, then delivers the entire stream", async () => {
		const { session, output, seq } = await setup(false); session.ack(seq()); session.write("flood\r"); await until(() => output().length > 131072);
		await delay(200); const length = output().length; await delay(200); expect(output().length).toBe(length); expect(output()).not.toContain('"floodDone":true');
		for (let i = 0; i < 100 && !output().includes('"floodDone":true'); i++) { session.ack(seq()); await delay(30); }
		expect(output()).toContain('"floodDone":true'); expect(output().split("X").length - 1).toBe(512000);
	}, 25000);
	it("closes the shell and its descendant process tree", async () => {
		const { session, harness, output, messages } = await setup(); session.write("spawn\r"); const file = join(harness.tempDir, "descendant.pid"); await until(() => existsSync(file) && output().includes('"descendant":'));
		const pid = Number(readFileSync(file, "utf8")); expect(await processIdentity(pid)).toBeDefined(); const shell = messages.find(message => message.type === "ready");
		await session.close(); expect(await processIdentity(pid)).toBeUndefined(); expect(await processIdentity(shell!.type === "ready" ? shell!.pid : 0)).toBeUndefined();
	}, 25000);
	it("cleans up startup cancellation and reports an invalid executable", async () => {
		const harness = await createHarness(); harnesses.push(harness);
		const session = new TerminalSession({ cwd: harness.tempDir, size: { cols: 80, rows: 24 }, shell: process.execPath, args: [fixture], env: safeEnv() }, () => {}); sessions.push(session);
		const start = session.start(); const stopped = session.close(); await expect(start).rejects.toThrow("TERMINAL_CLOSED"); await stopped;
		const bad = new TerminalSession({ cwd: harness.tempDir, size: { cols: 80, rows: 24 }, shell: join(harness.tempDir, "missing.exe"), env: safeEnv() }, () => {}); sessions.push(bad);
		await expect(bad.start()).rejects.toThrow(); await bad.close();
	}, 25000);
	it("reaps the terminal tree when its owning application is forcibly terminated", async () => {
		const harness = await createHarness(); harnesses.push(harness);
		const owner = fork(resolve("test/fixtures/rally-terminal-owner.ts"), [harness.tempDir, fixture], { execArgv: [], env: safeEnv(), stdio: ["ignore", "ignore", "ignore", "ipc"] });
		try {
			const pid = await new Promise<number>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Owner did not start terminal")), 12000); owner.once("message", (message: { descendant: number }) => { clearTimeout(timer); resolve(message.descendant); }); owner.once("error", reject); });
			expect(await processIdentity(pid)).toBeDefined(); owner.kill("SIGKILL");
			let gone = false; for (let attempt = 0; attempt < 15; attempt++) { if (!(await processIdentity(pid))) { gone = true; break; } await delay(100); }
			expect(gone).toBe(true);
		} finally { if (owner.exitCode === null && owner.signalCode === null) owner.kill("SIGKILL"); }
	}, 25000);
	it("cancels a host already waiting for native startup without waiting for the startup deadline", async () => {
		const harness = await createHarness(); harnesses.push(harness); let spawning = false;
		const session = new TerminalSession({ cwd: harness.tempDir, size: { cols: 80, rows: 24 }, shell: process.execPath, hostPath: resolve("test/fixtures/rally-terminal-hanging.cjs"), env: safeEnv() }, message => { if (message.type === "data") spawning = true; }); sessions.push(session);
		const start = session.start(); void start.catch(() => {}); await until(() => spawning);
		const began = Date.now(); await session.close(); await expect(start).rejects.toThrow("TERMINAL_CLOSED"); expect(Date.now() - began).toBeLessThan(8000);
	}, 15000);
});
