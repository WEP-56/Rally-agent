import { ChevronRight, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { AssistantBlock } from "../../../shared/conversation";
import type { ToolCall } from "../../../shared/tools";
import { RichText } from "./RichText";
import { ToolActivity } from "./ToolActivity";

type DisplayBlock = Exclude<AssistantBlock, { type: "tool" }> | { type: "tools"; calls: ToolCall[] };

/** Preserve the provider's block order; only adjacent tool calls share a collapsed group. */
export function AssistantContent({ blocks, calls = [], streaming, avatar }: { blocks: AssistantBlock[]; calls?: ToolCall[]; streaming?: boolean; avatar?: ReactNode }) {
	const byId = new Map(calls.map((call) => [call.id, call]));
	const display: DisplayBlock[] = [];
	for (const block of blocks) {
		if (block.type !== "tool") { if (block.text.trim()) display.push(block); continue; }
		const call = byId.get(block.toolCallId);
		if (!call) continue;
		const last = display.at(-1);
		if (last?.type === "tools") last.calls.push(call);
		else display.push({ type: "tools", calls: [call] });
	}
	return <div className="flex min-w-0 flex-col gap-3.5">
		{display.map((block, index) => block.type === "tools" ? <div key={index} className={avatar ? "pl-[38px]" : undefined}><ToolActivity calls={block.calls} /></div>
			: block.type === "text" ? avatar ? <div key={index} className="flex items-start gap-2.5">{avatar}<div className="glass min-w-0 max-w-[90%] rounded-[20px] rounded-tl-md px-4 py-2.5 text-sm leading-[1.65]"><RichText text={block.text} className="break-words text-fg" /></div></div> : <RichText key={index} text={block.text} className="break-words text-fg" />
			: <details key={index} className={`group/thinking min-w-0 text-muted ${avatar ? "glass ml-[38px] rounded-2xl px-3.5 py-1.5" : "my-1.5"}`}>
				<summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md py-1 text-[12.5px] hover:text-fg [&::-webkit-details-marker]:hidden">
					<Sparkles size={14} className="shrink-0 text-faint" />
					<span>{streaming && index === display.length - 1 ? "思考中…" : "思考内容"}</span>
					<ChevronRight size={14} className="text-faint transition-transform group-open/thinking:rotate-90" />
				</summary>
				<div className="selectable mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words pl-5 text-sm leading-relaxed">{block.text || "等待模型返回思考内容…"}</div>
			</details>)}
	</div>;
}
