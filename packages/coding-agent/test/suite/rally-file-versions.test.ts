import { mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager, withFileMutationQueue, type ExtensionToolContext } from "../../src/index.ts";
import { createVersionedFileTools, FileVersions } from "../../../../src/main/supervisor/file-versions.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("Rally read-before-write versions (offline)", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		vi.restoreAllMocks();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});
	async function setup() {
		const harness = await createHarness(); harnesses.push(harness);
		const cwd = harness.tempDir;
		const sessionFile = join(cwd, "worker.jsonl");
		const session = SessionManager.open(sessionFile, cwd, cwd);
		session.appendMessage({ role: "user", content: "offline fixture", timestamp: Date.now() });
		const versions = new FileVersions(session);
		const tools = createVersionedFileTools(cwd, versions, () => {});
		const ctx = { cwd } as ExtensionToolContext;
		const read = (path: string, offset?: number, limit?: number, signal?: AbortSignal) => tools[0].execute("read", { path, offset, limit }, signal, undefined, ctx);
		const write = (path: string, content: string, signal?: AbortSignal) => tools[1].execute("write", { path, content }, signal, undefined, ctx);
		const edit = (path: string, oldText: string, newText: string) => tools[2].execute("edit", { path, edits: [{ oldText, newText }] }, undefined, undefined, ctx);
		const path = join(cwd, "file.md"); writeFileSync(path, "first\nsecond\n");
		return { cwd, sessionFile, session, versions, tools, ctx, path, read, write, edit };
	}

	it("hashes unseen lines and rejects same-size changes even if mtime is restored", async () => {
		const { path, read, write, edit } = await setup();
		const time = new Date("2026-01-01T00:00:00Z"); utimesSync(path, time, time);
		expect(getMessageText(await read(path, 1, 1))).not.toContain("second");
		writeFileSync(path, "first\nchange\n"); utimesSync(path, time, time);
		await expect(write(path, "overwrite")).rejects.toThrow("STALE_FILE");
		await expect(edit(path, "first", "overwrite")).rejects.toThrow("STALE_FILE");
		expect(readFileSync(path, "utf8")).toBe("first\nchange\n");
	});

	it("rejects mtime-only changes and refreshes only after a successful reread", async () => {
		const { path, read, write, edit } = await setup();
		await read(path);
		const newer = new Date(statSync(path).mtimeMs + 5000); utimesSync(path, newer, newer);
		await expect(edit(path, "first", "lost")).rejects.toThrow("STALE_FILE");
		await expect(read(path, 1000)).rejects.toThrow("beyond end");
		await expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
		await read(path);
		await edit(path, "first", "kept");
		await write(path, "next");
		await edit(path, "next", "last");
		expect(readFileSync(path, "utf8")).toBe("last");
	});

	it("permits new and never-read files while protecting subsequent own writes", async () => {
		const { cwd, path, write, edit } = await setup();
		await write(path, "unread existing file");
		const fresh = join(cwd, "nested", "new.md");
		await write(fresh, "created");
		await edit(fresh, "created", "updated");
		writeFileSync(fresh, "outside");
		await expect(write(fresh, "lost")).rejects.toThrow("STALE_FILE");
	});

	it("does not recreate a read file deleted externally or accept a replacement with identical bytes", async () => {
		const { cwd, path, read, write, edit } = await setup();
		await read(path);
		renameSync(path, join(cwd, "old.md"));
		await expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
		await expect(edit(path, "first", "lost")).rejects.toThrow("STALE_FILE");
		writeFileSync(path, "first\nsecond\n");
		const old = statSync(join(cwd, "old.md")); utimesSync(path, old.atime, old.mtime);
		await expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
	});

	it("persists versions and alias history across reopening the same task session", async () => {
		const { cwd, path, sessionFile, read, ctx } = await setup();
		await read(path);
		const persisted = readFileSync(sessionFile, "utf8");
		expect(persisted).toContain("rally-file-version-v1");
		expect(persisted).not.toContain("first\\nsecond");
		writeFileSync(path, "external after restart");
		const versions = new FileVersions(SessionManager.open(sessionFile, cwd, cwd));
		const tools = createVersionedFileTools(cwd, versions, () => {});
		await expect(tools[1].execute("write", { path, content: "lost" }, undefined, undefined, ctx)).rejects.toThrow("STALE_FILE");
		await tools[0].execute("read", { path }, undefined, undefined, ctx);
		await tools[1].execute("write", { path, content: "adapted" }, undefined, undefined, ctx);
		expect(readFileSync(path, "utf8")).toBe("adapted");
	});

	it("recognizes directory aliases, case variants and retargeted junctions", async () => {
		const { cwd, read, write } = await setup();
		const actual = join(cwd, "actual"); const other = join(cwd, "other"); const alias = join(cwd, "alias");
		mkdirSync(actual); mkdirSync(other);
		symlinkSync(actual, alias, process.platform === "win32" ? "junction" : "dir");
		const realFile = join(actual, "item.md"); const aliasFile = join(alias, "item.md");
		writeFileSync(realFile, "before"); writeFileSync(join(other, "item.md"), "other");
		await read(aliasFile);
		writeFileSync(realFile, "outside");
		await expect(write(process.platform === "win32" ? realFile.toUpperCase() : realFile, "lost")).rejects.toThrow("STALE_FILE");
		await read(realFile); await write(aliasFile, "adapted");
		expect(readFileSync(realFile, "utf8")).toBe("adapted");
		rmSync(alias, { recursive: true });
		symlinkSync(other, alias, process.platform === "win32" ? "junction" : "dir");
		await expect(write(aliasFile, "lost")).rejects.toThrow("STALE_FILE");
		expect(readFileSync(join(other, "item.md"), "utf8")).toBe("other");
	});

	it("checks after the existing Pi mutation queue and respects cancellation while queued", async () => {
		const { path, read, write } = await setup();
		await read(path);
		let release!: () => void; let entered = false;
		const blocker = withFileMutationQueue(path, async () => { entered = true; await new Promise<void>((resolve) => { release = resolve; }); });
		await vi.waitFor(() => expect(entered).toBe(true));
		const writing = expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
		const controller = new AbortController();
		const cancelled = expect(write(path, "cancelled", controller.signal)).rejects.toThrow(/abort/i);
		writeFileSync(path, "outside while queued"); controller.abort(); release();
		await Promise.all([blocker, writing, cancelled]);
		expect(readFileSync(path, "utf8")).toBe("outside while queued");
	});

	it("never adopts a file modified during streaming or an aborted read", async () => {
		const { path, versions, read, write } = await setup();
		writeFileSync(path, "a\n".repeat(100000)); await read(path, 1, 1);
		let captured = false;
		const operations = versions.readOperations(() => { captured = true; });
		const stream = operations.createReadStream!(path, {})[Symbol.asyncIterator]();
		await stream.next();
		writeFileSync(path, "changed while streaming");
		await expect((async () => { while (!(await stream.next()).done) { /* consume */ } })()).rejects.toThrow("STALE_FILE");
		expect(captured).toBe(false);
		const controller = new AbortController(); controller.abort();
		await expect(read(path, 1, 1, controller.signal)).rejects.toThrow(/abort/i);
		await expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
	});

	it("retains image decoding and protects the image's original bytes", async () => {
		const { cwd, read, write } = await setup();
		const path = join(cwd, "pixel.png");
		writeFileSync(path, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==", "base64"));
		const result = await read(path);
		expect(result.content.some((block) => block.type === "image")).toBe(true);
		unlinkSync(path);
		await expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
	});

	it("rejects another task's write and changes between edit's internal read and write", async () => {
		const { cwd, path, versions, ctx, read, write, edit } = await setup();
		await read(path);
		const other = createVersionedFileTools(cwd, new FileVersions(SessionManager.inMemory()), () => {});
		await other[1].execute("other", { path, content: "another task" }, undefined, undefined, ctx);
		await expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
		await read(path);
		const check = versions.assertFresh.bind(versions);
		vi.spyOn(versions, "assertFresh").mockImplementation(async (target, signal, source) => {
			if (source) writeFileSync(target, "outside during edit");
			await check(target, signal, source);
		});
		await expect(edit(path, "another task", "lost")).rejects.toThrow("STALE_FILE");
		expect(readFileSync(path, "utf8")).toBe("outside during edit");
	});

	it("does not adopt outside bytes written just after its own successful write", async () => {
		const { path, versions, write } = await setup();
		const record = versions.recordWrite.bind(versions);
		vi.spyOn(versions, "recordWrite").mockImplementationOnce(async (target, content) => {
			writeFileSync(target, "outside just after write");
			await record(target, content);
		});
		await write(path, "our bytes");
		await expect(write(path, "lost")).rejects.toThrow("STALE_FILE");
		expect(readFileSync(path, "utf8")).toBe("outside just after write");
	});
});
