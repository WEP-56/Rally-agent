// Composer model picker: providers as dim group captions, models beneath, and a
// fly-out to the right for thinking strength (only when the model supports it).

import { useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import type { ModelSummary, ThinkingLevelName } from "../../../shared/models";
import { cn } from "../utils/cn";
import { useClickOutside } from "./ui";

const LEVEL_LABEL: Record<string, string> = {
	off: "关闭",
	minimal: "极低",
	low: "低",
	medium: "中",
	high: "高",
	xhigh: "很高",
	max: "最高",
};

export function ModelPicker({
	models,
	model,
	thinkingLevel,
	onSelect,
	direction = "up",
}: {
	models: ModelSummary[];
	model: string | null;
	thinkingLevel: string | null;
	onSelect: (provider: string, model: string, level?: ThinkingLevelName) => void;
	direction?: "up" | "down";
}) {
	const [open, setOpen] = useState(false);
	const [hovered, setHovered] = useState<ModelSummary | null>(null);
	const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));

	const current = models.find((entry) => `${entry.provider}/${entry.id}` === model) ?? null;
	const groups: { provider: string; providerName: string; models: ModelSummary[] }[] = [];
	for (const entry of models) {
		const group = groups.find((g) => g.provider === entry.provider);
		if (group) group.models.push(entry);
		else groups.push({ provider: entry.provider, providerName: entry.providerName, models: [entry] });
	}
	const panel = hovered?.reasoning && hovered.thinkingLevels.length > 0 ? hovered : null;

	const pick = (entry: ModelSummary) => {
		if (entry.reasoning && entry.thinkingLevels.length > 0) {
			setHovered(entry);
			// The model applies immediately; the panel stays open for the level choice.
			onSelect(entry.provider, entry.id, current?.provider === entry.provider && current.id === entry.id ? (thinkingLevel as ThinkingLevelName) : undefined);
			return;
		}
		onSelect(entry.provider, entry.id);
		setOpen(false);
	};

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={cn(
					"flex h-7 max-w-[190px] items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-fg",
					open && "bg-hover text-fg",
				)}
				title={current ? `${current.providerName} · ${current.id}` : "选择模型"}
			>
				<span className="truncate">{current ? current.name : "选择模型"}</span>
				<ChevronDown size={13} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
			</button>
			{open && (
				<div className={cn("animate-pop absolute z-50 flex rounded-xl bg-raised p-1.5 shadow-pop", direction === "up" ? "bottom-full left-0 mb-1.5" : "top-full right-0 mt-1.5")}>
					<div className="max-h-72 w-60 overflow-auto">
						{models.length === 0 && (
							<div className="px-2.5 py-3 text-[11px] leading-relaxed text-faint">
								还没有可用模型。
								<br />
								请到 设置 → 供应商 中添加并保存。
							</div>
						)}
						{groups.map((group) => (
							<div key={group.provider}>
								<div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-faint">{group.providerName}</div>
								{group.models.map((entry) => {
									const active = current?.provider === entry.provider && current.id === entry.id;
									return (
										<button
											key={entry.id}
											type="button"
											onMouseEnter={() => setHovered(entry)}
											onFocus={() => setHovered(entry)}
											onClick={() => pick(entry)}
											className={cn(
												"flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-hover",
												active && "text-fg",
											)}
										>
											<span className="flex-1 truncate">{entry.name}</span>
											{active && <Check size={14} className="shrink-0 text-accent" />}
											{entry.reasoning && entry.thinkingLevels.length > 0 && (
												<ChevronRight size={13} className="shrink-0 text-faint" />
											)}
										</button>
									);
								})}
							</div>
						))}
					</div>
					{panel && (
						<div className="ml-1 w-28 shrink-0 border-l border-line pl-1">
							<div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-faint">思考强度</div>
							{panel.thinkingLevels.map((level) => {
								const active =
									current?.provider === panel.provider && current.id === panel.id && thinkingLevel === level;
								return (
									<button
										key={level}
										type="button"
										onClick={() => {
											onSelect(panel.provider, panel.id, level);
											setOpen(false);
										}}
										className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-hover"
									>
										<span className="flex-1">{LEVEL_LABEL[level] ?? level}</span>
										{active && <Check size={14} className="shrink-0 text-accent" />}
									</button>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
