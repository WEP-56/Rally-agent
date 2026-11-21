import { useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import type { Task } from "../data";
import { useApp } from "../store";
import { ArchiveTaskButton } from "./ArchiveTaskButton";
import { ScheduledWorkerBadge } from "./ScheduledWorkerBadge";
import { StatusBadge } from "./status";
import { Button } from "./ui";

export function ArchivedTasksSection({ tasks }: { tasks: Task[] }) {
	const { openTask } = useApp();
	const [confirm, setConfirm] = useState<string>();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const archived = tasks.filter(task => task.archivedAt !== undefined).sort((a, b) => b.archivedAt! - a.archivedAt!);
	async function remove(id: string) {
		setBusy(true); setError("");
		try { await window.rally.tasks.deleteArchived(id); setConfirm(undefined); }
		catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
		finally { setBusy(false); }
	}
	return <div className="space-y-3">
		{error && <p role="alert" className="text-sm text-danger">{error}</p>}
		{!archived.length && <div className="glass flex flex-col items-center gap-3 rounded-[24px] px-5 py-12 text-sm text-muted"><Archive size={24} className="text-faint" />还没有归档任务</div>}
		{archived.map(task => <div key={task.id} className="glass rounded-[24px] p-4">
			<button className="w-full text-left" onClick={() => openTask(task.id)}>
				<div className="flex items-start gap-2"><span className="min-w-0 flex-1 break-words text-[14px] font-medium">{task.title}</span><StatusBadge status={task.status} /></div>
				<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-faint"><span className="font-mono">{task.id}</span>{task.schedule && <ScheduledWorkerBadge />}<span>归档于 {new Date(task.archivedAt!).toLocaleString()}</span></div>
			</button>
			{confirm === task.id ? <div className="mt-4 rounded-2xl bg-danger/[0.06] p-3" role="alert">
				<p className="text-sm font-medium">彻底删除“{task.title}”？</p>
				<p className="mt-1 text-xs leading-relaxed text-muted">此操作无法撤销，会删除任务记录、独立会话及作业/服务日志，并停止该任务的服务。项目文件与产出、主对话及共享历史日志保留。{task.schedule && "定时计划仍会继续执行。"}</p>
				<div className="mt-3 flex justify-end gap-2"><Button size="sm" disabled={busy} onClick={() => setConfirm(undefined)}>保留任务</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(task.id)}>{busy ? "删除中…" : "确认彻底删除"}</Button></div>
			</div> : <div className="mt-3 flex justify-end gap-2"><ArchiveTaskButton task={task} /><Button size="sm" variant="danger" disabled={busy} onClick={() => { setError(""); setConfirm(task.id); }}><Trash2 size={12} />彻底删除</Button></div>}
		</div>)}
	</div>;
}
