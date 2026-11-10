import { useState } from "react";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import type { TaskAttention } from "../../../shared/task";

export function QuestionCard({ taskId, title, question, answer }: {
	taskId: string; title: string; question: TaskAttention; answer(option: string): Promise<unknown>;
}) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
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
	return <div id={`question-${question.id}`} tabIndex={-1} className="rounded-xl bg-sunken px-3.5 py-3 text-sm">
		<div className="font-medium">{taskId} · {title} · 待回答</div>
		<div className="mt-2 whitespace-pre-wrap break-words">{question.question}</div>
		{!!question.options?.length && <div className="mt-3 flex flex-wrap gap-2">{question.options.map((option, index) => <button key={index} disabled={busy} onClick={() => void submit(option)} className="min-h-7 rounded-md bg-raised px-3 py-1 text-xs text-muted disabled:opacity-40">{option}</button>)}</div>}
		<p className="mt-2 text-xs text-muted">或直接在下方输入你的回答</p>
		{error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
	</div>;
}
