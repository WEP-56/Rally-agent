import type { ToolCall } from "../../../shared/tools";
import type { StepKind } from "../data";
import { ToolSteps } from "./ToolSteps";

function kind(name: string): StepKind {
	if (name === "memory_append" || name === "memory_remove") return "memory";
	if (name === "bash" || name === "powershell" || name === "git") return "cmd";
	if (name === "read" || name === "write" || name === "edit") return name;
	if (name === "file_delete") return "delete";
	if (name === "grep" || name === "find" || name === "ls" || name === "git_inspect") return "search";
	return "web";
}

export function ToolActivity({ calls }: { calls: ToolCall[] }) {
	return <ToolSteps rich steps={calls.map((call) => ({ kind: kind(call.name), title: call.name, target: call.input, output: call.output, status: call.status,
		duration: call.endedAt ? `${((call.endedAt - call.startedAt) / 1000).toFixed(1)}s` : undefined }))} />;
}
