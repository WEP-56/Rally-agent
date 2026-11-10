import { useEffect, useState } from "react";
import { FolderInput, ShieldCheck } from "lucide-react";
import type { ProjectTrustState } from "../../../shared/trust";
import { Button } from "./ui";

export function ProjectTrustSection() {
	const [state, setState] = useState<ProjectTrustState | null>(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(true);
	useEffect(() => {
		let mounted = true;
		void window.rally.trust.getState().then((next) => { if (mounted) setState(next); })
			.catch((reason: unknown) => { if (mounted) setError(String(reason)); })
			.finally(() => { if (mounted) setBusy(false); });
		return () => { mounted = false; };
	}, []);
	async function change(action: () => Promise<ProjectTrustState | null>) {
		setBusy(true); setError("");
		try { const next = await action(); if (next) setState(next); }
		catch (reason) { setError(String(reason)); }
		finally { setBusy(false); }
	}
	return <>
		<p className="mb-4 text-xs leading-relaxed text-muted">信任后，新任务可以加载该目录下的项目设置、skills 和 MCP 配置。子目录继承最近一层的信任决定；撤销对之后启动或续接的任务生效。项目扩展暂未接入。</p>
		<Button disabled={busy} onClick={() => void change(async () => {
			const path = await window.rally.workspace.pickDirectory();
			return path ? window.rally.trust.set(path, true) : null;
		})}><FolderInput size={14} />选择并信任项目</Button>
		{error && <p role="alert" className="mt-4 break-words text-xs text-red-500">{error}</p>}
		<div className="mt-5 flex flex-col gap-2">
			{state?.projects.map((entry) => <div key={entry.path} className="flex items-center gap-3 rounded-2xl bg-sunken p-4">
				<ShieldCheck size={18} className={entry.decision ? "shrink-0 text-accent" : "shrink-0 text-faint"} />
				<div className="min-w-0 flex-1">
					<div className="break-all font-mono text-xs">{entry.path}</div>
					<div className="mt-1 text-xs text-faint">{entry.decision === true ? "已信任" : entry.decision === false ? "不信任" : "尚未信任"}{entry.inheritedFrom && ` · 继承自 ${entry.inheritedFrom}`}</div>
				</div>
				<Button size="sm" disabled={busy} onClick={() => void change(() => window.rally.trust.set(entry.path, entry.decision !== true))}>{entry.decision ? "撤销信任" : "信任此目录"}</Button>
			</div>)}
		</div>
		{!state && !error && <p className="mt-4 text-xs text-faint">正在读取信任设置…</p>}
	</>;
}
