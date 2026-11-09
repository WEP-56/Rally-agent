import { CheckCircle2, CircleDashed, Loader2, AlertCircle } from "lucide-react";
import type { TaskStatus } from "../data";
import { cn } from "../utils/cn";

export const STATUS_META: Record<TaskStatus, { label: string; cls: string; dot: string }> = {
  running: { label: "进行中", cls: "bg-accent-soft text-accent", dot: "bg-accent" },
  done: { label: "已完成", cls: "bg-sunken text-muted", dot: "bg-faint" },
  failed: { label: "失败", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  cancelled: { label: "已取消", cls: "bg-sunken text-faint", dot: "bg-press" },
  dropped: { label: "无需处理", cls: "bg-sunken text-faint", dot: "bg-press" },
  pending_approval: { label: "待批准", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  needs_answer: { label: "待回答", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  needs_gate: { label: "待确认", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  blocked: { label: "受阻", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  interrupted: { label: "已中断", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
  queued: { label: "排队中", cls: "bg-sunken text-faint", dot: "bg-press" },
};

export function StatusIcon({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  if (status === "running") return <Loader2 size={size} className="animate-spin text-accent" />;
  if (status === "done") return <CheckCircle2 size={size} className="text-faint" />;
  if (status === "failed") return <AlertCircle size={size} className="text-amber-500" />;
  return <CircleDashed size={size} className="text-faint" />;
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const m = STATUS_META[status];
  return <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", m.cls, className)}>{m.label}</span>;
}

export function timeAgo(t: number) {
  const d = Math.max(0, Date.now() - t);
  const m = Math.floor(d / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function clock(t: number) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
