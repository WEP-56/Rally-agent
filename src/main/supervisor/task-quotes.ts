import { Type } from "typebox";
import type { Quote, QuoteRef } from "../../shared/task.ts";
import { TaskError } from "./task-store.ts";

export const QuoteRefSchema = Type.Object({
	id: Type.String({ description: 'chat line id such as "#1203"' }),
	withProposal: Type.Optional(Type.Boolean({ description: "also quote the main agent's confirmed proposal before it" })),
});

/** Freeze every reference; reject the whole call if one cannot be quoted. */
export function freezeQuotes(host: { quote(ref: QuoteRef): Quote | null; recentQuoteIds?(): string[] }, refs: QuoteRef[]): Quote[] {
	if (refs.length === 0) throw new TaskError("QUOTE_REQUIRED", "必须引用用户原话（至少一条）");
	return refs.map((ref, index) => {
		const quote = host.quote(ref);
		if (!quote) {
			const recent = host.recentQuoteIds?.() ?? [];
			const hint = recent.length ? ` 最近可引用的用户消息 ID：${recent.join("、")}（请先核对原文是否覆盖本次需求）。` : "";
			throw new TaskError("QUOTE_INVALID", `quotes[${index}].id=${JSON.stringify(ref.id)} 无法引用：消息不存在、不是已受理的用户消息，或 withProposal 找不到紧邻的助手提议。${hint} 用 chat_search 的 {id:\"#消息ID\"} 核对原文，或 {query:\"需求关键词\"} 查找更早消息；不要猜测 ID。`);
		}
		return quote;
	});
}
