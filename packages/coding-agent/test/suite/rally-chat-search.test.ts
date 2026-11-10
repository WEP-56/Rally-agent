import { describe, expect, it } from "vitest";
import { searchChat } from "../../../../src/main/supervisor/chat-search.ts";
import type { ChatLine } from "../../../../src/shared/ipc.ts";

const line = (n: number, text: string, role: ChatLine["role"] = "user"): ChatLine => ({ id: `#${n}`, text, role, at: n * 100, streaming: false });
describe("Rally chat search", () => {
	it("returns literal Unicode previews and exact full originals without system/relay/tool data", () => {
		const full = " 记住 [abc].* " + "😀".repeat(230) + "\n";
		const history = [line(1, full), line(2, "[abc].*", "assistant"), line(3, "[abc].*", "system"),
			{ ...line(4, "[abc].*"), relayId: "R-1" }, { ...line(5, "[abc].*", "assistant"), streaming: true }];
		const result = searchChat(history, { query: "[ABC].*" });
		expect(result.messages.map(m => m.id)).toEqual(["#2", "#1"]);
		expect([...result.messages[1].text]).toHaveLength(200);
		expect(searchChat(history, { id: "#1" }).messages[0].text).toBe(full);
		expect(searchChat(history, { id: "#3" }).messages).toEqual([]);
		expect(searchChat(history, { id: "#9" }).messages).toEqual([]);
	});
	it("paginates equal timestamps without duplicates and excludes new arrivals", () => {
		const history = Array.from({ length: 8 }, (_, i) => ({ ...line(i + 1, "match"), at: 100 }));
		const first = searchChat(history, { query: "match", limit: 3 });
		expect(first.messages.map(m => m.id)).toEqual(["#8", "#7", "#6"]);
		history.push({ ...line(9, "match"), at: 100 });
		const second = searchChat(history, { query: "match", limit: 3, cursor: first.next });
		expect(second.messages.map(m => m.id)).toEqual(["#5", "#4", "#3"]);
		const third = searchChat(history, { query: "match", limit: 3, cursor: second.next });
		expect(third.messages.map(m => m.id)).toEqual(["#2", "#1"]); expect(third.next).toBeUndefined();
		expect(() => searchChat(history, { query: "changed", limit: 3, cursor: first.next })).toThrow("CHAT_CURSOR_INVALID");
	});
	it("supports exclusive time bounds and neighbourhood lookup", () => {
		const history = Array.from({ length: 10 }, (_, i) => line(i + 1, String(i)));
		expect(searchChat(history, { before: 600, after: 300 }).messages.map(m => m.id)).toEqual(["#5", "#4"]);
		expect(searchChat(history, { aroundId: "#5", limit: 5 }).messages.map(m => m.id)).toEqual(["#7", "#6", "#5", "#4", "#3"]);
		expect(() => searchChat(history, { aroundId: "#99" })).toThrow("CHAT_MESSAGE_NOT_FOUND");
	});
	it("rejects invalid combinations, ranges and cursors", () => {
		for (const params of [{ limit: 0 }, { limit: 101 }, { after: -1 }, { after: 3, before: 2 }, { id: "no" }, { query: " " }, { id: "#1", query: "q" }])
			expect(() => searchChat([], params)).toThrow("CHAT_SEARCH_INVALID");
		expect(() => searchChat([], { cursor: "invalid" })).toThrow("CHAT_CURSOR_INVALID");
	});
});
