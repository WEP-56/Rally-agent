import { useEffect, useState } from "react";
import { FolderInput, RefreshCw, Search, Wand2 } from "lucide-react";
import type { SkillsState } from "../../../shared/skills";
import { Button, Input, Toggle } from "./ui";
import { cn } from "../utils/cn";

export function SkillsSection() {
	const [state, setState] = useState<SkillsState | null>(null);
	const [query, setQuery] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(true);
	useEffect(() => {
		let mounted = true;
		void window.rally.skills.getState().then((next) => { if (mounted) setState(next); })
			.catch((reason: unknown) => { if (mounted) setError(String(reason)); })
			.finally(() => { if (mounted) setBusy(false); });
		return () => { mounted = false; };
	}, []);
	async function change(action: () => Promise<SkillsState | null>) {
		setBusy(true); setError("");
		try { const next = await action(); if (next) setState(next); }
		catch (reason) { setError(String(reason)); }
		finally { setBusy(false); }
	}
	const list = state?.skills.filter((skill) => `${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(query.toLowerCase())) ?? [];
	return <>
		<div className="mb-4 flex items-center gap-2">
			<div className="relative min-w-0 flex-1">
				<Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
				<Input className="pl-8" placeholder="搜索 skills" value={query} onChange={(event) => setQuery(event.target.value)} />
			</div>
			<Button disabled={busy} onClick={() => void change(() => window.rally.skills.getState())}><RefreshCw size={14} />刷新</Button>
			<Button disabled={busy} onClick={() => void change(async () => {
				const path = await window.rally.workspace.pickDirectory();
				return path ? window.rally.skills.importDirectory(path) : null;
			})}><FolderInput size={14} />从文件夹导入</Button>
		</div>
		<p className="mb-4 text-xs leading-relaxed text-faint">列出全局、默认工作区和最近任务项目的可用 skills；项目 skill 需先在“项目信任”中授权。导入保留原文件位置，修改对之后启动或续接的 worker 生效。</p>
		{error && <p role="alert" className="mb-4 break-words text-xs text-red-500">{error}</p>}
		{!state && !error && <p className="text-xs text-faint">正在读取 skills…</p>}
		{state && !list.length && <p className="text-xs text-faint">{query ? "没有匹配的 skills" : "尚未发现 skills，可从本地目录导入。"}</p>}
		<fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
			{list.map((skill) => <div key={skill.path} className="flex items-start gap-3 rounded-2xl bg-sunken p-4 transition-shadow hover:shadow-soft">
				<div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", skill.enabled ? "bg-accent-soft text-accent" : "bg-panel text-faint dark:bg-raised")}><Wand2 size={16} /></div>
				<div className="min-w-0 flex-1">
					<div className="truncate font-mono text-[13px] font-medium" title={skill.name}>{skill.name}</div>
					<div className="mt-1 text-xs text-muted">{skill.description}</div>
					<div className="mt-2 break-all font-mono text-[10px] text-faint">{skill.path}</div>
				</div>
				<Toggle checked={skill.enabled} onChange={(enabled) => void change(() => window.rally.skills.setEnabled(skill.path, enabled))} />
			</div>)}
		</fieldset>
		{state?.diagnostics.length ? <details className="mt-4 text-xs text-muted"><summary>加载提示（{state.diagnostics.length}）</summary>{state.diagnostics.map((item) => <p key={item} className="mt-2 break-all">{item}</p>)}</details> : null}
	</>;
}
