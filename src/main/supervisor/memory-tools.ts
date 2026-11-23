import type { ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { MemoryStore } from "../memory-store.ts";

export function createMemoryTools(memory: MemoryStore, isActive: () => boolean): ToolDefinition[] {
	const file = Type.Union([Type.Literal("USER"), Type.Literal("PREFERENCES"), Type.Literal("RECENT")]);
	const add = Type.Object({ file, text: Type.String({ minLength: 1, maxLength: 500 }) }, { additionalProperties: false });
	const edit = Type.Object({ file, old: Type.String({ minLength: 1 }), new: Type.String() }, { additionalProperties: false });
	const active = () => { if (!isActive()) throw new Error("SESSION_ENDED: 主会话已关闭"); };
	return [{
		name: "memory_add", label: "记下", parameters: add,
		description: `Add one entry to your notebook about the user. file is USER (who they are: lasting facts), PREFERENCES (how they like things done) or RECENT (things happening now that will end). Write one line in the user's language, ending with its metadata in parentheses: (fact|inferred, source message or task ID, YYYY-MM-DD), and for RECENT also "; drop: <when this can be deleted>". The entry is appended to the end of the file; a nightly pass files and merges entries, so do not spend effort on placement. Fails if the file would exceed its budget: shorten or remove an older entry with memory_edit first.`,
		execute: async (id, input: Static<typeof add>, signal) => { active(); return result(memory.add(input.file, input.text, id, signal)); },
	}, {
		name: "memory_edit", label: "修改记忆", parameters: edit,
		description: "Change or delete existing notebook text. old must match exactly one passage in the current memory snapshot of that file; new replaces it, and an empty new deletes it. Use this when the user corrects something you have on file, when a newer fact replaces an older one, when a RECENT item is resolved, or when they ask you to forget something. Fails if old is not found or matches more than once, which usually means the file changed: check the snapshot in your next request.",
		execute: async (id, input: Static<typeof edit>, signal) => { active(); return result(memory.edit(input.file, input.old, input.new, id, signal)); },
	}];
}
function result(details: object) { return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details }; }
