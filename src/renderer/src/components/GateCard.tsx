import { ActionButton, Disclosure } from "../md3/interactive";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "../md3/springs";
import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import type { TaskGate } from "../../../shared/gate";
import { Button } from "./ui";

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
	const task = openTask ? <ActionButton type="button" className="font-mono font-semibold underline decoration-current/40 underline-offset-2 hover:opacity-100" onClick={openTask}>{taskId}</ActionButton> : <span className="font-mono font-semibold">{taskId}</span>;
	if (gate.decision) return <motion.div layout layoutId={`attention-${gate.id}`} transition={SPRING_LAYOUT} id={`gate-${gate.id}`} tabIndex={-1} className="ml-8 inline-flex max-w-[448px] items-center gap-2 self-start rounded-full bg-md-surface-low px-3.5 py-1.5 text-xs text-muted"><Shield size={13} className="shrink-0 text-md-primary" aria-hidden="true" /><span className="min-w-0 break-words">{task} · {gate.id} · 已{gate.decision.value === "allow" ? "允许" : "拒绝"}（{gate.decision.actor === "user" ? "你" : gate.decision.actor === "main" ? "主 agent" : "系统"}{gate.decision.basis.length ? `，依据 ${gate.decision.basis.join("、")}` : ""}） · {gate.decision.reason}</span></motion.div>;
	return <motion.div layout layoutId={`attention-${gate.id}`} initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING_LAYOUT} id={`gate-${gate.id}`} tabIndex={-1} className="ml-8 max-w-[448px] overflow-hidden rounded-[26px] bg-md-surface-high p-2 text-sm">
		<div className="flex flex-wrap items-center justify-between gap-2 rounded-[20px] bg-rally-warn-container px-3.5 py-2 text-xs font-semibold text-rally-on-warn-container"><span className="flex items-center gap-1.5"><Shield size={13} className="shrink-0" />{task} · {gate.id} 请求不可逆操作</span><span className="font-mono text-[11px] tabular-nums opacity-85">剩余 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></div>
		<div className="px-2.5 pb-2 pt-2.5">
			<div className="whitespace-pre-wrap break-words font-medium leading-snug">{gate.action}</div>
			<div className="mt-1 break-all font-mono text-[11.5px] text-muted">{gate.tool} · {gate.cwd}</div>
			<div className="mt-2 whitespace-pre-wrap break-words rounded-[16px] bg-md-surface-lowest/75 px-3 py-2 text-xs leading-relaxed text-muted">影响范围：{gate.scope.join("\n")}<br />可替代做法：{gate.alternative}</div>
			{uncommitted.length > 0 && <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[14px] bg-md-surface-lowest/60 px-3 py-2 text-xs text-muted">未提交改动：{uncommitted.join("\n")}</div>}
			{outsideCwd.length > 0 && <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[14px] bg-md-surface-lowest/60 px-3 py-2 text-xs text-muted">cwd 外目标：{outsideCwd.join("\n")}</div>}
			{mailBody !== null && <div className="mt-2.5 text-xs text-muted"><span className="font-medium">邮件正文</span><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-md-surface-lowest/80 p-2.5 font-sans text-fg">{mailBody}</pre></div>}
			<Disclosure className="mt-2 text-xs text-muted"><summary className="cursor-pointer">原始参数</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(gate.arguments, null, 2)}</pre></Disclosure>
			<div className="mt-3 flex justify-end gap-2"><Button size="sm" className="bg-md-surface-lowest/85 text-fg" disabled={busy || seconds === 0} onClick={() => void submit("deny")}>拒绝</Button><Button size="sm" variant="primary" disabled={busy || seconds === 0} onClick={() => void submit("allow")}>{mailBody !== null ? "确认发送" : "允许"}</Button></div>
			{error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
		</div>
	</motion.div>;
}
