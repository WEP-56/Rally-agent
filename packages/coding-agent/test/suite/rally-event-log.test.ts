import { appendFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { createHarness, type Harness } from "./harness.ts";

describe("Rally segmented event log", () => {
	const harnesses: Harness[] = [];
	afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const h of harnesses.splice(0)) h.cleanup(); });
	async function setup(name = "events-0001.jsonl", maxBytes = 200) {
		const h = await createHarness(); harnesses.push(h);
		const file = join(h.tempDir, name); return { file, dir: h.tempDir, log: new EventLog(file, maxBytes) };
	}
	it("rotates by UTF-8 bytes, preserves old segments, and replays globally ordered facts", async () => {
		const { file, dir, log } = await setup();
		const first = log.append("chat_message", { n: 1, role: "user", text: "中文😀".repeat(9), at: 1 });
		const bytes = readFileSync(file);
		const second = log.append("chat_message", { n: 2, role: "assistant", text: "reply", at: 2 });
		expect(log.activeFile()).toBe(join(dir, "events-0002.jsonl")); expect(readFileSync(file)).toEqual(bytes);
		const restored = new EventLog(file, 200);
		expect(restored.all()).toEqual([first, second]); expect(restored.ofKind("chat_message")).toHaveLength(2);
		expect(restored.append("approval_mode", { enabled: true }).seq).toBe(3);
		expect(new EventLog(file).all().map(e => e.seq)).toEqual([1, 2, 3]);
	});
	it("supports unnumbered legacy names, oversized records and empty final segments", async () => {
		const { file, dir, log } = await setup("events.jsonl", 10);
		log.append("notice_enqueued", { text: "x".repeat(1000) });
		expect(readdirSync(dir).filter(n => n.startsWith("events"))).toEqual(["events.jsonl"]);
		writeFileSync(join(dir, "events-0002.jsonl"), "");
		const replay = new EventLog(file, 10); expect(replay.lastSeq()).toBe(1);
		expect(replay.append("notice_enqueued", {}).seq).toBe(2);
		expect(replay.activeFile()).toBe(join(dir, "events-0002.jsonl"));
	});
	it("preserves torn tails across rotation and repeated restarts without reusing committed seq", async () => {
		const { file, dir, log } = await setup();
		log.append("notice_enqueued", { text: "first" });
		appendFileSync(file, Buffer.concat([Buffer.from('{"seq":2,"data":{"text":"'), Buffer.from([0xe4, 0xb8])]));
		const replay = new EventLog(file, 1); expect(replay.warnings).toHaveLength(1);
		expect(replay.append("notice_enqueued", { text: "second" }).seq).toBe(2);
		expect(replay.activeFile()).toBe(join(dir, "events-0002.jsonl"));
		const again = new EventLog(file); expect(again.all().map(e => e.seq)).toEqual([1, 2]); expect(again.warnings).toHaveLength(1);
		expect(again.append("notice_enqueued", {}).seq).toBe(3);
	});
	it("rejects missing segments, duplicate/out-of-order seq and invalid event envelopes", async () => {
		const { file, dir, log } = await setup(); const first = log.append("notice_enqueued", {});
		const third = join(dir, "events-0003.jsonl"); writeFileSync(third, "");
		expect(() => new EventLog(file)).toThrow("EVENT_SEGMENT_MISSING");
		renameSync(third, join(dir, "events-0002.jsonl"));
		writeFileSync(join(dir, "events-0002.jsonl"), `${JSON.stringify(first)}\n`);
		expect(() => new EventLog(file)).toThrow("EVENT_SEQUENCE_INVALID");
		writeFileSync(join(dir, "events-0002.jsonl"), '{"seq":2,"kind":"notice_enqueued"}\n');
		expect(() => new EventLog(file)).toThrow("EVENT_RECORD_INVALID");
	});
	it("does not publish or consume seq when rotation fails, and retries after repair", async () => {
		const { file, dir, log } = await setup("events-0001.jsonl", 1); log.append("notice_enqueued", {});
		const collision = join(dir, "events-0002.jsonl"); mkdirSync(collision);
		expect(() => log.append("notice_enqueued", {})).toThrow(); expect(log.lastSeq()).toBe(1); expect(log.all()).toHaveLength(1);
		renameSync(collision, `${collision}.backup`);
		expect(log.append("notice_enqueued", {}).seq).toBe(2);
		expect(new EventLog(file).all().map(e => e.seq)).toEqual([1, 2]);
	});
	it("refuses external truncation and ignores unrelated backup/temp files", async () => {
		const { file, dir, log } = await setup(); log.append("notice_enqueued", {});
		writeFileSync(join(dir, "events-9999.jsonl.tmp"), "ignored"); writeFileSync(join(dir, "events-0002.jsonl.backup"), "ignored");
		expect(new EventLog(file).all()).toHaveLength(1);
		writeFileSync(file, ""); expect(() => log.append("notice_enqueued", {})).toThrow("EVENT_LOG_CHANGED");
		expect(log.all()).toHaveLength(1);
	});
	it("rolls back a short write before retry, without publishing an incomplete fact", async () => {
		const { file, log } = await setup("events-0001.jsonl", 10000); log.append("notice_enqueued", { text: "before" });
		const before = readFileSync(file); const write = fs.writeSync;
		vi.spyOn(fs, "writeSync").mockImplementationOnce((...args: unknown[]) => write(args[0] as number, args[1] as Buffer, args[2] as number, 7, args[4] as number))
			.mockImplementationOnce(() => { throw new Error("disk full"); });
		syncBuiltinESMExports();
		expect(() => log.append("notice_enqueued", { text: "partial" })).toThrow("disk full");
		expect(readFileSync(file)).toEqual(before); expect(log.lastSeq()).toBe(1);
		expect(log.append("notice_enqueued", { text: "retry" }).seq).toBe(2);
		expect(new EventLog(file).all().map(e => e.data.text)).toEqual(["before", "retry"]);
	});
	it("requires recovery when a failed write cannot be rolled back", async () => {
		const { log } = await setup(); log.append("notice_enqueued", {});
		vi.spyOn(fs, "writeSync").mockImplementationOnce(() => { throw new Error("write failed"); });
		vi.spyOn(fs, "ftruncateSync").mockImplementationOnce(() => { throw new Error("rollback failed"); });
		syncBuiltinESMExports();
		expect(() => log.append("notice_enqueued", {})).toThrow("write failed");
		expect(() => log.append("notice_enqueued", {})).toThrow("EVENT_LOG_RECOVERY_REQUIRED"); expect(log.lastSeq()).toBe(1);
	});
});
