import type { ToolCall } from "../../../shared/tools";
import type { StepKind } from "../data";
import { ToolSteps } from "./ToolSteps";

function kind(name: string): StepKind {
	if (name === "memory_append" || name === "memory_remove") return "memory";
	if (name === "bash" || name === "powershell" || name === "git") return "cmd";
	if (name === "read" || name === "write" || name === "edit") return name;
	if (name === "file_delete") return "delete";
	if (name === "grep" || name === "find" || name === "ls" || name === "git_inspect" || name === "chat_search") return "search";
	if (name.startsWith("task_") || name === "escalate" || name.startsWith("gate_")) return "task";
	if (name === "fetch_page" || name === "http_request" || name.startsWith("github_")) return "web";
	return "tool";
}

function target(call: ToolCall): string {
	try {
		const input = JSON.parse(call.input) as Record<string, unknown>;
		const value = input.path ?? input.command ?? input.url ?? input.taskId;
		if (typeof value === "string" && value) return value;
	} catch { /* Legacy input previews can be plain text. */ }
	return call.input;
}

export function ToolActivity({ calls }: { calls: ToolCall[] }) {
	return <ToolSteps rich steps={calls.map((call) => ({ kind: kind(call.name), title: call.name, target: target(call), output: `参数\n${call.input}${call.output ? `\n\n结果\n${call.output}` : ""}`, status: call.status,
		duration: call.endedAt ? `${((call.endedAt - call.startedAt) / 1000).toFixed(1)}s` : undefined }))} />;
}
