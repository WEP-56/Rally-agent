import { Type } from "typebox";
import { MEMORY_FILES, MEMORY_FILE_KEYS, type MemoryFileKey } from "../../shared/memory.ts";
import type { ChatLine } from "../../shared/ipc.ts";
import type { TaskContext } from "../../shared/task.ts";
import { TaskError } from "./task-store.ts";

export const TaskContextTurnsSchema = Type.Integer({ minimum: 0, maximum: 30,
	description: "Recent user conversation rounds to include automatically (0–30). One round is a user message and its following replies; the current request and tool logs are excluded. New tasks default to 0. No message IDs or excerpts needed." });
export const TaskMemorySchema = Type.Union([Type.Literal(0), Type.Literal(1)], {
	description: "0: no memory; 1: copy the full current USER, PREFERENCES and RECENT notebooks. New tasks default to 0. No searching or selecting entries needed." });

export interface TaskContextOptions { context?: number; memory?: 0 | 1 }
export interface TaskContextSources {
	recentTurns(count: number): TaskContext[];
	memory(file: MemoryFileKey): string;
}

const MAX_MESSAGE_CHARS = 4000;
const MAX_CHAT_CHARS = 60000;

/** Copy visible conversation rounds; never read tool payloads, thinking or attachment contents. */
export function recentChatContext(history: readonly ChatLine[], count: number, beforeId?: string): TaskContext[] {
	if (!Number.isInteger(count) || count < 0 || count > 30) throw new TaskError("CONTEXT_INVALID", "context 必须是 0–30 的整数");
	if (count === 0) return [];
	// Arrival and processing can differ while messages wait in the inbox.
	const ordered = history.filter(line => !line.delivery || line.delivery.status === "done" || line.delivery.status === "processing")
		.flatMap(line => line.role === "user" ? [line, ...history.filter(reply => reply.role === "assistant" && reply.replyTo === line.id)] : line.replyTo ? [] : [line]);
	const boundary = beforeId === undefined ? ordered.length : ordered.findIndex(line => line.id === beforeId);
	if (boundary < 0) return [];
	const rounds: ChatLine[][] = [];
	for (const line of ordered.slice(0, boundary)) {
		if (line.relayId) continue;
		if (line.role === "user") rounds.push([line]);
		else if (line.role === "assistant" && !line.streaming && line.text.trim() && rounds.length) rounds.at(-1)!.push(line);
	}
	const selected = rounds.slice(-count);
	// Reserve space for each selected message, so one long response cannot erase older rounds.
	const messages = selected.flat();
	const perMessage = Math.min(MAX_MESSAGE_CHARS, Math.floor(MAX_CHAT_CHARS / Math.max(1, messages.length)));
	return selected.flatMap(round => round.map(line => {
		const characters = [...line.text];
		const truncated = characters.length > perMessage;
		return { source: "chat" as const, id: line.id, role: line.role === "user" ? "user" as const : "assistant" as const,
			turnId: round[0].id, at: line.at, text: truncated ? characters.slice(0, perMessage).join("") : line.text,
			...(truncated ? { truncated: true } : {}) };
	}));
}

/** Each supplied switch replaces only its own part; omitted switches preserve existing snapshots. */
export function freezeTaskContext(options: TaskContextOptions, sources?: TaskContextSources, previous: TaskContext[] = []): TaskContext[] | undefined {
	const { context, memory } = options;
	if (context !== undefined && (!Number.isInteger(context) || context < 0 || context > 30)) throw new TaskError("CONTEXT_INVALID", "context 必须是 0–30 的整数");
	if (memory !== undefined && memory !== 0 && memory !== 1) throw new TaskError("MEMORY_INVALID", "memory 必须是 0 或 1");
	if (context === undefined && memory === undefined) return undefined;
	if ((context || memory) && !sources) throw new TaskError("CONTEXT_SOURCE_INVALID", "主对话或记忆来源不可用");
	const chat = context === undefined ? previous.filter(entry => entry.source === "chat") : context ? sources!.recentTurns(context) : [];
	let notebook = memory === undefined ? previous.filter(entry => entry.source === "memory") : [];
	if (memory === 1) notebook = MEMORY_FILE_KEYS.flatMap(file => {
		const text = sources!.memory(file);
		if (Buffer.byteLength(text, "utf8") > MEMORY_FILES[file].budget) throw new TaskError("MEMORY_OVER_BUDGET", `${MEMORY_FILES[file].name} 超过现有记忆预算，请先精简；不会偷偷截断全量记忆`);
		return text.trim() ? [{ source: "memory" as const, file, text }] : [];
	});
	return structuredClone([...chat, ...notebook]);
}

/** A small receipt lets the model see missing rounds or bounded text without rereading it all. */
export function taskContextSummary(entries: TaskContext[] = []) {
	const chat = entries.filter(entry => entry.source === "chat");
	return { turns: new Set(chat.map(entry => entry.turnId ?? (entry.role === "user" ? entry.id : undefined)).filter(Boolean)).size,
		messages: chat.length, memoryFiles: entries.filter(entry => entry.source === "memory").map(entry => entry.file),
		truncatedMessages: chat.filter(entry => entry.truncated).length };
}
