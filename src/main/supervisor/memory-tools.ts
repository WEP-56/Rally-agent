import type { ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { Quote, QuoteRef } from "../../shared/task.ts";
import type { MemoryStore } from "../memory-store.ts";

export function createMemoryTools(memory: MemoryStore, quote: (ref: QuoteRef) => Quote | null, isActive: () => boolean): ToolDefinition[] {
	const refs = Type.Array(Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }), { minItems: 1 });
	const append = Type.Object({ text: Type.String({ minLength: 1, maxLength: 300 }), quotes: refs });
	const remove = Type.Object({ entryId: Type.String({ pattern: "^M-[1-9][0-9]*$" }), quotes: refs });
	function basis(input: QuoteRef[]): string[] {
		if (!isActive()) throw new Error("SESSION_ENDED: 主会话已关闭");
		if (!Array.isArray(input) || !input.length) throw new Error("QUOTE_REQUIRED: 记忆修改需要用户原话引用");
		return [...new Set(input.map((ref) => {
			if (!ref || typeof ref.id !== "string" || ref.withProposal !== undefined) throw new Error("QUOTE_INVALID: 请直接引用明确要求记住或忘掉的用户消息");
			const source = quote({ id: ref.id });
			if (!source || source.kind !== "user") throw new Error("QUOTE_INVALID: 引用不存在或不是用户原话");
			return source.messageId;
		}))];
	}
	return [{
		name: "memory_append", label: "记住", parameters: append,
		description: "Append a short memory (1–300 characters) when the user explicitly asks to remember it. quotes references that user's message. Returns entryId and an optional size warning.",
		execute: async (id, input: Static<typeof append>, signal) => result(memory.append(input.text, basis(input.quotes), id, signal)),
	}, {
		name: "memory_remove", label: "忘掉", parameters: remove,
		description: "Remove an entryId shown in the current memory snapshot when the user explicitly asks to forget it. quotes references that user's message. Returns removed:true.",
		execute: async (id, input: Static<typeof remove>, signal) => result(memory.remove(input.entryId, basis(input.quotes), id, signal)),
	}];
}
function result(details: { entryId: string; warning?: string; reused?: boolean } | { removed: true }) { return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details }; }
