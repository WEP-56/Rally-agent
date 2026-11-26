import { CheckCircle2, CircleDashed, Loader2, AlertCircle } from "lucide-react";
import type { TaskStatus } from "../data";
import { cn } from "../utils/cn";

export const STATUS_META: Record<TaskStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  running: { label: "进行中", cls: "bg-md-primary-container text-md-on-primary-container", dot: "bg-md-primary", pulse: true },
  done: { label: "已完成", cls: "bg-rally-ok-container text-rally-on-ok-container", dot: "bg-rally-ok" },
  failed: { label: "失败", cls: "bg-md-error-container text-md-on-error-container", dot: "bg-md-error" },
  cancelled: { label: "已取消", cls: "bg-md-surface-highest text-md-on-surface-variant", dot: "bg-md-outline" },
  dropped: { label: "无需处理", cls: "bg-md-surface-highest text-md-on-surface-variant", dot: "bg-md-outline" },
  pending_approval: { label: "待批准", cls: "bg-md-tertiary-container text-md-on-tertiary-container", dot: "bg-md-tertiary", pulse: true },
  needs_answer: { label: "待回答", cls: "bg-md-tertiary-container text-md-on-tertiary-container", dot: "bg-md-tertiary", pulse: true },
  needs_gate: { label: "待确认", cls: "bg-md-tertiary-container text-md-on-tertiary-container", dot: "bg-md-tertiary", pulse: true },
  blocked: { label: "受阻", cls: "bg-rally-warn-container text-rally-on-warn-container", dot: "bg-rally-warn" },
  interrupted: { label: "已中断", cls: "bg-rally-warn-container text-rally-on-warn-container", dot: "bg-rally-warn" },
  queued: { label: "排队中", cls: "bg-md-surface-highest text-md-on-surface-variant", dot: "bg-md-outline" },
};

export function StatusIcon({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  if (status === "running") return <Loader2 size={size} className="animate-spin text-md-primary" />;
  if (status === "done") return <CheckCircle2 size={size} className="text-rally-ok" />;
  if (status === "failed") return <AlertCircle size={size} className="text-md-error" />;
  return <CircleDashed size={size} className="text-faint" />;
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex h-[21px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold tracking-[0.01em]", m.cls, className)}>
      <span className="relative flex h-1.5 w-1.5 items-center justify-center">
        {m.pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-65", m.dot)} />}
        <span className={cn("relative h-1.5 w-1.5 rounded-full", m.dot)} />
      </span>
      {m.label}
    </span>
  );
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
