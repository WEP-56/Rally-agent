import type { ToolCall } from "./tools.ts";

/** Displayable provider content only; signatures and opaque reasoning data never enter the UI. */
export type AssistantBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "tool"; toolCallId: string };

export interface AssistantMessageView {
	id: string;
	runId: string;
	at: number;
	text: string;
	blocks: AssistantBlock[];
	streaming: boolean;
	toolCalls?: ToolCall[];
}

export function assistantContent(message: unknown, toolPrefix = ""): { text: string; blocks: AssistantBlock[] } {
	const content = message && typeof message === "object" && "content" in message ? message.content : undefined;
	if (typeof content === "string") return { text: content, blocks: [{ type: "text", text: content }] };
	const blocks: AssistantBlock[] = [];
	if (Array.isArray(content)) for (const part of content) {
		if (!part || typeof part !== "object") continue;
		if (part.type === "text" && typeof part.text === "string" && part.text) blocks.push({ type: "text", text: part.text });
		if (part.type === "thinking" && part.redacted !== true && typeof part.thinking === "string" && part.thinking) blocks.push({ type: "thinking", text: part.thinking });
		if (part.type === "toolCall" && typeof part.id === "string") blocks.push({ type: "tool", toolCallId: `${toolPrefix}${part.id}` });
	}
	return { text: blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join(""), blocks };
}
