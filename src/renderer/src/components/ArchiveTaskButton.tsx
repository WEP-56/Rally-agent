import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import type { Task } from "../data";

export function ArchiveTaskButton({ task }: { task: Task }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	if (!task.ended) return null;
	const archived = task.archivedAt !== undefined;
	return <div className="shrink-0">
		<button disabled={busy} onClick={async () => {
			setBusy(true); setError("");
			try { await window.rally.tasks.archive(task.id, !archived); }
			catch (error) { setError(error instanceof Error ? error.message : String(error)); }
			finally { setBusy(false); }
		}} className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-fg disabled:opacity-40">
			{archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{archived ? "取消归档" : "归档"}
		</button>
		{error && <p role="alert" className="max-w-48 break-words text-xs text-red-500">{error}</p>}
	</div>;
}
