import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFindToolDefinition, createGrepToolDefinition, type ExtensionToolContext, type SearchExecution } from "@rally/coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { managedSearchExecution } from "../../../../src/main/supervisor/search-process.ts";
import { ProcessRegistry, type OwnedProcess } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { createHarness, type Harness } from "./harness.ts";

function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
describe("Rally managed search processes", () => {
	const harnesses: Harness[] = []; const registries: ProcessRegistry[] = []; const locks: StateDirectoryLock[] = [];
	afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(registries.splice(0).map(registry => registry.dispose())); for (const lock of locks.splice(0)) lock.release(); for (const harness of harnesses.splice(0)) harness.cleanup(); });
	async function setup() {
		vi.stubEnv("PI_OFFLINE", "1"); const harness = await createHarness(); harnesses.push(harness); const cwd = harness.tempDir; const state = join(cwd, "state"); const lock = new StateDirectoryLock(state); locks.push(lock); const stopped: OwnedProcess[] = [];
		const registry = new ProcessRegistry(state, { assertWritable: () => lock.assertHeld(), graceMs: 50, onStopped: entry => { stopped.push(entry); } }); registries.push(registry);
		const execution = managedSearchExecution(registry, () => cwd, "T-search"); const ctx = { cwd } as ExtensionToolContext;
		return { cwd, registry, stopped, execution, ctx };
	}
	it("preserves real rg/fd output, ignores and UTF-8 results while recording both process identities", async () => {
		const { cwd, execution, registry, stopped, ctx } = await setup(); mkdirSync(join(cwd, ".git")); mkdirSync(join(cwd, "src")); writeFileSync(join(cwd, ".gitignore"), "ignored.txt\n"); writeFileSync(join(cwd, "ignored.txt"), "needle"); writeFileSync(join(cwd, "src", "中文.txt"), "before\nneedle 中文\nafter\n");
		const grep = await createGrepToolDefinition(cwd, { execution }).execute("grep", { pattern: "needle", glob: "src/*.txt", context: 1 }, undefined, undefined, ctx);
		expect(grep.content).toEqual([{ type: "text", text: "src/中文.txt-1- before\nsrc/中文.txt:2: needle 中文\nsrc/中文.txt-3- after" }]);
		const find = await createFindToolDefinition(cwd, { execution }).execute("find", { pattern: "**/*.txt" }, undefined, undefined, ctx); expect(find.content).toEqual([{ type: "text", text: "src/中文.txt" }]);
		expect(stopped).toHaveLength(2); expect(stopped.every(entry => entry.kind === "search" && entry.taskId === "T-search")).toBe(true); expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it("returns no-match results and real invalid regex errors after cleanup", async () => {
		const { cwd, execution, stopped, ctx } = await setup(); writeFileSync(join(cwd, "note.txt"), "content"); const grep = createGrepToolDefinition(cwd, { execution });
		expect((await grep.execute("none", { pattern: "absent", path: "note.txt" }, undefined, undefined, ctx)).content).toEqual([{ type: "text", text: "No matches found" }]);
		await expect(grep.execute("invalid", { pattern: "[", path: "note.txt" }, undefined, undefined, ctx)).rejects.toThrow(); expect(stopped).toHaveLength(2);
	}, 15000);
	it.each(["grep", "find"] as const)("waits for the %s tree to be stopped when aborted", async tool => {
		const { cwd, execution, registry, ctx } = await setup(); const marker = join(cwd, "pids.json"); const fixture = fileURLToPath(new URL("../fixtures/rally-search-process.cjs", import.meta.url));
		const custom: SearchExecution = { resolveTool: async () => process.execPath, spawn: () => execution.spawn(process.execPath, [fixture, marker, "hang"]) };
		const definition = tool === "grep" ? createGrepToolDefinition(cwd, { execution: custom }) : createFindToolDefinition(cwd, { execution: custom }); const controller = new AbortController();
		const pending = definition.execute(tool, { pattern: "unused" }, controller.signal, undefined, ctx); const rejected = expect(pending).rejects.toThrow("Operation aborted");
		await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 5000 }); const pids = JSON.parse(readFileSync(marker, "utf8")); controller.abort(); await rejected;
		expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false); expect(JSON.parse(readFileSync(registry.file, "utf8")).processes).toEqual([]);
	}, 15000);
	it("stops the whole tree at grep's result limit and still returns the bounded results", async () => {
		const { cwd, execution, ctx } = await setup(); const marker = join(cwd, "pids.json"); const custom: SearchExecution = { resolveTool: async () => process.execPath, spawn: () => execution.spawn(process.execPath, [fileURLToPath(new URL("../fixtures/rally-search-process.cjs", import.meta.url)), marker, "limit"]) };
		const result = await createGrepToolDefinition(cwd, { execution: custom }).execute("limit", { pattern: "match", limit: 1 }, undefined, undefined, ctx); const pids = JSON.parse(readFileSync(marker, "utf8"));
		expect(result.details?.matchLimitReached).toBe(1); expect(result.content[0]).toMatchObject({ text: expect.stringContaining("note.txt:1: match 中文") }); expect(alive(pids.root)).toBe(false); expect(alive(pids.leaf)).toBe(false);
	}, 15000);
	it.each(["grep", "find"] as const)("does not spawn %s if cancellation arrives during executable resolution", async tool => {
		const { cwd, ctx } = await setup(); const controller = new AbortController(); const spawn = vi.fn();
		const execution: SearchExecution = { resolveTool: async () => { controller.abort(); return process.execPath; }, spawn };
		const definition = tool === "grep" ? createGrepToolDefinition(cwd, { execution }) : createFindToolDefinition(cwd, { execution });
		await expect(definition.execute(tool, { pattern: "x" }, controller.signal, undefined, ctx)).rejects.toThrow("Operation aborted"); expect(spawn).not.toHaveBeenCalled();
	});
	it("runs missing-tool probes in the registered helper and respects offline mode", async () => {
		const { cwd, execution, stopped } = await setup(); vi.stubEnv("RALLY_CODING_AGENT_DIR", join(cwd, "isolated-agent")); vi.stubEnv("PATH", join(cwd, "empty-path"));
		expect(await execution.resolveTool!("fd")).toBeUndefined(); expect(stopped).toHaveLength(1); expect(stopped[0].kind).toBe("search");
	}, 15000);
});
