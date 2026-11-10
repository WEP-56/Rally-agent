import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    const file = join(h.tempDir, "MEMORY.md");
    const events = new EventLog(join(h.tempDir, "events.jsonl"));
    const audit = new AuditLog(join(h.tempDir, "audit.jsonl"), events);
    const reload = () => new MemoryStore(h.tempDir, file, events, audit);
    return { file, events, audit, memory: reload(), reload, dir: h.tempDir };
  }
  it("appends once across restart, keeps prose, removes observed entries, records no memory body", async () => {
    const { file, memory, events, reload, dir } = await setup();
    writeFileSync(file, "# My notes\n\nhandwritten\n");
    expect(memory.append("SECRET_PREFERENCE", ["#1"], "a").entryId).toBe("M-1");
    expect(reload().append("SECRET_PREFERENCE", ["#1"], "b").reused).toBe(true);
    memory.context(); memory.remove("M-1", ["#2"], "c");
    expect(readFileSync(file, "utf8")).toContain("handwritten");
    expect(readFileSync(file, "utf8")).not.toContain("SECRET_PREFERENCE");
    expect(JSON.stringify(events.all())).not.toContain("SECRET_PREFERENCE");
    expect(readFileSync(join(dir, "audit.jsonl"), "utf8")).not.toContain("SECRET_PREFERENCE");
    expect(events.ofKind("memory_changed").map(e => e.data)).toEqual([{ entryId: "M-1", op: "append" }, { entryId: "M-1", op: "remove" }]);
  });
  it("supports start-only markers and preserves unrelated paragraphs", async () => {
    const { file, memory } = await setup();
    writeFileSync(file, "intro\n\n<!-- id: M-12 -->\nlegacy\n\nmy other notes\n");
    expect(memory.state().entries).toBe(1); memory.context(); memory.remove("M-12", ["#2"], "c");
    expect(readFileSync(file, "utf8")).toBe("intro\n\n\nmy other notes\n");
  });
  it("rejects stale or unread deletion and preserves external changes during audit", async () => {
    const { file, memory, audit } = await setup();
    memory.append("initial", ["#1"], "a");
    expect(() => memory.remove("M-1", ["#2"], "b")).toThrow("MEMORY_STALE");
    memory.context(); writeFileSync(file, readFileSync(file, "utf8").replace("initial", "user edit"));
    expect(() => memory.remove("M-1", ["#2"], "b")).toThrow("MEMORY_STALE");
    memory.context(); vi.spyOn(audit, "append").mockImplementationOnce(() => writeFileSync(file, "external"));
    expect(() => memory.remove("M-1", ["#2"], "b")).toThrow("MEMORY_STALE");
    expect(readFileSync(file, "utf8")).toBe("external");
  });
  it("fails closed on audit errors, cancellation and invalid input", async () => {
    const { file, memory, audit } = await setup();
    expect(() => memory.append("x", [], "a")).toThrow("QUOTE_REQUIRED");
    expect(() => memory.append("x".repeat(301), ["#1"], "a")).toThrow("MEMORY_TEXT_INVALID");
    expect(() => memory.append("<!-- id: M-2 -->", ["#1"], "a")).toThrow("MEMORY_TEXT_INVALID");
    expect(() => memory.append("x", ["#1"], "a", AbortSignal.abort())).toThrow();
    vi.spyOn(audit, "append").mockImplementation(() => { throw new Error("disk failure"); });
    expect(() => memory.append("x", ["#1"], "a")).toThrow("disk failure"); expect(existsSync(file)).toBe(false);
  });
  it("persists path without migration, dynamically rereads and bounds UTF-8 context", async () => {
    const { file, memory, reload, dir } = await setup();
    const other = join(dir, "other.md"); memory.updatePath(other);
    expect(reload().filePath()).toBe(other); expect(existsSync(other)).toBe(false);
    memory.prepareOpen(); writeFileSync(other, "好".repeat(2100));
    expect(memory.state().overBudget).toBe(true); expect(memory.context()).toContain('"truncated":true');
    expect(memory.context()).toContain("shorten"); expect(existsSync(file)).toBe(false);
    writeFileSync(other, "new preference"); expect(memory.context()).toContain("new preference");
    expect(memory.context()).not.toContain("好");
  });
  it("surfaces corrupt configuration, UTF-8 and duplicate markers; permits opening for repair", async () => {
    const { file, memory, reload, dir } = await setup();
    writeFileSync(file, Buffer.from([0xff])); expect(memory.state().error).toBeTruthy(); expect(memory.prepareOpen()).toBe(file);
    writeFileSync(file, "<!-- id: M-1 -->\na\n<!-- id: M-1 -->\nb\n"); expect(memory.state().error).toContain("MEMORY_FORMAT_INVALID");
    writeFileSync(join(dir, "memory.json"), "broken"); const broken = reload(); expect(broken.state().error).toBeTruthy();
    broken.updatePath(join(dir, "fixed.md")); expect(broken.state().error).toBeUndefined();
  });
  it("validates real user references, rejects proposals and ended sessions", async () => {
    const { memory, file } = await setup(); let active = true;
    const tools = createMemoryTools(memory, ref => ref.id === "#1" ? { messageId: "#1", text: "记住 x", kind: "user", at: 1 } : null, () => active);
    const call = (quotes: unknown) => tools[0].execute("call", { text: "x", quotes }, undefined, undefined, {} as ExtensionToolContext);
    await expect(call([{ id: "#missing" }])).rejects.toThrow("QUOTE_INVALID");
    await expect(call([{ id: "#1", withProposal: true }])).rejects.toThrow("QUOTE_INVALID");
    expect(existsSync(file)).toBe(false); await call([{ id: "#1" }]); active = false;
    await expect(call([{ id: "#1" }])).rejects.toThrow("SESSION_ENDED");
  });
});
