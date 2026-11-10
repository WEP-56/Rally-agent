import type { ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { ChatLine } from "../../shared/ipc.ts";

const messageId = Type.String({ pattern: "^#[1-9][0-9]*$" });
export const ChatSearchSchema = Type.Object({
	query: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
	id: Type.Optional(messageId), aroundId: Type.Optional(messageId),
	before: Type.Optional(Type.Integer({ minimum: 0 })), after: Type.Optional(Type.Integer({ minimum: 0 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	cursor: Type.Optional(Type.String({ maxLength: 4096 })),
}, { additionalProperties: false });
export type ChatSearchParams = Static<typeof ChatSearchSchema>;

export function searchChat(history: readonly ChatLine[], params: ChatSearchParams) {
	const { query, id, aroundId, before, after, cursor } = params;
	const limit = params.limit ?? 20;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
		[before, after].some(value => value !== undefined && (!Number.isSafeInteger(value) || value < 0)) ||
		(before !== undefined && after !== undefined && before <= after) ||
		[id, aroundId].some(value => value !== undefined && !/^#[1-9]\d*$/.test(value)) ||
		(query !== undefined && (typeof query !== "string" || !query.trim() || query.length > 1000)) ||
		(id !== undefined && [query, aroundId, before, after, cursor].some(value => value !== undefined)))
		throw new Error("CHAT_SEARCH_INVALID: 检查查询、消息 ID、时间范围及分页参数；id 查询不可混用过滤条件");
	const source = history.filter(line => (line.role === "user" || line.role === "assistant") && !line.streaming && !line.relayId);
	if (id) return { messages: source.filter(line => line.id === id).map(line => pick(line, true)) };
	const anchor = aroundId ? source.find(line => line.id === aroundId) : undefined;
	if (aroundId && !anchor) throw new Error("CHAT_MESSAGE_NOT_FOUND: 定位消息不存在或不是用户/主助手消息");
	const signature = JSON.stringify([query ?? null, aroundId ?? null, before ?? null, after ?? null, limit]);
	let last: number | undefined;
	let ceiling = source.reduce((max, line) => Math.max(max, Number(line.id.slice(1))), 0);
	if (cursor !== undefined) {
		try {
			if (typeof cursor !== "string" || cursor.length > 4096) throw new Error();
			const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
			if (!decoded || typeof decoded !== "object" || !("signature" in decoded) || decoded.signature !== signature ||
				!("last" in decoded) || typeof decoded.last !== "number" || !Number.isSafeInteger(decoded.last) || decoded.last < 1 ||
				!("ceiling" in decoded) || typeof decoded.ceiling !== "number" || !Number.isSafeInteger(decoded.ceiling) || decoded.ceiling < decoded.last) throw new Error();
			last = decoded.last; ceiling = decoded.ceiling;
		} catch { throw new Error("CHAT_CURSOR_INVALID: 分页游标无效，或查询条件已经改变"); }
	}
	let found = source.filter(line => Number(line.id.slice(1)) <= ceiling && (before === undefined || line.at < before) &&
		(after === undefined || line.at > after) && (query === undefined || line.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
	// Around a message: chronological neighbours, newest first, with up to half the page on either side.
	if (anchor) {
		found.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
		const position = found.findIndex(line => Number(line.id.slice(1)) >= Number(anchor.id.slice(1)));
		const index = position === -1 ? found.length : position;
		found = found.slice(Math.max(0, index - Math.floor(limit / 2)), index + Math.ceil(limit / 2));
	}
	found.sort((a, b) => Number(b.id.slice(1)) - Number(a.id.slice(1)));
	if (last !== undefined) found = found.filter(line => Number(line.id.slice(1)) < last!);
	const page = found.slice(0, limit);
	const next = found.length > page.length ? Buffer.from(JSON.stringify({ signature, ceiling, last: Number(page.at(-1)!.id.slice(1)) })).toString("base64url") : undefined;
	return { messages: page.map(line => pick(line, false)), ...(next ? { next } : {}) };
}

function pick(line: ChatLine, full: boolean) {
	return { id: line.id, role: line.role as "user" | "assistant", at: line.at, text: full ? line.text : [...line.text].slice(0, 200).join("") };
}

export function createChatSearchTool(search: (params: ChatSearchParams) => ReturnType<typeof searchChat>): ToolDefinition {
	return { name: "chat_search", label: "搜索主对话", parameters: ChatSearchSchema,
		description: "Search complete main-chat history, including before compaction. Literal case-insensitive query, exclusive before/after Unix-millisecond timestamps, newest first, limit 1–100 (default 20). aroundId returns neighbours. Previews are 200 characters; id alone returns exact full text. Continue with cursor=next and identical filters. Only user/assistant messages; only user IDs can authorize actions.",
		execute: async (_id, params: ChatSearchParams, signal) => { signal?.throwIfAborted(); const details = search(params); return { content: [{ type: "text", text: JSON.stringify(details) }], details }; } };
}
