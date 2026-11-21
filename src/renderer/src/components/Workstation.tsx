import { AgentAvatar } from "./AgentAvatar";
import { Critter, OrbitRing, Spark } from "./brand";
import { Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import type { Task, TaskStatus } from "../data";
import { useApp } from "../store";
import { useModels } from "../models";
import { cn } from "../utils/cn";
import { clock, StatusBadge, STATUS_META, timeAgo } from "./status";
import { Segmented } from "./ui";
import { LocalServices } from "./LocalServices";
import { ArchiveTaskButton } from "./ArchiveTaskButton";
import { SchedulesSection } from "./SchedulesSection";
import { ScheduledWorkerBadge } from "./ScheduledWorkerBadge";

function BusinessCard() {
 const { config, openSettings } = useApp(); const { state: models } = useModels();
 const modelName = (role: "active" | "worker") => models?.available.find(m => m.provider === models[role]?.provider && m.id === models[role]?.model)?.name ?? "未选择";
 return <div className="flex flex-col items-center pt-1 text-center">
  <div className="relative flex h-[132px] w-full items-center justify-center"><OrbitRing size={330} /><div className="animate-float relative"><AgentAvatar size={100} glow className="rounded-[26px]" /><button title="编辑身份" onClick={() => openSettings("general")} className="glass-strong absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full text-fg/70 hover:text-fg"><Pencil size={12} /></button></div></div>
  <h1 className="font-display mt-1 text-[36px] font-semibold leading-none tracking-tight">{config.name}</h1>
  <p className="mt-2.5 text-[13px] text-fg/55">你的个人助手 · 本地运行</p>
  <div className="mt-4 flex max-w-full flex-wrap justify-center gap-1.5">{[["主", modelName("active")], ["任务", modelName("worker")], ["记忆", config.memoryPath]].map(([k,v]) => <span key={k} title={v} className="glass flex h-7 max-w-[280px] items-center gap-2 rounded-full px-3 text-[11.5px] text-fg/70"><span className="shrink-0 text-[10px] font-semibold text-faint">{k}</span><span className="truncate">{v}</span></span>)}</div>
  <p className="mt-4 max-w-[380px] text-[13px] italic leading-relaxed text-fg/55">“{config.personality}”</p>
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
	const { openTask, openTab } = useApp();
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [filter, setFilter] = useState<Filter>("all");

  const list = useMemo(() => {
    const l = tasks.filter((t) => t.archivedAt === undefined && (filter === "all" || (filter === "scheduled" ? Boolean(t.schedule) : filter === "attention" ? NEEDS_ATTENTION.includes(t.status) : t.status === filter)));
    return [...l].sort((a, b) => (order === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [tasks, order, filter]);

  const visible = tasks.filter(t => t.archivedAt === undefined);
  const stat = (s: TaskStatus) => visible.filter((t) => t.status === s).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[620px] px-5 pb-24 pt-2">
        <BusinessCard /><div className="glass mt-6 flex items-center gap-3 rounded-[22px] p-3.5 pl-4"><Spark size={17} className="shrink-0 text-accent" /><p className="min-w-0 flex-1 text-[13.5px] leading-relaxed">现在 {stat("running")} 件事在跑，{visible.filter(t => NEEDS_ATTENTION.includes(t.status)).length} 件等你处理。</p>{visible.some(t => NEEDS_ATTENTION.includes(t.status)) && <button onClick={() => setFilter("attention")} className="shrink-0 rounded-full bg-ink px-4 py-2 text-xs font-medium text-white dark:bg-white dark:text-ink">去处理</button>}</div>


        <div className="mt-3 grid grid-cols-3 gap-3">
          {[

            { k: "进行中", v: stat("running"), filter: "running" as const },
            { k: "需处理", v: visible.filter((task) => NEEDS_ATTENTION.includes(task.status)).length, filter: "attention" as const },
            { k: "已完成", v: stat("done"), filter: "done" as const },
          ].map((s) => (
            <button key={s.k} onClick={() => setFilter(s.filter)} className={cn("glass rounded-[20px] px-4 py-3 text-left transition-transform hover:-translate-y-px", filter === s.filter && "ring-2 ring-accent/40")}>
              <div className="font-display text-[30px] font-semibold tabular-nums leading-none">{s.v}</div>
              <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted"><span className={cn("h-1.5 w-1.5 rounded-full", s.k === "进行中" ? "bg-accent" : s.k === "需处理" ? "bg-warn" : "bg-ok")} />{s.k}</div>
            </button>
          ))}
        </div>

        <div className="mt-3"><LocalServices onOpen={url => openTab("browser", { url })} /></div>
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

        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.v}
              aria-pressed={filter === f.v}
              onClick={() => setFilter(f.v)}
              className={cn("h-8 shrink-0 rounded-full px-3.5 text-[12.5px] transition-colors", filter === f.v ? "bg-ink text-white shadow-soft dark:bg-white dark:text-ink" : "glass text-muted hover:text-fg")}
            >
              {f.l}
            </button>
          ))}
        </div>

        {filter === "scheduled" && <div className="mt-5"><SchedulesSection /><h2 className="mt-6 text-[13px] font-medium text-muted">执行记录 · {list.length}</h2></div>}
        <div className="mt-3 flex flex-col gap-2.5">
          {list.map((t) => (
            <div key={t.id} className="group glass animate-fade overflow-hidden rounded-[22px] transition-all hover:-translate-y-px hover:shadow-float">
              <button type="button" onClick={() => openTask(t.id)} className="flex w-full items-start gap-3.5 p-3.5 text-left">
                <div className="relative shrink-0 pt-0.5">
                  <Critter seed={t.id} size={48} />
                  <span className={cn("absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-panel", STATUS_META[t.status].dot)} />
                </div>
                <div className="min-w-0 flex-1">
                  {t.schedule && <div className="mb-1.5"><ScheduledWorkerBadge /></div>}
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-medium">{t.title}</span>
                    <StatusBadge status={t.status} className="ml-auto shrink-0" />
                  </div>
                  <div className={cn("mt-1 line-clamp-2 text-[12.5px] leading-relaxed", NEEDS_ATTENTION.includes(t.status) ? "text-warn" : "text-muted")}>{t.summary}</div>
                  {t.lastExternalAction && <div className="mt-1 break-all rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">有对外代价的调用 · {t.lastExternalAction.tool} · {clock(t.lastExternalAction.at)}</div>}
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
              </button>
              {t.ended && <div className="flex justify-end px-2 pb-1"><ArchiveTaskButton task={t} /></div>}
            </div>
          ))}
          {list.length === 0 && <div className="py-10 text-center text-sm text-faint">没有符合条件的任务</div>}
        </div>
      </div>
    </div>
  );
}
