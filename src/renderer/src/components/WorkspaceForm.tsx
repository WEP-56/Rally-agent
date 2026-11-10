import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useWorkspace } from "../workspace";
import { Button, IconButton, Input } from "./ui";
import type { WorkspacePatch } from "../../../shared/workspace";

export function WorkspaceForm() {
	const { state, error: loadError } = useWorkspace();
	const [workspace, setWorkspace] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => { if (state) setWorkspace(state.defaultWorkspace); }, [state?.defaultWorkspace]);
	async function save(patch: WorkspacePatch) {
		setBusy(true); setError("");
		try { await window.rally.workspace.update(patch); } catch (error) { setError(String(error)); } finally { setBusy(false); }
	}
	async function browse() {
		setError("");
		try {
			const path = await window.rally.workspace.pickDirectory();
			if (path) await save({ defaultWorkspace: path });
		} catch (error) { setError(String(error)); }
	}
	return <div className="flex flex-col gap-6">
		{(error || loadError) && <p role="alert" className="break-words text-xs text-red-500">{error || loadError}</p>}
		<div>
			<label htmlFor="default-workspace" className="mb-2 block text-[13px] font-medium">主对话默认工作区</label>
			<div className="flex gap-2">
				<Input id="default-workspace" className="min-w-0 flex-1 font-mono text-xs" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
				<IconButton title="选择默认工作区" aria-label="选择默认工作区" disabled={busy || !state} onClick={() => void browse()}><FolderOpen size={15} /></IconButton>
				<Button size="sm" disabled={busy || !state || !workspace.trim()} onClick={() => void save({ defaultWorkspace: workspace })}>保存</Button>
			</div>
			<p className="mt-2 text-xs leading-relaxed text-faint">主对话中的相对文件路径从这里解析。每个 worker 的工作目录由 router 根据任务明确指定，最近项目不会改变此设置。</p>
		</div>
		<div>
			<div className="mb-2 text-xs font-medium text-faint">最近项目</div>
			<ul className="flex flex-col gap-1" aria-label="最近项目">
				{state?.recentProjects.map((path) => <li key={path} title={path} className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs"><FolderOpen size={14} className="shrink-0 text-faint" /><span className="min-w-0 flex-1 break-all font-mono">{path}</span></li>)}
			</ul>
			{state?.recentProjects.length === 0 && <p className="text-xs text-faint">暂无任务项目记录</p>}
		</div>
	</div>;
}
