import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager, type ExtensionToolContext } from "../../src/index.ts";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import { GateService } from "../../../../src/main/supervisor/gates.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { createFileDeleteTool } from "../../../../src/main/supervisor/file-delete.ts";
import { createVersionedFileTools, FileVersions } from "../../../../src/main/supervisor/file-versions.ts";
import { readTask } from "../../../../src/main/supervisor/task-read.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally controlled deletion (offline temporary files)", () => {
	const harnesses: Harness[] = [];
	const services: GateService[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		for (const service of services.splice(0)) service.dispose();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup(mode: "readonly" | "write" = "write") {
		const harness = await createHarness(); harnesses.push(harness);
		const paths = resolveRallyPaths(harness.tempDir); ensureRallyDirs(paths);
		const cwd = join(harness.tempDir, "project"); mkdirSync(cwd);
		const events = new EventLog(paths.eventsFile);
		const store = new TaskStore(events, paths.workspaceDir, () => {});
		const audit = new AuditLog(paths.auditFile, events);
		const gates = new GateService({ store, audit, events, requested: () => {}, notice: () => {}, quote: (ref) => ref.id === "#allowed" ? { messageId: ref.id } : null }); services.push(gates);
		const task = store.create({ title: "delete fixture", cwd, mode, scope: [], dependsOn: [], quotes: [], autoApprove: true }).task;
		const run = store.startRun(task.id, "dispatch", "faux");
		mkdirSync(task.outputDir, { recursive: true });
		const sessionFile = join(harness.tempDir, "worker.jsonl");
		const session = SessionManager.open(sessionFile, harness.tempDir, cwd);
		session.appendMessage({ role: "user", content: "delete fixture", timestamp: Date.now() });
		const versions = new FileVersions(session);
		const host = { task, run, store, gates, versions, isActive: () => !task.ended && !run.endedAt };
		const tool = createFileDeleteTool(host);
		const ctx = { cwd } as ExtensionToolContext;
		let sequence = 0;
		const call = (input: Parameters<typeof tool.execute>[1], signal?: AbortSignal) => tool.execute(`delete-${++sequence}`, input, signal, undefined, ctx);
		const files = createVersionedFileTools(cwd, versions, () => {});
		const read = (path: string) => files[0].execute("read", { path }, undefined, undefined, ctx);
		const write = async (path: string, content: string) => {
			const created = !existsSync(path);
			await files[1].execute("write", { path, content }, undefined, undefined, ctx);
			store.recordAccess(task.id, { toolCallId: `write-${++sequence}`, runId: run.id, tool: "write", kind: "fs_write", target: path, at: Date.now(), created });
		};
		const decide = async (value: "allow" | "deny" = "allow") => {
			await vi.waitFor(() => expect(task.gates?.some((gate) => !gate.decision)).toBe(true));
			const gate = task.gates!.find((item) => !item.decision)!;
			gates.decide(gate.id, value, "main", value === "allow" ? [{ id: "#allowed" }] : [], "fixture decision");
			return gate;
		};
		return { paths, cwd, events, store, audit, gates, task, run, sessionFile, versions, host, ctx, call, read, write, decide };
	}

	it("defaults to a bounded preview, deduplicates overlaps and does not follow junctions", async () => {
		const { cwd, task, call, store } = await setup();
		const folder = join(cwd, "folder"); mkdirSync(folder);
		for (let i = 0; i < 55; i++) writeFileSync(join(folder, `${i}.txt`), "abc");
		writeFileSync(join(task.outputDir, "outside.txt"), "keep");
		const link = join(folder, "link"); symlinkSync(task.outputDir, link, process.platform === "win32" ? "junction" : "dir");
		const result = await call({ paths: [folder, join(folder, "1.txt"), folder], recursive: true });
		expect(result.details).toMatchObject({ matched: 57, totalBytes: 165, uncommitted: [], outsideCwd: [] });
		expect("preview" in result.details && result.details.preview).toHaveLength(50);
		expect(existsSync(join(folder, "1.txt"))).toBe(true);
		expect(task.gates).toBeUndefined(); expect(store.access(task.id)).toEqual([]);
	});

	it("reports staged and untracked changes using literal paths and lists outside-cwd targets", async () => {
		const { cwd, task, call } = await setup();
		execFileSync("git", ["init", cwd], { stdio: "ignore", windowsHide: true });
		const staged = join(cwd, "名字 with space.txt"); writeFileSync(staged, "staged");
		execFileSync("git", ["-C", cwd, "add", "--", "名字 with space.txt"], { windowsHide: true });
		writeFileSync(join(cwd, "untracked.txt"), "untracked");
		const outside = join(task.outputDir, "outside.txt"); writeFileSync(outside, "out");
		const result = await call({ paths: [staged, outside] });
		expect(result.details).toMatchObject({ matched: 2, totalBytes: 9, uncommitted: [staged], outsideCwd: [outside] });
	});

	it("freezes complete gate scope and records every successful deletion under one call", async () => {
		const { cwd, call, task, store, paths, decide } = await setup();
		const folder = join(cwd, "existing"); mkdirSync(folder);
		const targets = Array.from({ length: 52 }, (_, i) => join(folder, `${i}.txt`));
		for (const path of targets) writeFileSync(path, "x");
		const input = { paths: [folder], recursive: true, dryRun: false };
		const deleting = call(input); input.paths.push(join(cwd, "not-approved"));
		await vi.waitFor(() => expect(task.gates).toHaveLength(1));
		expect(existsSync(targets[0])).toBe(true);
		expect(task.gates![0].scope).toHaveLength(53);
		expect(task.gates![0].arguments.preview).toHaveLength(50);
		expect(task.gates![0].arguments.paths).toEqual([folder]);
		await decide();
		expect((await deleting).details).toEqual({ deleted: 53, failed: [] });
		expect(existsSync(folder)).toBe(false);
		const access = store.access(task.id); expect(access).toHaveLength(53);
		expect(new Set(access.map((entry) => entry.toolCallId)).size).toBe(1);
		expect(access.every((entry) => entry.kind === "fs_delete")).toBe(true);
		expect(readFileSync(paths.auditFile, "utf8")).toContain('"basis":["#allowed"]');
		const restored = new TaskStore(new EventLog(paths.eventsFile), paths.workspaceDir, () => {});
		expect(restored.access(task.id)).toEqual(access);
		expect(restored.get(task.id)?.changedFiles).toHaveLength(53);
		expect(readTask(restored, restored.get(task.id)!, { view: "files", offset: 50 })).toMatchObject({ total: 53, nextOffset: null, coverage: { deletes: "successful file_delete entries only" } });
	});

	it.each(["deny", "abort", "shutdown"] as const)("preserves files when a waiting gate receives %s", async (action) => {
		const { cwd, call, task, gates, decide, store } = await setup();
		const path = join(cwd, "keep.txt"); writeFileSync(path, "keep");
		const controller = new AbortController(); const deleting = call({ paths: [path], dryRun: false }, controller.signal);
		await vi.waitFor(() => expect(task.gates).toHaveLength(1));
		if (action === "deny") await decide("deny");
		else if (action === "abort") controller.abort();
		else gates.dispose();
		const result = await deleting;
		expect(result.isError).toBe(true); expect(result.details).toMatchObject({ deleted: 0 });
		expect(readFileSync(path, "utf8")).toBe("keep"); expect(store.access(task.id)).toEqual([]);
	});

	it("restricts readonly calls and removes only output junctions, including dangling ones", async () => {
		const { cwd, task, call } = await setup("readonly");
		const project = join(cwd, "keep.txt"); const output = join(task.outputDir, "remove.txt");
		writeFileSync(project, "keep"); writeFileSync(output, "remove");
		expect((await call({ paths: [project] })).details).toMatchObject({ matched: 1, totalBytes: 4 });
		const refused = await call({ paths: [output, project], dryRun: false });
		expect(JSON.stringify(refused)).toContain("READONLY_TASK"); expect(existsSync(output)).toBe(true);
		const link = join(task.outputDir, "junction"); symlinkSync(cwd, link, process.platform === "win32" ? "junction" : "dir");
		const gone = join(cwd, "gone"); mkdirSync(gone);
		const dangling = join(task.outputDir, "dangling"); symlinkSync(gone, dangling, process.platform === "win32" ? "junction" : "dir");
		rmSync(gone, { recursive: true });
		expect((await call({ paths: [output, link, dangling], dryRun: false })).details).toEqual({ deleted: 3, failed: [] });
		expect(readFileSync(project, "utf8")).toBe("keep"); expect(task.gates).toBeUndefined();
	});

	it("uses persisted creation identity for the exception and permits recreation after controlled deletion", async () => {
		const { cwd, write, host, ctx, sessionFile, task, store } = await setup();
		const path = join(cwd, "created.txt"); await write(path, "created");
		const versions = new FileVersions(SessionManager.open(sessionFile, cwd, cwd));
		const tool = createFileDeleteTool({ ...host, versions });
		expect((await tool.execute("delete", { paths: [path], dryRun: false }, undefined, undefined, ctx)).details).toEqual({ deleted: 1, failed: [] });
		expect(task.gates).toBeUndefined();
		const recovered = new FileVersions(SessionManager.open(sessionFile, cwd, cwd));
		const tools = createVersionedFileTools(cwd, recovered, () => {});
		await tools[1].execute("recreate", { path, content: "recreated" }, undefined, undefined, ctx);
		expect(readFileSync(path, "utf8")).toBe("recreated");
		expect(store.access(task.id).map((entry) => entry.kind)).toEqual(["fs_write", "fs_delete"]);
	});

	it("does not reuse a creation exception for an externally replaced file after reread", async () => {
		const { cwd, task, write, read, call, decide } = await setup();
		const path = join(cwd, "created.txt"); await write(path, "our file");
		renameSync(path, join(cwd, "old.txt")); writeFileSync(path, "replacement"); await read(path);
		const deleting = call({ paths: [path], dryRun: false }); await decide("deny");
		expect((await deleting).isError).toBe(true); expect(task.gates).toHaveLength(1);
		expect(readFileSync(path, "utf8")).toBe("replacement");
	});

	it("drops the creation exception when outside content is adopted by rereading", async () => {
		const { cwd, write, read, call, decide, task } = await setup();
		const path = join(cwd, "ours.txt"); await write(path, "ours");
		writeFileSync(path, "outside edits to the same file"); await read(path);
		const deleting = call({ paths: [path], dryRun: false }); await decide("deny");
		expect((await deleting).isError).toBe(true); expect(task.gates).toHaveLength(1);
		expect(readFileSync(path, "utf8")).toBe("outside edits to the same file");
	});

	it.each(["file", "directory"] as const)("checks read aliases retargeted before a %s deletion request", async (kind) => {
		const { cwd, read, call, task } = await setup();
		const first = join(cwd, "first"); const second = join(cwd, "second"); const alias = join(cwd, "alias");
		mkdirSync(join(first, "nested"), { recursive: true }); mkdirSync(join(second, "nested"), { recursive: true });
		writeFileSync(join(first, "nested", "file.txt"), "old"); writeFileSync(join(second, "nested", "file.txt"), "new");
		symlinkSync(first, alias, process.platform === "win32" ? "junction" : "dir");
		await read(join(alias, "nested", "file.txt"));
		rmSync(alias, { recursive: true }); symlinkSync(second, alias, process.platform === "win32" ? "junction" : "dir");
		const target = kind === "file" ? join(alias, "nested", "file.txt") : join(alias, "nested");
		const result = await call({ paths: [target], recursive: true, dryRun: false });
		expect(JSON.stringify(result)).toContain("STALE_FILE");
		expect(task.gates).toBeUndefined(); expect(existsSync(join(second, "nested", "file.txt"))).toBe(true);
	});

	it("checks previously read files under recursive roots without treating preview as a reread", async () => {
		const { cwd, call, task, read } = await setup();
		const folder = join(cwd, "folder"); mkdirSync(folder); const path = join(folder, "file.txt");
		const time = new Date("2026-01-01T00:00:00Z");
		writeFileSync(path, "before"); utimesSync(path, time, time); await read(path);
		writeFileSync(path, "after!"); utimesSync(path, time, time);
		await call({ paths: [folder], recursive: true });
		const result = await call({ paths: [folder], recursive: true, dryRun: false });
		expect(JSON.stringify(result)).toContain("STALE_FILE"); expect(task.gates).toBeUndefined();
		expect(readFileSync(path, "utf8")).toBe("after!");
	});

	it.each(["add", "change", "retarget"] as const)("refuses a manifest that changed during approval: %s", async (change) => {
		const { cwd, call, task, decide } = await setup();
		const folder = join(cwd, "folder"); const other = join(cwd, "other"); mkdirSync(folder); mkdirSync(other);
		const target = join(folder, "file.txt"); writeFileSync(target, "before"); writeFileSync(join(other, "file.txt"), "outside");
		const alias = join(cwd, "alias"); symlinkSync(folder, alias, process.platform === "win32" ? "junction" : "dir");
		const deleting = call({ paths: [change === "retarget" ? join(alias, "file.txt") : folder], recursive: true, dryRun: false });
		await vi.waitFor(() => expect(task.gates).toHaveLength(1));
		if (change === "add") writeFileSync(join(folder, "new.txt"), "new");
		else if (change === "change") writeFileSync(target, "after!");
		else { rmSync(alias, { recursive: true }); symlinkSync(other, alias, process.platform === "win32" ? "junction" : "dir"); }
		await decide(); const result = await deleting;
		expect(result.details).toMatchObject({ deleted: 0 }); expect(JSON.stringify(result)).toContain("STALE_FILE");
		expect(existsSync(target)).toBe(true); expect(readFileSync(join(other, "file.txt"), "utf8")).toBe("outside");
	});

	it("never recursively removes a late child and reports the partial deletion", async () => {
		const { task, call, versions, store } = await setup();
		const folder = join(task.outputDir, "folder"); mkdirSync(folder); const first = join(folder, "a.txt"); writeFileSync(first, "a");
		const record = versions.recordDeletion.bind(versions);
		vi.spyOn(versions, "recordDeletion").mockImplementationOnce((path, link) => {
			record(path, link); writeFileSync(join(folder, "late.txt"), "late");
		});
		const result = await call({ paths: [folder], recursive: true, dryRun: false });
		expect(result.isError).toBe(true); expect(result.details).toMatchObject({ deleted: 1, failed: [{ path: folder }] });
		expect(readFileSync(join(folder, "late.txt"), "utf8")).toBe("late");
		expect(store.access(task.id).map((entry) => entry.target)).toEqual([first]);
	});

	it("requires durable approval and stops after a deletion's access record fails", async () => {
		const { cwd, call, task, gates, audit, decide, store } = await setup();
		const first = join(cwd, "a.txt"); const second = join(cwd, "b.txt"); writeFileSync(first, "a"); writeFileSync(second, "b");
		const deleting = call({ paths: [first, second], dryRun: false });
		await vi.waitFor(() => expect(task.gates).toHaveLength(1));
		vi.spyOn(audit, "append").mockImplementationOnce(() => { throw new Error("audit disk failure"); });
		expect(() => gates.decide(task.gates![0].id, "allow", "main", [{ id: "#allowed" }], "fixture")).toThrow("audit disk failure");
		expect(existsSync(first)).toBe(true);
		vi.spyOn(store, "recordAccess").mockImplementationOnce(() => { throw new Error("access disk failure"); });
		await decide(); const result = await deleting;
		expect(result.details).toMatchObject({ deleted: 1, failed: [{ path: first, error: "access disk failure" }, { path: second, error: expect.stringContaining("NOT_ATTEMPTED") }] });
		expect(existsSync(first)).toBe(false); expect(existsSync(second)).toBe(true);
	});

	it("rejects roots, absent targets and implicit recursion before deleting anything", async () => {
		const { cwd, call, task } = await setup();
		const folder = join(cwd, "folder"); mkdirSync(folder); writeFileSync(join(folder, "file.txt"), "keep");
		expect(JSON.stringify(await call({ paths: [folder], dryRun: false }))).toContain("RECURSIVE_REQUIRED");
		expect(JSON.stringify(await call({ paths: [join(cwd, "missing")], dryRun: false }))).toContain("ENOENT");
		await expect(call({ paths: [process.platform === "win32" ? cwd.slice(0, 3) : "/"], recursive: true })).rejects.toThrow("DELETE_ROOT");
		expect(existsSync(join(folder, "file.txt"))).toBe(true); expect(task.gates).toBeUndefined();
	});
});
