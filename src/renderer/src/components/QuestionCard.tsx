import { Disclosure } from "../md3/interactive";
import { motion } from "motion/react";
import { SPRING_JELLY, SPRING_LAYOUT } from "../md3/springs";
import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type { TaskAttention } from "../../../shared/task";
import { Button, Textarea } from "./ui";

export function QuestionCard({ taskId, title, question, answer }: {
	taskId: string; title: string; question: TaskAttention; answer(text: string): Promise<unknown>;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [text, setText] = useState("");
	async function submit(option: string) {
		if (busy) return;
		setBusy(true); setError("");
		try { await answer(option); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
	}
	if (question.answer || question.closed) return <Disclosure layout layoutId={`attention-${question.id}`} transition={SPRING_LAYOUT} id={`question-${question.id}`} tabIndex={-1} className="group/question ml-8 max-w-[448px] self-start bg-md-surface-low text-xs text-muted">
		<summary className="hover:text-fg">
			<MessageCircleQuestion size={13} className="shrink-0 text-md-primary" />
			<span className="truncate">{taskId} · {question.id} · {question.answer ? question.answer.by === "user" ? "你已回答" : "主 agent 已代答" : question.closed?.reason === "replaced" ? "问题已替换" : question.closed?.reason === "cleared" ? "问题已撤回" : "问题已失效"}</span>
		</summary>
		<div className="selectable max-h-64 overflow-auto whitespace-pre-wrap break-words pt-1 text-xs leading-relaxed"><div>{question.question}</div>{question.answer && <div className="mt-1.5 font-medium text-fg">回答：{question.answer.text}</div>}</div>
	</Disclosure>;
	return <motion.div layout layoutId={`attention-${question.id}`} initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING_LAYOUT} id={`question-${question.id}`} tabIndex={-1} className="ml-8 max-w-[448px] rounded-[26px] bg-md-surface-high p-4 text-sm">
		<div className="flex items-center justify-between gap-2">
			<div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-md-primary">
				<MessageCircleQuestion size={14} className="shrink-0" />
				<span className="font-mono">{taskId}</span>
				<span className="truncate text-muted">· {title}</span>
			</div>
			<span className="shrink-0 rounded-full bg-md-tertiary-container px-2.5 py-0.5 text-[10.5px] font-semibold text-md-on-tertiary-container">待回答</span>
		</div>
		<div className="mt-2.5 whitespace-pre-wrap break-words text-[13.5px] font-medium leading-relaxed">{question.question}</div>
		{!!question.options?.length && <div className="mt-3 flex flex-col gap-2">{question.options.map((option, index) => <motion.button type="button" key={index} disabled={busy} whileHover={busy ? undefined : { scale: 1.015, x: 2 }} whileTap={busy ? undefined : { scale: 0.96, borderRadius: 10 }} transition={SPRING_JELLY} onClick={() => void submit(option)} className="md3-state-layer flex min-h-10 items-center gap-2.5 rounded-[18px] bg-md-surface-lowest/85 px-3 py-2.5 text-left text-[13px] text-fg disabled:opacity-40"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-md-secondary-container text-[11px] font-bold text-md-on-secondary-container">{String.fromCharCode(65 + index)}</span><span className="leading-snug">{option}</span></motion.button>)}</div>}
		<form className="mt-3 flex flex-col gap-2" onSubmit={event => { event.preventDefault(); if (text.trim()) void submit(text); }}>
			<Textarea aria-label="你的回答" placeholder="选项不合适？在这里输入你的回答" rows={2} value={text} disabled={busy} onChange={event => setText(event.target.value)} className="bg-md-surface-lowest/80" />
			<Button type="submit" variant="primary" size="sm" className="self-end" disabled={busy || !text.trim()}>{busy ? "提交中…" : "提交回答"}</Button>
		</form>
		{error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
	</motion.div>;
}
