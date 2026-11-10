/** Bounded tool activity for display; never a worker conversation transcript. */
export interface ToolCall {
	id: string;
	runId?: string;
	name: string;
	input: string;
	status: "running" | "ok" | "error" | "interrupted";
	startedAt: number;
	endedAt?: number;
	output?: string;
}

export function toolInput(value: unknown): string {
	return truncateToolText(typeof value === "string" ? value : JSON.stringify(value) ?? "", 1000);
}

export function toolOutput(value: unknown): string {
	if (!value || typeof value !== "object" || !("content" in value) || !Array.isArray(value.content)) return "";
	return truncateToolText(value.content.map((part: unknown) => part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n"), 8000);
}

export function truncateToolText(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const half = Math.floor(limit / 2);
	return `${text.slice(0, half)}\n…（显示已截断）…\n${text.slice(-half)}`;
}
