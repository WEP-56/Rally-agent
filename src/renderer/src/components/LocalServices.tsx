import { Square } from "lucide-react";
import { useServices } from "../services";
import { cn } from "../utils/cn";

export function LocalServices({ onOpen }: { onOpen(url: string): void }) {
	const { services, error, stopping, stop } = useServices();
	const running = services.filter(service => service.status === "running");
	const recent = services.filter(service => service.status !== "running").slice(0, 5);
	return <div>
		<div className="text-xs font-medium text-faint">本地服务 <span className="ml-1 tabular-nums">{running.length}</span></div>
		{error && <div role="alert" className="mt-2 text-xs text-danger">{error}</div>}
		<div className="mt-2 flex flex-col gap-1.5">
			{[...running, ...recent].map(service => <div key={service.id} className="flex items-center gap-3 glass rounded-[20px] px-3.5 py-3">
				<span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", service.status === "running" ? "bg-ok" : "bg-press")} />
				<div className="min-w-0 flex-1" title={`${service.command}\n${service.cwd}${service.error ? `\n${service.error}` : ""}`}>
					<div className="truncate font-mono text-[12.5px] font-medium">{service.url ?? service.name}</div>
					<div className="truncate text-[11px] text-muted">{service.name} · 来自 {service.taskId} · {service.status === "running" ? service.ready ? "已就绪" : "运行中 · 等待就绪" : service.status === "stopped" ? "已停止" : `已退出${service.exitCode !== undefined ? ` · ${service.exitCode}` : ""}`}</div>
				</div>
				{window.runtime.mode!=="cloud" && service.status === "running" && service.url && <button title="预览服务" aria-label={`预览 ${service.name}`} onClick={() => onOpen(service.url!)} className="h-8 rounded-full bg-panel/90 px-3.5 text-xs shadow-soft hover:bg-panel">预览</button>}
				{service.status === "running" && <button title="停止服务" aria-label={`停止 ${service.name}`} disabled={stopping.includes(service.id)} onClick={() => void stop(service.id)} className="rounded-lg p-1.5 text-muted hover:bg-hover disabled:opacity-40"><Square size={13} /></button>}
			</div>)}
			{!services.length && <div className="glass rounded-[20px] px-3.5 py-4 text-xs text-faint">任务启动的本地服务会显示在这里</div>}
		</div>
	</div>;
}
