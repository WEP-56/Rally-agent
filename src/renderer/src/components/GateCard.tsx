import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import type { TaskGate } from "../../../shared/gate";

export function GateCard({ taskId, gate, openTask, decide }: { taskId: string; gate: TaskGate; openTask?(): void; decide(value: "allow" | "deny"): Promise<unknown> }) {
	const [now, setNow] = useState(Date.now());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		if (gate.decision) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [gate.decision]);
	const seconds = Math.max(0, Math.ceil((gate.expiresAt - now) / 1000));
	const deletePaths = (field: "uncommitted" | "outsideCwd") => gate.tool === "file_delete" && Array.isArray(gate.arguments[field])
		? gate.arguments[field].filter((path): path is string => typeof path === "string") : [];
	const uncommitted = deletePaths("uncommitted");
	const outsideCwd = deletePaths("outsideCwd");
	const mailBody = gate.tool === "qqmail_send" && typeof gate.arguments.text === "string" ? gate.arguments.text : null;
	async function submit(value: "allow" | "deny") {
		setBusy(true); setError("");
		try { await decide(value); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
	}
	const task = openTask ? <button type="button" className="font-medium underline decoration-current/40 underline-offset-2 hover:text-fg" onClick={openTask}>{taskId}</button> : taskId;
	if (gate.decision) return <div id={`gate-${gate.id}`} tabIndex={-1} className="glass-strong ml-8 flex max-w-[440px] gap-2 rounded-[20px] px-3.5 py-2 text-xs text-muted"><Shield size={14} className="shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{task} · {gate.id} · 已{gate.decision.value === "allow" ? "允许" : "拒绝"}（{gate.decision.actor === "user" ? "你" : gate.decision.actor === "main" ? "主 agent" : "系统"}{gate.decision.basis.length ? `，依据 ${gate.decision.basis.join("、")}` : ""}） · {gate.decision.reason}</span></div>;
	return <div id={`gate-${gate.id}`} tabIndex={-1} className="ml-8 max-w-[440px] overflow-hidden rounded-[22px] border border-warn/30 bg-panel px-4 pb-4 text-sm shadow-soft">
		<div className="-mx-4 mb-3 flex flex-wrap items-center justify-between gap-2 bg-warn-soft px-4 py-2.5 text-xs font-medium text-warn"><span>{task} · {gate.id} 请求不可逆操作</span><span className="text-xs tabular-nums text-muted">剩余 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></div>
		<div className="mt-2 whitespace-pre-wrap break-words">{gate.action}</div>
		<div className="mt-1 break-all font-mono text-xs text-muted">{gate.tool} · {gate.cwd}</div>
		<div className="mt-2 whitespace-pre-wrap break-words text-xs text-muted">影响范围：{gate.scope.join("\n")}<br />可替代做法：{gate.alternative}</div>
		{uncommitted.length > 0 && <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">未提交改动：{uncommitted.join("\n")}</div>}
		{outsideCwd.length > 0 && <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">cwd 外目标：{outsideCwd.join("\n")}</div>}
		{mailBody !== null && <div className="mt-3 text-xs text-muted"><span className="font-medium">邮件正文</span><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-raised p-2 font-sans text-fg">{mailBody}</pre></div>}
		<details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">原始参数</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(gate.arguments, null, 2)}</pre></details>
		<div className="mt-3 flex justify-end gap-2"><button disabled={busy || seconds === 0} onClick={() => void submit("deny")} className="h-7 rounded-full bg-raised px-3 text-xs text-muted disabled:opacity-40">拒绝</button><button disabled={busy || seconds === 0} onClick={() => void submit("allow")} className="h-7 rounded-full bg-ink px-3 text-xs text-white dark:bg-white dark:text-ink disabled:opacity-40">{mailBody !== null ? "确认发送" : "允许"}</button></div>
		{error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
	</div>;
}
