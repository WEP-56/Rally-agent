import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient, type McpTransport, StreamableHttpTransport } from "@rally/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedStdioTransport, managedMcpTransport } from "../../../../src/main/supervisor/mcp-transport.ts";
import { ProcessRegistry, type OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { resolveRallyPaths } from "../../../../src/main/paths.ts";
import { createHarness, type Harness } from "./harness.ts";

const fixture = fileURLToPath(new URL("../fixtures/rally-mcp-process.cjs", import.meta.url));
const safeEnv = (): NodeJS.ProcessEnv => ({ ...Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), ELECTRON_RUN_AS_NODE: "1", PI_OFFLINE: "1" });
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
describe("Rally managed MCP stdio and command configuration", () => {
	const harnesses: Harness[] = []; const registries: ProcessRegistry[] = []; const locks: StateDirectoryLock[] = []; const transports: McpTransport[] = []; const children: ChildProcess[] = []; const supervisors: Supervisor[] = [];
	afterEach(async () => {
		vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(transports.splice(0).map(transport => transport.close())); await Promise.all(supervisors.splice(0).map(supervisor => supervisor.dispose())); await Promise.all(registries.splice(0).map(registry => registry.dispose()));
		for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGKILL"); await closed; }
		for (const lock of locks.splice(0)) lock.release(); for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness); const cwd = harness.tempDir; const state = join(cwd, "state"); const lock = new StateDirectoryLock(state); locks.push(lock); const stopped: OwnedProcess[] = [];
		const registry = new ProcessRegistry(state, { assertWritable: () => lock.assertHeld(), graceMs: 50, onStopped: entry => { stopped.push(entry); } }); registries.push(registry);
		const marker = join(cwd, "started.json"); const command = { executable: process.execPath, args: [fixture, marker, registry.file, "normal"], cwd, env: safeEnv() };
		const transport = (mode = "normal") => { const result = new ManagedStdioTransport(registry, "T-mcp", { ...command, args: [fixture, marker, registry.file, mode] }); transports.push(result); return result; };
		return { cwd, state, registry, marker, stopped, command, transport };
	}
	it("uses Windows command shims without changing argument boundaries and exchanges large UTF-8 frames", async () => {
		const { cwd, registry, marker, command, stopped } = await setup(); const shim = join(cwd, "mcp launch.cmd"); writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
		const argument = "space & 中文 | literal"; const transport = new ManagedStdioTransport(registry, "T-mcp", { ...command, executable: shim, args: [marker, registry.file, "normal", argument], windowsShim: true, env: { ...safeEnv(), RALLY_MCP_VALUE: "secret-fixture" } }); transports.push(transport);
		const client = new McpClient({ name: "test", version: "1" }); await client.connect(transport); const message = "中文✓🙂".repeat(100000);
		expect(await client.callTool("echo", { text: message })).toMatchObject({ content: [{ text: message }] });
		const meta = JSON.parse(readFileSync(marker, "utf8")); expect(meta).toMatchObject({ cwd, args: [argument], value: "secret-fixture", entries: [{ kind: "mcp", taskId: "T-mcp" }] });
		expect(readFileSync(registry.file, "utf8")).not.toContain("secret-fixture"); await client.close(); await transport.close(); expect(alive(meta.root)).toBe(false); expect(stopped).toHaveLength(1);
	}, 20000);
	it("waits for a server that ignores stdin close and kills its real child tree once", async () => {
		const { transport, marker, registry, stopped } = await setup(); const wire = transport("tree"); const client = new McpClient({ name: "test", version: "1" }); await client.connect(wire);
		const meta = JSON.parse(readFileSync(marker, "utf8")); expect(alive(meta.leaf)).toBe(true); const closing = wire.close(); expect(wire.close()).toBe(closing); await closing;
		expect(alive(meta.root)).toBe(false); expect(alive(meta.leaf)).toBe(false); expect(stopped).toHaveLength(1); expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it("cancels transport opening after registration before sending the server command", async () => {
		const { registry, transport, marker } = await setup(); const wire = transport(); const run = registry.run.bind(registry);
		vi.spyOn(registry, "run").mockImplementation((command, owner, options) => run(command, owner, { ...options, onStarted: () => { void wire.close(); } }));
		await expect(wire.start()).rejects.toThrow(); await wire.close(); expect(existsSync(marker)).toBe(false); expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it("cleans missing executables and does not start a server when registration fails", async () => {
		const { registry, cwd, marker, command } = await setup(); const missing = new ManagedStdioTransport(registry, "T-mcp", { ...command, executable: join(cwd, "missing.exe") }); transports.push(missing);
		await expect(missing.start()).rejects.toThrow("PROCESS_EXEC_FAILED"); await missing.close();
		const broken = new ProcessRegistry(join(cwd, "broken"), { assertWritable: () => {}, graceMs: 0 }); registries.push(broken); mkdirSync(broken.file, { recursive: true });
		const wire = new ManagedStdioTransport(broken, "T-mcp", command); transports.push(wire); await expect(wire.start()).rejects.toThrow(); expect(existsSync(marker)).toBe(false);
	}, 15000);
	it("resolves environment and HTTP header commands through the registry without storing their output", async () => {
		const { registry, cwd, command, marker, stopped } = await setup(); vi.stubEnv("RALLY_MCP_LITERAL", "literal ✓"); const factory = managedMcpTransport(registry, "T-mcp");
		const wire = await factory({ name: "fixture", source: "test", config: { command: command.executable, args: command.args, env: { RALLY_MCP_VALUE: "!printf 'private-value'", RALLY_MCP_LITERAL: "$RALLY_MCP_LITERAL" } } }, cwd, undefined); transports.push(wire);
		const client = new McpClient({ name: "test", version: "1" }); await client.connect(wire); expect(JSON.parse(readFileSync(marker, "utf8")).value).toBe("private-value"); expect(stopped).toHaveLength(1); expect(stopped[0].kind).toBe("mcp"); await wire.close();
		const http = await factory({ name: "http", source: "test", config: { url: "http://127.0.0.1:1/mcp", headers: { Authorization: "!printf 'Bearer private-header'" } } }, cwd, undefined); transports.push(http);
		expect(http).toBeInstanceOf(StreamableHttpTransport); expect((http as StreamableHttpTransport).options.headers).toEqual({ Authorization: "Bearer private-header" }); expect(stopped).toHaveLength(3); expect(readFileSync(registry.file, "utf8")).not.toContain("private");
	}, 20000);
	it("aborts a command-backed setting while creating a transport, before any server starts", async () => {
		const { registry, cwd, marker, command } = await setup(); const controller = new AbortController(); let registered = false; const run = registry.run.bind(registry);
		vi.spyOn(registry, "run").mockImplementation((invocation, owner, options) => run(invocation, owner, { ...options, onStarted: () => { registered = true; controller.abort(); } }));
		await expect(managedMcpTransport(registry, "T-mcp")({ name: "fixture", source: "test", config: { command: command.executable, args: command.args, env: { VALUE: "!printf 'cancelled'" } } }, cwd, undefined, controller.signal)).rejects.toThrow();
		expect(registered).toBe(true); expect(existsSync(marker)).toBe(false); expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it.skipIf(process.platform !== "win32")("resolves command settings with cmd when Bash is unavailable", async () => {
		const { registry, cwd, command, marker } = await setup();
		vi.stubEnv("PATH", cwd); vi.stubEnv("ProgramFiles", cwd); vi.stubEnv("ProgramFiles(x86)", cwd);
		const wire = await managedMcpTransport(registry, "T-mcp")({ name: "fixture", source: "test", config: {
			command: command.executable, args: command.args, env: { RALLY_MCP_VALUE: "!echo fallback value" },
		} }, cwd, undefined); transports.push(wire);
		const client = new McpClient({ name: "test", version: "1" }); await client.connect(wire);
		expect(JSON.parse(readFileSync(marker, "utf8")).value).toBe("fallback value"); await wire.close();
		expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it("recovers a crashed owner's live MCP tree before Supervisor starts the main session", async () => {
		const harness = await createHarness(); harnesses.push(harness); const cwd = harness.tempDir;
		const owner = spawn(process.execPath, [fileURLToPath(new URL("../fixtures/rally-mcp-owner.ts", import.meta.url)), cwd], { windowsHide: true, env: safeEnv(), stdio: ["ignore", "pipe", "pipe", "ipc"] }); children.push(owner);
		expect((await once(owner, "message"))[0]).toMatchObject({ type: "ready" }); const meta = JSON.parse(readFileSync(join(cwd, "mcp.json"), "utf8"));
		const exited = once(owner, "exit"); owner.kill("SIGKILL"); await exited; expect(alive(meta.root)).toBe(true); expect(alive(meta.leaf)).toBe(true);
		const supervisor = new Supervisor(resolveRallyPaths(cwd), { emitChat: () => {}, emitTask: () => {} }); supervisors.push(supervisor);
		const start = supervisor.main.start.bind(supervisor.main); vi.spyOn(supervisor.main, "start").mockImplementationOnce(async () => { expect(alive(meta.root)).toBe(false); expect(alive(meta.leaf)).toBe(false); await start(); }); await supervisor.start();
		expect(supervisor.events.ofKind("process_stopped")).toMatchObject([{ data: { kind: "mcp", reason: "recovery", taskId: "T-mcp" } }]);
	}, 20000);
});
