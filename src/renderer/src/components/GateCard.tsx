import { useEffect, useState } from "react";
import type { TaskGate } from "../../../shared/gate";

export function GateCard({ taskId, gate, decide }: { taskId: string; gate: TaskGate; decide(value: "allow" | "deny"): Promise<unknown> }) {
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
	async function submit(value: "allow" | "deny") {
		setBusy(true); setError("");
		try { await decide(value); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
	}
	if (gate.decision) return <div id={`gate-${gate.id}`} tabIndex={-1} className="rounded-xl bg-sunken px-3.5 py-2 text-xs text-muted">{taskId} · {gate.id} · 已{gate.decision.value === "allow" ? "允许" : "拒绝"}（{gate.decision.actor === "user" ? "你" : gate.decision.actor === "main" ? "主 agent" : "系统"}{gate.decision.basis.length ? `，依据 ${gate.decision.basis.join("、")}` : ""}） · {gate.decision.reason}</div>;
	return <div id={`gate-${gate.id}`} tabIndex={-1} className="rounded-xl bg-sunken px-3.5 py-3 text-sm">
		<div className="flex flex-wrap items-center justify-between gap-2 font-medium"><span>{taskId} · {gate.id} 请求不可逆操作</span><span className="text-xs tabular-nums text-muted">剩余 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span></div>
		<div className="mt-2 whitespace-pre-wrap break-words">{gate.action}</div>
		<div className="mt-1 break-all font-mono text-xs text-muted">{gate.tool} · {gate.cwd}</div>
		<div className="mt-2 whitespace-pre-wrap break-words text-xs text-muted">影响范围：{gate.scope.join("\n")}<br />可替代做法：{gate.alternative}</div>
		{uncommitted.length > 0 && <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">未提交改动：{uncommitted.join("\n")}</div>}
		{outsideCwd.length > 0 && <div className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">cwd 外目标：{outsideCwd.join("\n")}</div>}
		<details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">原始参数</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(gate.arguments, null, 2)}</pre></details>
		<div className="mt-3 flex justify-end gap-2"><button disabled={busy || seconds === 0} onClick={() => void submit("deny")} className="h-7 rounded-md bg-raised px-3 text-xs text-muted disabled:opacity-40">拒绝</button><button disabled={busy || seconds === 0} onClick={() => void submit("allow")} className="h-7 rounded-md bg-accent px-3 text-xs text-accent-fg disabled:opacity-40">允许</button></div>
		{error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
	</div>;
}
