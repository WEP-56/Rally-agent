import { useEffect, useState } from "react";
import type { ScheduledTask, ScheduleTiming } from "../../../shared/schedules";
import { Button, Toggle } from "./ui";
import { useApp } from "../store";

function daysLabel(weekdays?: number[]): string {
	if (!weekdays || weekdays.length === 7) return "每天";
	const names = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
	return weekdays.map(day => names[day]).join("、");
}

function timingLabel(timing: ScheduleTiming): string {
	if (timing.kind === "once") return "单次";
	if (timing.kind === "daily") return `${daysLabel(timing.weekdays)} ${timing.time} · ${timing.timezone}`;
	const interval = timing.minutes % 60 === 0 ? `每 ${timing.minutes / 60} 小时` : `每 ${timing.minutes} 分钟`;
	if (!timing.window) return interval;
	const { start, end, timezone, weekdays } = timing.window;
	return `${daysLabel(weekdays)} ${start}–${end}${end < start ? "（次日）" : ""}，${interval} · ${timezone}`;
}

function nextTime(item: ScheduledTask): string {
	const timezone = item.timing.kind === "daily" ? item.timing.timezone : item.timing.kind === "interval" ? item.timing.window?.timezone : undefined;
	return new Date(item.nextAt).toLocaleString("zh-CN", { timeZone: timezone, hour12: false });
}

export function SchedulesSection() {
	const [items, setItems] = useState<ScheduledTask[]>([]);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const { openTask } = useApp();
	useEffect(() => {
		let alive = true;
		const refresh = () => void window.rally.schedules.getState().then(value => { if (alive) setItems(value); }).catch(reason => { if (alive) setError(String(reason)); });
		refresh(); const timer = setInterval(refresh, 5000);
		return () => { alive = false; clearInterval(timer); };
	}, []);
	const update = async (id: string, enabled: boolean | null) => {
		setBusy(true); setError("");
		try { setItems(await window.rally.schedules.update(id, enabled)); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
	};
	return <div className="space-y-3">
		<div className="px-1"><h2 className="text-[14px] font-medium">定时计划</h2><p className="mt-1 text-xs leading-relaxed text-muted">在主对话中创建或修改时间：支持单次、间隔、每日和指定星期，可限定运行时段或跨午夜时段。</p><p className="mt-1 text-[11px] leading-relaxed text-faint">仅在 Rally 运行时执行；漏跑在允许时段内合并一次，同一计划上一轮未结束时等待。时段限制新一轮启动，已开始的任务正常收尾。暂停或删除计划不终止已派发的 worker。</p></div>
		{error && <p role="alert" className="text-sm text-danger">{error}</p>}
		{items.length === 0 && <p className="glass rounded-[22px] p-5 text-center text-sm text-muted">还没有定时计划，在主对话中创建即可</p>}
		{items.map(item => <div key={item.id} className="glass rounded-[22px] p-5">
			<div className="flex items-center justify-between gap-3"><h2 className="font-medium">{item.title}</h2><Toggle label={`${item.title}启用`} checked={item.enabled} disabled={busy} onChange={enabled => void update(item.id, enabled)} /></div>
			<p className="mt-2 text-sm text-muted">{timingLabel(item.timing)} · {item.enabled ? `下次计划 ${nextTime(item)}` : "已停用"}</p>
			{item.waitingFor && <p className="mt-1 text-xs leading-relaxed text-muted">最近任务：{item.waitingFor.statusText}。{item.waitingFor.status === "interrupted" ? "打开最近任务，继续或取消后才能安排下一轮。" : item.enabled ? "上一轮结束后才会派发下一轮。" : "可打开最近任务查看或处理。"}</p>}
			<p className="mt-1 break-all text-xs text-muted">{item.mode === "write" ? "改写" : "只读"} · {item.cwd}</p>
			{item.error && <p role="alert" className="mt-2 text-sm text-danger">{item.error}</p>}
			<div className="mt-3 flex items-center gap-2">{item.lastTaskDeleted ? <span className="text-xs text-faint">最近一次执行记录已删除</span> : item.lastTaskId && <Button size="sm" onClick={() => openTask(item.lastTaskId!)}>查看最近任务</Button>}<Button size="sm" variant="danger" disabled={busy} onClick={() => void update(item.id, null)}>删除计划</Button></div>
		</div>)}
	</div>;
}
