import { useState } from "react";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
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
	if (question.answer || question.closed) return <details id={`question-${question.id}`} tabIndex={-1} className="group/question min-w-0 text-sm text-muted">
		<summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 hover:text-fg [&::-webkit-details-marker]:hidden">
			<MessageCircleQuestion size={14} className="shrink-0 text-faint" />
			<span className="truncate">{taskId} · {question.id} · {question.answer ? question.answer.by === "user" ? "你已回答" : "主 agent 已代答" : question.closed?.reason === "replaced" ? "问题已替换" : question.closed?.reason === "cleared" ? "问题已撤回" : "问题已失效"}</span>
			<ChevronRight size={14} className="shrink-0 text-faint group-open/question:rotate-90" />
		</summary>
		<div className="selectable mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words pl-5 leading-relaxed"><div>{question.question}</div>{question.answer && <div className="mt-2">回答：{question.answer.text}</div>}</div>
	</details>;
	return <div id={`question-${question.id}`} tabIndex={-1} className="ml-8 max-w-[440px] rounded-[22px] border border-warn/30 bg-panel p-5 text-sm shadow-soft">
		<div className="font-medium">{taskId} · {title} · 待回答</div>
		<div className="mt-2 whitespace-pre-wrap break-words">{question.question}</div>
		{!!question.options?.length && <div className="mt-3 flex flex-col gap-2">{question.options.map((option, index) => <button key={index} disabled={busy} onClick={() => void submit(option)} className="flex min-h-10 items-center gap-3 rounded-xl bg-sunken px-3 py-2 text-left text-[13px] text-fg hover:bg-hover disabled:opacity-40"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-panel text-xs font-semibold text-muted">{String.fromCharCode(65 + index)}</span>{option}</button>)}</div>}
		<form className="mt-3 flex flex-col gap-2" onSubmit={event => { event.preventDefault(); if (text.trim()) void submit(text); }}>
			<Textarea aria-label="你的回答" placeholder="选项不合适？在这里输入你的回答" rows={2} value={text} disabled={busy} onChange={event => setText(event.target.value)} />
			<Button type="submit" size="sm" className="self-end" disabled={busy || !text.trim()}>{busy ? "提交中…" : "提交回答"}</Button>
		</form>
		{error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
	</div>;
}
