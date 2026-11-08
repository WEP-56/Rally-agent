import { useMemo, useRef, useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Brain, Cpu, Workflow, ChevronRight, Sparkles } from "lucide-react";
import type { Task, TaskStatus } from "../data";
import { modelLabel, useApp } from "../store";
import { cn } from "../utils/cn";
import { RallyLogo, Segmented } from "./ui";
import { StatusIcon, StatusBadge, timeAgo, clock } from "./status";

function BusinessCard({ tasks }: { tasks: Task[] }) {
  const { config } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, mx: 50, my: 50, on: false });

  return (
    <div className="flex justify-center py-2" style={{ perspective: 900 }}>
      <div
        ref={ref}
        onMouseMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          setTilt({ x: (0.5 - py) * 9, y: (px - 0.5) * 12, mx: px * 100, my: py * 100, on: true });
        }}
        onMouseLeave={() => setTilt({ x: 0, y: 0, mx: 50, my: 50, on: false })}
        className="card-paper relative aspect-[1.72] w-full max-w-[440px] overflow-hidden rounded-2xl bg-raised"
        style={{
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: tilt.on ? "transform 0.05s" : "transform 0.5s cubic-bezier(.2,.8,.2,1)",
          boxShadow: "0 1px 1px rgba(0,0,0,.05), 0 6px 14px -4px rgba(0,0,0,.12), 0 22px 40px -18px rgba(0,0,0,.28)",
        }}
      >
        {/* accent band */}
        <div className="absolute inset-y-0 left-0 w-2" style={{ background: "linear-gradient(to bottom, var(--c-accent), color-mix(in srgb, var(--c-accent) 55%, black))" }} />
        {/* sheen */}
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{ opacity: tilt.on ? 1 : 0, background: `radial-gradient(circle at ${tilt.mx}% ${tilt.my}%, rgba(255,255,255,.35), transparent 45%)`, mixBlendMode: "soft-light" }}
        />
        {/* watermark */}
        <div className="pointer-events-none absolute -bottom-10 -right-6 select-none text-[150px] font-black leading-none tracking-tighter text-fg/[0.035]">R</div>

        <div className="relative flex h-full flex-col pl-8 pr-6 pt-5 pb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RallyLogo size={22} />
              <span className="text-[10px] font-semibold tracking-[0.28em] text-muted">RALLY · AGENT</span>
            </div>
            <span className="font-mono text-[10px] tracking-wider text-faint">No. RLY-0001</span>
          </div>

          <div className="mt-auto">
            <div className="text-[28px] font-semibold leading-none tracking-tight">{config.name || "Rally"}</div>
            <div className="mt-1.5 text-xs text-muted">首席执行代理 · Chief Agent</div>
            <div className="mt-2 line-clamp-1 text-[11px] italic text-faint">“{config.personality}”</div>
          </div>

          <div className="mt-auto flex items-end justify-between gap-4 pt-3">
            <div className="min-w-0 space-y-1 text-[10.5px] text-muted">
              <div className="flex items-center gap-1.5"><Brain size={11} className="shrink-0 text-faint" /><span className="truncate font-mono">{config.memoryPath}</span></div>
              <div className="flex items-center gap-1.5"><Cpu size={11} className="shrink-0 text-faint" /><span className="truncate">{modelLabel(config.rallyModel, "gpt-5")} · 工位 {modelLabel(config.taskModel, "gpt-5-mini")}</span></div>
              <div className="flex items-center gap-1.5"><Workflow size={11} className="shrink-0 text-faint" /><span className="truncate">{config.workstyle}</span></div>
            </div>
            {/* seal */}
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-accent" style={{ background: "radial-gradient(circle, var(--c-accent-soft) 55%, transparent 56%)" }}>
              <svg viewBox="0 0 100 100" className="absolute inset-0 animate-[spin_30s_linear_infinite]">
                <defs>
                  <path id="circ" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" />
                </defs>
                <text fontSize="10.5" fill="currentColor" letterSpacing="2.4" opacity=".75">
                  <textPath href="#circ">ON DUTY · {tasks.length} TASKS · ON DUTY ·</textPath>
                </text>
              </svg>
              <Sparkles size={16} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FILTERS: { v: "all" | TaskStatus; l: string }[] = [
  { v: "all", l: "全部" },
  { v: "running", l: "进行中" },
  { v: "queued", l: "排队" },
  { v: "failed", l: "需处理" },
  { v: "done", l: "已完成" },
];

export function Workstation({ tasks }: { tasks: Task[] }) {
  const { openTask } = useApp();
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");

  const list = useMemo(() => {
    const l = tasks.filter((t) => filter === "all" || t.status === filter);
    return [...l].sort((a, b) => (order === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [tasks, order, filter]);

  const stat = (s: TaskStatus) => tasks.filter((t) => t.status === s).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[640px] px-5 pb-8 pt-5">
        <BusinessCard tasks={tasks} />

        <div className="mt-5 grid grid-cols-4 gap-2">
          {[
            { k: "今日任务", v: tasks.length },
            { k: "进行中", v: stat("running") },
            { k: "需处理", v: stat("failed") },
            { k: "已完成", v: stat("done") },
          ].map((s) => (
            <div key={s.k} className="rounded-xl bg-sunken px-3 py-2.5">
              <div className="text-lg font-semibold tabular-nums leading-tight">{s.v}</div>
              <div className="text-[11px] text-faint">{s.k}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-sm font-semibold">
            任务 <span className="ml-1 font-normal text-faint">{list.length}</span>
          </div>
          <Segmented
            value={order}
            onChange={setOrder}
            options={[
              { value: "desc", label: <><ArrowDownWideNarrow size={12} />最新</> },
              { value: "asc", label: <><ArrowUpNarrowWide size={12} />最早</> },
            ]}
          />
        </div>

        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={cn("h-7 shrink-0 rounded-full px-3 text-xs transition-colors", filter === f.v ? "bg-fg text-panel" : "bg-sunken text-muted hover:text-fg")}
            >
              {f.l}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-1">
          {list.map((t) => (
            <button
              key={t.id}
              onClick={() => openTask(t.id)}
              className="group animate-fade flex items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-hover"
            >
              <div className="pt-0.5">
                <StatusIcon status={t.status} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{t.title}</span>
                  <StatusBadge status={t.status} className="shrink-0" />
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{t.summary}</div>
                {t.status === "running" && (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-sunken">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${t.progress}%` }} />
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                  <span className="font-mono">{t.id.toUpperCase()}</span>
                  <span>·</span>
                  <span>{t.duration}</span>
                  {t.tags.map((g) => (
                    <span key={g} className="rounded bg-sunken px-1.5 py-px">{g}</span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                <span className="text-xs tabular-nums text-muted">{clock(t.createdAt)}</span>
                <span className="text-[11px] text-faint">{timeAgo(t.createdAt)}</span>
                <ChevronRight size={14} className="mt-1 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </button>
          ))}
          {list.length === 0 && <div className="py-10 text-center text-sm text-faint">没有符合条件的任务</div>}
        </div>
      </div>
    </div>
  );
}
