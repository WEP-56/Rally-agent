import { ChevronRight, Sparkles } from "lucide-react";
import type { AssistantBlock } from "../../../shared/conversation";
import type { ToolCall } from "../../../shared/tools";
import { RichText } from "./RichText";
import { ToolActivity } from "./ToolActivity";

type DisplayBlock = Exclude<AssistantBlock, { type: "tool" }> | { type: "tools"; calls: ToolCall[] };

/** Preserve the provider's block order; only adjacent tool calls share a collapsed group. */
export function AssistantContent({ blocks, calls = [], streaming }: { blocks: AssistantBlock[]; calls?: ToolCall[]; streaming?: boolean }) {
	const byId = new Map(calls.map((call) => [call.id, call]));
	const display: DisplayBlock[] = [];
	for (const block of blocks) {
		if (block.type !== "tool") { display.push(block); continue; }
		const call = byId.get(block.toolCallId);
		if (!call) continue;
		const last = display.at(-1);
		if (last?.type === "tools") last.calls.push(call);
		else display.push({ type: "tools", calls: [call] });
	}
	return <div className="flex min-w-0 flex-col gap-2">
		{display.map((block, index) => block.type === "tools" ? <ToolActivity key={index} calls={block.calls} />
			: block.type === "text" ? block.text.trim() && <RichText key={index} text={block.text} className="break-words text-fg" />
			: <details key={index} className="group/thinking my-1.5 min-w-0 text-muted">
				<summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-sm hover:text-fg [&::-webkit-details-marker]:hidden">
					<Sparkles size={14} className="shrink-0 text-faint" />
					<span>{streaming && index === display.length - 1 ? "思考中…" : "思考内容"}</span>
					<ChevronRight size={14} className="text-faint transition-transform group-open/thinking:rotate-90" />
				</summary>
				<div className="selectable mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words pl-5 text-sm leading-relaxed">{block.text || "等待模型返回思考内容…"}</div>
			</details>)}
	</div>;
}
