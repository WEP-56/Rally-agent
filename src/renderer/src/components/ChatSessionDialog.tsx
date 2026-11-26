import { motion } from "motion/react";
import { SPRING_FAST } from "../md3/springs";
import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { useBrowserOverlay } from "../browser-overlays";
import { Button, RallyLogo } from "./ui";

export type ChatSessionOperation = "compact" | "new";
export type ChatSessionPhase = "confirm" | "busy" | "done" | "error";

export function ChatSessionDialog({ operation, phase, error, onConfirm, onHide, onClose }: {
	operation: ChatSessionOperation; phase: ChatSessionPhase | null; error: string; onConfirm(): void; onHide(): void; onClose(): void;
}) {
	const dialog = useRef<HTMLDialogElement>(null);
	const fresh = operation === "new";
	useBrowserOverlay(phase !== null);
	useEffect(() => {
		if (phase && !dialog.current?.open) dialog.current?.showModal();
		if (!phase && dialog.current?.open) dialog.current.close();
	}, [phase]);
	return <motion.dialog initial={false} animate={{ opacity: phase ? 1 : 0, scale: phase ? 1 : 0.96 }} transition={SPRING_FAST} ref={dialog} onCancel={event => { event.preventDefault(); if (phase !== "busy") onClose(); }}
		aria-labelledby="chat-session-title" aria-describedby="chat-session-description" aria-busy={phase === "busy"}
		className="glass-strong m-auto w-[min(400px,90vw)] rounded-[30px] p-7 text-center text-fg shadow-pop backdrop:bg-ink/30 backdrop:backdrop-blur-[3px]">
		<RallyLogo size={56} glow className="mx-auto" />
		<h2 id="chat-session-title" className="font-display mt-5 text-[20px] font-semibold">
			{fresh ? (phase === "busy" ? "正在新建会话" : phase === "error" ? "未能新建会话" : "要和 Rally 重新开始吗？")
				: phase === "busy" ? "正在整理上下文" : phase === "done" ? "上下文已整理" : phase === "error" ? "上下文未整理" : "整理上下文？"}
		</h2>
		<div id="chat-session-description" className="mt-2 text-[13.5px] leading-relaxed text-muted">
			{phase === "busy" ? <div className="flex items-center justify-center gap-2"><LoaderCircle size={16} className="animate-spin" />请稍候，完成前暂时锁定界面。</div>
				: phase === "done" ? "是否屏蔽旧会话？屏蔽后可随时显示，原话引用和任务记录会保留。"
				: phase === "error" ? error
				: fresh ? <><p>离开这段对话前，请确认 Rally 的记忆已经更新，并妥善保存在原目录。</p><p className="mt-2">新建会话不可撤销。没来得及写进记忆的那些事，TA 可能就不记得了，也可能会忘记你。</p></>
				: "将压缩模型上下文，对话历史、任务和原话引用会保留。"}
		</div>
		{phase !== "busy" && <div className="mt-6 flex justify-center gap-2.5">
			<Button onClick={onClose}>{phase === "done" ? "保留显示" : phase === "error" ? "关闭" : fresh ? "留在这里" : "取消"}</Button>
			{phase === "confirm" && <Button variant={fresh ? "danger" : "primary"} onClick={onConfirm}>{fresh ? "确认新建会话" : "确认整理"}</Button>}
			{phase === "done" && <Button variant="primary" onClick={onHide}>屏蔽旧会话</Button>}
		</div>}
	</motion.dialog>;
}
