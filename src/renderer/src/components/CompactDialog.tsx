import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useBrowserOverlay } from "../browser-overlays";
import { Button } from "./ui";

export type CompactPhase = "confirm" | "busy" | "done" | "error";

export function CompactDialog({ phase, error, onConfirm, onHide, onClose }: {
	phase: CompactPhase | null; error: string; onConfirm(): void; onHide(): void; onClose(): void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	useBrowserOverlay(phase !== null);
	useEffect(() => {
		if (phase && !dialog.current?.open) dialog.current?.showModal();
		if (!phase && dialog.current?.open) dialog.current.close();
	}, [phase]);
	return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (phase !== "busy") onClose(); }}
		aria-labelledby="compact-title" aria-busy={phase === "busy"}
		className="m-auto w-[min(420px,90vw)] rounded-2xl bg-panel p-6 text-fg shadow-pop backdrop:bg-black/40">
		<h2 id="compact-title" className="text-base font-semibold">{phase === "busy" ? "正在整理上下文" : phase === "done" ? "上下文已整理" : phase === "error" ? "上下文未整理" : "整理上下文？"}</h2>
		<div className="mt-3 text-sm leading-relaxed text-muted">
			{phase === "busy" ? <div className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />请稍候，完成前暂时锁定界面。</div>
				: phase === "done" ? "是否屏蔽旧会话？屏蔽后可随时显示，原话引用和任务记录会保留。"
				: phase === "error" ? error : "将压缩模型上下文，对话历史、任务和原话引用会保留。"}
		</div>
		{phase !== "busy" && <div className="mt-5 flex justify-end gap-2">
			<Button onClick={onClose}>{phase === "done" ? "保留显示" : phase === "error" ? "关闭" : "取消"}</Button>
			{phase === "confirm" && <Button variant="primary" onClick={onConfirm}>确认整理</Button>}
			{phase === "done" && <Button variant="primary" onClick={onHide}>屏蔽旧会话</Button>}
		</div>}
	</dialog>;
}
