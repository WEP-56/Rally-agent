import fs, { readFileSync, readdirSync, statSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally physical session continuation", () => {
	const harnesses: Harness[] = [];
	afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const h of harnesses.splice(0)) h.cleanup(); });
	async function setup() {
		const h = await createHarness(); harnesses.push(h);
		const dir = join(h.tempDir, "segments"); const manager = SessionManager.create(h.tempDir, dir);
		return { h, dir, manager };
	}
	it("retains exact projection, metadata, IDs and edits while discarding summarized bytes", async () => {
		const { manager, h, dir } = await setup();
		manager.appendModelChange("faux", "first"); manager.appendThinkingLevelChange("high");
		manager.appendCustomEntry("settings", { enabled: true });
		manager.appendMessage({ role: "system", content: "SYSTEM_CHECKPOINT", timestamp: 1 });
		manager.appendMessage({ role: "user", content: "OLD_BODY".repeat(1000), timestamp: 2 });
		const kept = manager.appendMessage({ role: "user", content: "recent", timestamp: 3 });
		manager.appendCompaction("summary of old body", kept, 20000);
		manager.appendContextEdit(kept, { content: "edited recent" });
		manager.appendCustomMessageEntry("rally-relay", "pending fact", false, { relayIds: ["R-1"] });
		const old = manager.getSessionFile()!; const bytes = readFileSync(old); const context = manager.buildSessionContext(); const leaf = manager.getLeafId();
		const file = manager.rotateCompactedSession()!;
		expect(file).not.toBe(old); expect(manager.getHeader()?.parentSession).toBe(old); expect(manager.getLeafId()).toBe(leaf);
		expect(readFileSync(old)).toEqual(bytes); expect(statSync(file).size).toBeLessThan(bytes.length);
		expect(readFileSync(file, "utf8")).not.toContain("OLD_BODY"); expect(readFileSync(file, "utf8")).toContain("settings");
		expect(manager.buildSessionContext()).toEqual(context); expect(SessionManager.open(file).buildSessionContext()).toEqual(context);
		expect(SessionManager.continueRecent(h.tempDir, dir).getSessionFile()).toBe(file);
		expect(manager.rotateCompactedSession()).toBeUndefined();
		manager.appendMessage({ role: "user", content: "next", timestamp: 4 }); expect(readFileSync(old)).toEqual(bytes);
	});
	it("rotates empty retained history and subsequent compactions with a valid parent chain", async () => {
		const { manager } = await setup(); manager.appendMessage({ role: "user", content: "old", timestamp: 1 });
		manager.appendCompaction("first summary", null, 100); const first = manager.rotateCompactedSession()!;
		manager.appendMessage({ role: "user", content: "new", timestamp: 2 }); manager.appendCompaction("second summary", null, 100);
		const expected = manager.buildSessionContext(); const second = manager.rotateCompactedSession()!;
		expect(manager.getHeader()?.parentSession).toBe(first); expect(SessionManager.open(second).buildSessionContext()).toEqual(expected);
		expect(readFileSync(second, "utf8")).not.toContain("first summary");
	});
	it("skips uncompacted and in-memory sessions and rejects a missing retained boundary", async () => {
		const { manager } = await setup(); manager.appendMessage({ role: "user", content: "old", timestamp: 1 });
		expect(manager.rotateCompactedSession()).toBeUndefined();
		manager.appendCompaction("summary", "missing", 1);
		expect(() => manager.rotateCompactedSession()).toThrow("SESSION_SEGMENT_INVALID");
		expect(SessionManager.inMemory().rotateCompactedSession()).toBeUndefined();
	});
	it("keeps the old manager and file authoritative on publication failure", async () => {
		const { manager, dir } = await setup(); manager.appendMessage({ role: "user", content: "old", timestamp: 1 }); manager.appendCompaction("summary", null, 1);
		const old = manager.getSessionFile()!; const bytes = readFileSync(old); const before = manager.buildSessionContext();
		vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw new Error("publication failed"); }); syncBuiltinESMExports();
		expect(() => manager.rotateCompactedSession()).toThrow("publication failed");
		expect(manager.getSessionFile()).toBe(old); expect(readFileSync(old)).toEqual(bytes); expect(manager.buildSessionContext()).toEqual(before);
		expect(readdirSync(dir)).toHaveLength(1); expect(manager.rotateCompactedSession()).toBeTruthy();
	});
});
