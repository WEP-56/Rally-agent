import { ActionButton } from "../md3/interactive";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_LAYOUT } from "../md3/springs";
import { HorizontalDragScroll, MdFilterChip, OrbitRingMd3, PlayfulPersonaCharm } from "../md3/components";
import { AgentAvatar } from "./AgentAvatar";
import { Critter } from "./brand";
import { Pencil } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Task, TaskStatus } from "../data";
import { useApp } from "../store";
import { cn } from "../utils/cn";
import { clock, StatusBadge, STATUS_META, timeAgo } from "./status";
import { Segmented } from "./ui";
import { ArchiveTaskButton } from "./ArchiveTaskButton";
import { canArchiveTask } from "../../../shared/task";
import { SchedulesSection } from "./SchedulesSection";
import { ScheduledWorkerBadge } from "./ScheduledWorkerBadge";

function BusinessCard({ busy }: { busy: boolean }) {
 const { config, openSettings } = useApp();
 return <div className="flex flex-col items-center pt-1 text-center">
  <div className="relative flex h-[132px] w-full items-center justify-center"><OrbitRingMd3 size={286} active={busy} /><div className="relative"><PlayfulPersonaCharm name={config.name} size={96} busy={busy}><AgentAvatar size={62} className="relative z-10 rounded-full pointer-events-none" /></PlayfulPersonaCharm><ActionButton title="编辑身份" onClick={() => openSettings("general")} className="glass-strong absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full text-fg/70 hover:text-fg"><Pencil size={12} /></ActionButton></div></div>
  <h1 className="font-display mt-1 text-[36px] font-semibold leading-none tracking-tight">{config.name}</h1>
 </div>;
}

type Filter = "all" | "scheduled" | "running" | "queued" | "attention" | "done";
const NEEDS_ATTENTION: TaskStatus[] = ["failed", "blocked", "interrupted", "needs_answer", "needs_gate", "pending_approval"];
const FILTERS: { v: Filter; l: string }[] = [
  { v: "all", l: "全部" },
  { v: "scheduled", l: "定时" },
  { v: "running", l: "进行中" },
  { v: "queued", l: "排队" },
  { v: "attention", l: "需处理" },
  { v: "done", l: "已完成" },
];

export function Workstation({ tasks }: { tasks: Task[] }) {
	const { openTask } = useApp();
  const filterId = useId();
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [filter, setFilter] = useState<Filter>("all");

  const list = useMemo(() => {
    const l = tasks.filter((t) => t.archivedAt === undefined && (filter === "all" || (filter === "scheduled" ? Boolean(t.schedule) : filter === "attention" ? NEEDS_ATTENTION.includes(t.status) : t.status === filter)));
    return [...l].sort((a, b) => (order === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [tasks, order, filter]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[620px] px-5 pb-24 pt-2">
        <BusinessCard busy={tasks.some(task => task.archivedAt === undefined && task.status === "running")} />
        <div className="mt-8 flex items-center justify-between">
          <div className="font-display text-[19px] font-semibold">
            任务 <span className="ml-1 font-normal text-faint">{list.length}</span>
          </div>
          <Segmented
            value={order}
            onChange={setOrder}
            options={[
              { value: "desc", label: "最新" },
              { value: "asc", label: "最早" },
            ]}
          />
        </div>

        <HorizontalDragScroll activeKey={filter} className="mt-3 gap-1.5 py-1">
          {FILTERS.map(f => <MdFilterChip key={f.v} groupId={filterId} selected={filter === f.v} label={f.l} onClick={() => setFilter(f.v)} count={tasks.filter(t => t.archivedAt === undefined && (f.v === "all" || (f.v === "scheduled" ? Boolean(t.schedule) : f.v === "attention" ? NEEDS_ATTENTION.includes(t.status) : t.status === f.v))).length} />)}
        </HorizontalDragScroll>

        {filter === "scheduled" && <div className="mt-5"><SchedulesSection /><h2 className="mt-6 text-[13px] font-medium text-muted">执行记录 · {list.length}</h2></div>}
        <div className="mt-3 flex flex-col gap-2.5">
          <AnimatePresence mode="popLayout" initial={false}>{list.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} whileHover={{ y: -2, borderRadius: 28 }} transition={SPRING_LAYOUT} className="group overflow-hidden rounded-[24px] bg-md-surface-lowest/92 dark:bg-md-surface-high/88">
              <ActionButton type="button" onClick={() => openTask(t.id)} className="flex w-full items-start gap-3.5 p-3.5 text-left">
                <div className="relative shrink-0 pt-0.5 transition-transform duration-200 group-hover:scale-105 group-hover:-rotate-2">
                  <Critter seed={t.id} size={48} />
                  <span className={cn("absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-md-surface-lowest dark:border-md-surface-high", STATUS_META[t.status].dot)} />
                </div>
                <div className="min-w-0 flex-1">
                  {t.schedule && <div className="mb-1.5"><ScheduledWorkerBadge /></div>}
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-medium">{t.title}</span>
                    <StatusBadge status={t.status} className="ml-auto shrink-0" />
                  </div>
                  <div className={cn("mt-1 line-clamp-2 text-[12.5px] leading-relaxed", NEEDS_ATTENTION.includes(t.status) ? "text-warn" : "text-muted")}>{t.summary}</div>
                  {t.lastExternalAction && <div className="mt-1.5 inline-flex max-w-full items-center break-all rounded-full bg-rally-warn-container px-2.5 py-0.5 text-[11px] font-medium text-rally-on-warn-container">有对外代价的调用 · {t.lastExternalAction.tool} · {clock(t.lastExternalAction.at)}</div>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                    <span className="font-mono">{t.id.toUpperCase()}</span>
                    <span>·</span>
                    <span>{t.duration}</span>
                    {t.tags.map((g) => (
                      <span key={g} className="rounded-full bg-fg/[0.06] px-2 py-px text-muted">{g}</span>
                    ))}
                    <span className="ml-auto tabular-nums">{clock(t.createdAt)} · {timeAgo(t.createdAt)}</span>
                  </div>
                </div>
              </ActionButton>
              {canArchiveTask(t.status) && <div className="flex justify-end px-2 pb-1.5"><ArchiveTaskButton task={t} /></div>}
            </motion.div>
          ))}</AnimatePresence>
          {list.length === 0 && <div className="py-10 text-center text-sm text-faint">没有符合条件的任务</div>}
        </div>
      </div>
    </div>
  );
}
