import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../../../../src/main/memory-store.ts";
import { createMemoryTools } from "../../../../src/main/supervisor/memory-tools.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";
import type { ExtensionToolContext } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally memory offline", () => {
  const harnesses: Harness[] = [];
  afterEach(() => { vi.restoreAllMocks(); for (const h of harnesses.splice(0)) h.cleanup(); });
  async function setup() {
    const h = await createHarness(); harnesses.push(h);
    const dir = join(h.tempDir, "memory"); mkdirSync(dir);
    const events = new EventLog(join(h.tempDir, "events.jsonl"));
    const audit = new AuditLog(join(h.tempDir, "audit.jsonl"), events);
    const file = (name: string) => join(dir, name);
    return { dir, file, events, audit, memory: new MemoryStore(dir, events, audit), home: h.tempDir };
  }
  it("adds one line per entry, keeps hand-written text and records no memory body", async () => {
    const { file, memory, events, home } = await setup();
    writeFileSync(file("USER.md"), "# 画像\n\nhandwritten");
    memory.add("USER", "SECRET_FACT (fact, #1, 2026-11-23)", "a");
    memory.add("USER", "- already a bullet", "b");
    expect(readFileSync(file("USER.md"), "utf8")).toBe("# 画像\n\nhandwritten\n- SECRET_FACT (fact, #1, 2026-11-23)\n- already a bullet\n");
    expect(existsSync(file("RECENT.md"))).toBe(false);
    expect(JSON.stringify(events.all())).not.toContain("SECRET_FACT");
    expect(readFileSync(join(home, "audit.jsonl"), "utf8")).not.toContain("SECRET_FACT");
    expect(events.ofKind("memory_changed").map(e => e.data)).toEqual([{ file: "USER", op: "add", actor: "main" }, { file: "USER", op: "add", actor: "main" }]);
    for (const text of ["", " ", "a\nb", "x".repeat(501)]) expect(() => memory.add("USER", text, "c")).toThrow("MEMORY_TEXT_INVALID");
    expect(() => memory.add("OTHER" as "USER", "x", "c")).toThrow("MEMORY_FILE_INVALID");
  });
  it("edits and deletes only a unique match", async () => {
    const { file, memory } = await setup();
    writeFileSync(file("RECENT.md"), "- 等快递 (fact, #1, 2026-11-20; drop: 收到)\n- 用 npm\n- 用 npm\n");
    memory.edit("RECENT", "等快递", "等显示器快递", "a");
    expect(readFileSync(file("RECENT.md"), "utf8")).toContain("- 等显示器快递 (fact");
    expect(() => memory.edit("RECENT", "用 npm", "用 pnpm", "b")).toThrow("MEMORY_NO_UNIQUE_MATCH");
    expect(() => memory.edit("RECENT", "不存在", "", "b")).toThrow("MEMORY_NO_UNIQUE_MATCH");
    memory.edit("RECENT", "- 等显示器快递 (fact, #1, 2026-11-20; drop: 收到)", "", "c");
    expect(readFileSync(file("RECENT.md"), "utf8")).toBe("- 用 npm\n- 用 npm\n");
  });
  it("rejects writes over budget and allows them again after shortening", async () => {
    const { file, memory } = await setup();
    const full = `- ${"好".repeat(990)}\n`; // 2973 bytes of a 3000-byte budget
    writeFileSync(file("USER.md"), full);
    expect(() => memory.add("USER", "再记一条比较长的内容", "a")).toThrow("MEMORY_OVER_BUDGET");
    expect(readFileSync(file("USER.md"), "utf8")).toBe(full);
    memory.edit("USER", "好".repeat(990), "短", "b");
    memory.add("USER", "再记一条比较长的内容", "c");
    expect(memory.state().files.find(f => f.key === "USER")).toMatchObject({ exists: true, budget: 3000, bytes: Buffer.byteLength("- 短\n- 再记一条比较长的内容\n") });
  });
  it("preserves external changes and fails closed on audit errors and cancellation", async () => {
    const { file, memory, audit } = await setup();
    writeFileSync(file("PREFERENCES.md"), "- initial\n");
    vi.spyOn(audit, "append").mockImplementationOnce(() => writeFileSync(file("PREFERENCES.md"), "external"));
    expect(() => memory.edit("PREFERENCES", "initial", "changed", "a")).toThrow("MEMORY_STALE");
    expect(readFileSync(file("PREFERENCES.md"), "utf8")).toBe("external");
    expect(() => memory.add("PREFERENCES", "x", "a", AbortSignal.abort())).toThrow();
    vi.spyOn(audit, "append").mockImplementation(() => { throw new Error("disk failure"); });
    expect(() => memory.add("RECENT", "x", "a")).toThrow("disk failure"); expect(existsSync(file("RECENT.md"))).toBe(false);
  });
  it("injects the three files fresh on every read and ignores a legacy MEMORY.md", async () => {
    const { file, memory, dir } = await setup();
    writeFileSync(file("MEMORY.md"), "LEGACY_SENTINEL"); writeFileSync(file("USER.md"), "- first\n");
    expect(memory.context()).toContain("first"); expect(memory.context()).not.toContain("LEGACY_SENTINEL");
    writeFileSync(file("USER.md"), "- second\n"); writeFileSync(file("RECENT.md"), "- soon\n");
    const context = JSON.parse(memory.context().split("\n")[1]);
    expect(context).toMatchObject({ dir, archiveDir: join(dir, "archive"), files: { USER: { content: "- second\n", budget: 3000 }, PREFERENCES: { content: "", bytes: 0 }, RECENT: { content: "- soon\n" } } });
    expect(readFileSync(file("MEMORY.md"), "utf8")).toBe("LEGACY_SENTINEL");
    writeFileSync(file("USER.md"), Buffer.from([0xff]));
    expect(memory.state().error).toBeTruthy(); expect(memory.context()).toContain("unavailable");
    expect(memory.prepareOpen("USER")).toBe(file("USER.md")); expect(memory.prepareOpen()).toBe(dir);
  });
  it("backs up before a rewrite, restores, verifies budgets and keeps seven backups", async () => {
    const { file, memory, dir } = await setup();
    writeFileSync(file("USER.md"), "- before\n");
    const backup = memory.backup(1_000);
    writeFileSync(file("USER.md"), "好".repeat(2000)); writeFileSync(file("RECENT.md"), "- new\n");
    expect(() => memory.verify()).toThrow("MEMORY_OVER_BUDGET");
    memory.restore(backup);
    expect(readFileSync(file("USER.md"), "utf8")).toBe("- before\n"); expect(existsSync(file("RECENT.md"))).toBe(false);
    expect(Object.keys(memory.verify())).toEqual(["USER", "PREFERENCES", "RECENT"]);
    for (let day = 2; day <= 10; day++) memory.backup(day * 86_400_000);
    expect(readdirSync(join(dir, ".history"))).toHaveLength(7);
    expect(existsSync(backup)).toBe(false);
  });
  it("exposes add and edit tools without quotes and refuses ended sessions", async () => {
    const { memory, file } = await setup(); let active = true;
    const tools = createMemoryTools(memory, () => active);
    expect(tools.map(tool => tool.name)).toEqual(["memory_add", "memory_edit"]);
    await tools[0].execute("call", { file: "PREFERENCES", text: "先给结论" }, undefined, undefined, {} as ExtensionToolContext);
    await tools[1].execute("call", { file: "PREFERENCES", old: "先给结论", new: "结论先行" }, undefined, undefined, {} as ExtensionToolContext);
    expect(readFileSync(file("PREFERENCES.md"), "utf8")).toBe("- 结论先行\n");
    active = false;
    await expect(tools[0].execute("call", { file: "PREFERENCES", text: "x" }, undefined, undefined, {} as ExtensionToolContext)).rejects.toThrow("SESSION_ENDED");
  });
});
