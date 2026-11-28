import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ArrowLeft, AtSign, Cable, Clock, IdCard, Lock, PanelRightClose, X } from "lucide-react";
import { CONNECTORS } from "../data";
import { Critter } from "../rally/critter";
import { SPRING_JELLY, SPRING_LAYOUT, SPRING_FAST } from "../components/ui";
import { cn } from "../utils/cn";
import { ACTIVITY_LABELS, MochiAvatar, NAME, Segmented, StatusBadge, TIER_LABEL, ToolRow, clockText, mascotFor, timeAgo } from "./parts";
import { useSim } from "./engine";
import type { SimTask, Tab, Tier } from "./types";

/* ───────────────────────── 标签条（对应 RightPanel 的 tab strip） ───────────────────────── */

function tabTitle(tab: Tab, tasks: SimTask[]) {
  if (tab.kind === "workstation") return "工位";
  if (tab.kind === "connections") return "连接";
  return tasks.find((task) => task.id === tab.taskId)?.title ?? "任务";
}

function TabIcon({ tab, tasks }: { tab: Tab; tasks: SimTask[] }) {
  if (tab.kind === "task") {
    const task = tasks.find((item) => item.id === tab.taskId);
    return task ? <Critter seed={task.id} size={18} /> : null;
  }
  if (tab.kind === "connections") return <Cable size={13} strokeWidth={1.9} />;
  return <IdCard size={13} strokeWidth={1.9} />;
}

export function RightPane() {
  const { state, tabs, active, setActive, closeTab, setRightOpen, openKind } = useSim();
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="group panel-stage relative flex h-full min-w-0 flex-col overflow-hidden rounded-[26px] shadow-soft">
      <div className="grid h-14 shrink-0 grid-cols-[42px_minmax(0,1fr)_42px] items-center px-2">
        <button
          type="button"
          aria-label="返回对话"
          onClick={() => setRightOpen(false)}
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-md-on-surface-variant md:invisible"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="col-start-2 flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-full bg-md-surface-high/92 p-1 [scrollbar-width:none]">
          {tabs.map((tab) => {
            const selected = tab.id === activeTab.id;
            return (
              <div
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={cn(
                  "group relative flex h-[30px] min-w-[64px] max-w-[164px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors",
                  selected ? "z-10 text-md-on-secondary-container" : "text-md-on-surface-variant hover:bg-md-on-surface/[0.055] hover:text-md-on-surface",
                )}
              >
                {selected && <motion.span layoutId="right-tab" transition={SPRING_FAST} className="absolute inset-0 rounded-full bg-md-secondary-container" />}
                <span className="relative flex shrink-0 items-center">
                  <TabIcon tab={tab} tasks={state.tasks} />
                </span>
                <span className="relative truncate">{tabTitle(tab, state.tasks)}</span>
                {tab.kind !== "workstation" && (
                  <button
                    type="button"
                    aria-label="关闭标签"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="relative flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full opacity-60 hover:bg-md-on-surface/10 hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="col-start-3 flex justify-end">
          <button
            type="button"
            aria-label="连接"
            title="连接"
            onClick={() => openKind("connections")}
            className="hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full text-md-on-surface-variant hover:bg-md-on-surface/[0.06] sm:flex"
          >
            <Cable size={15} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="h-full"
          >
            {activeTab.kind === "workstation" && <WorkstationList />}
            {activeTab.kind === "task" && activeTab.taskId && <TaskView taskId={activeTab.taskId} />}
            {activeTab.kind === "connections" && <ConnectionsView />}
          </motion.div>
        </AnimatePresence>
      </div>
      <button
        type="button"
        aria-label="收起工位"
        onClick={() => setRightOpen(false)}
        className="absolute right-3 bottom-3 hidden h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-md-surface-high/90 text-md-on-surface-variant opacity-0 transition-opacity hover:text-md-on-surface group-hover:opacity-100 md:flex"
      >
        <PanelRightClose size={14} />
      </button>
    </div>
  );
}

/* ───────────────────────── 工位：名片 + 筛选 + 任务列表（对应 Workstation） ───────────────────────── */

type Filter = "all" | "scheduled" | "running" | "attention" | "done";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "scheduled", label: "定时" },
  { value: "running", label: "进行中" },
  { value: "attention", label: "需处理" },
  { value: "done", label: "已完成" },
];
const NEEDS_ATTENTION: SimTask["status"][] = ["needs_gate", "needs_answer", "interrupted"];

function matchesFilter(task: SimTask, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "scheduled") return task.status === "scheduled";
  if (filter === "running") return task.status === "running";
  if (filter === "attention") return NEEDS_ATTENTION.includes(task.status);
  return task.status === "done";
}

function WorkstationList() {
  const { state, openTask } = useSim();
  const [filter, setFilter] = useState<Filter>("all");
  const [order, setOrder] = useState<"desc" | "asc">("desc");
  const busy = state.tasks.some((task) => task.status === "running");

  const list = state.tasks
    .filter((task) => matchesFilter(task, filter))
    .sort((a, b) => (order === "desc" ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));

  return (
    <div className="chat-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[620px] px-5 pt-2 pb-24">
        <div className="flex flex-col items-center pt-1 text-center">
          <div className="relative flex h-[132px] w-full items-center justify-center">
            <MochiAvatar state={mascotFor(busy ? "orchestrating" : "idle", null)} size={128} interactive />
          </div>
          <h1 className="font-display mt-1 text-[34px] leading-none font-semibold tracking-tight text-md-on-surface">{NAME}</h1>
          <p className="mt-2 text-xs text-md-on-surface-variant">{busy ? "工位正在忙，点开任务看看进展" : `${ACTIVITY_LABELS.idle}，随时可以派活`}</p>
        </div>

        <div className="mt-7 flex items-center justify-between">
          <div className="font-display text-[19px] font-semibold text-md-on-surface">
            任务 <span className="ml-1 font-normal text-md-on-surface-variant/70">{list.length}</span>
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

        <div className="mt-3 flex gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]">
          {FILTERS.map((item) => {
            const count = state.tasks.filter((task) => matchesFilter(task, item.value)).length;
            const selected = filter === item.value;
            return (
              <motion.button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                whileTap={{ scale: 0.92 }}
                transition={SPRING_JELLY}
                className={cn(
                  "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium transition-colors",
                  selected ? "border-transparent bg-md-secondary-container text-md-on-secondary-container" : "border-md-outline-variant/70 text-md-on-surface-variant hover:bg-md-on-surface/[0.05]",
                )}
              >
                {selected && <span className="h-1.5 w-1.5 rounded-full bg-md-primary" />}
                {item.label}
                <span className="tabular-nums opacity-70">{count}</span>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {list.map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                whileHover={{ y: -2 }}
                transition={SPRING_LAYOUT}
                className="group overflow-hidden rounded-[24px] bg-md-surface-lowest/92"
              >
                <motion.button
                  type="button"
                  onClick={() => openTask(task.id)}
                  whileTap={{ scale: 0.98 }}
                  transition={SPRING_JELLY}
                  className="flex w-full cursor-pointer items-start gap-3.5 p-3.5 text-left"
                >
                  <div className="relative shrink-0 pt-0.5 transition-transform duration-200 group-hover:-rotate-2 group-hover:scale-105">
                    <Critter seed={task.id} size={48} />
                    <span className={cn("absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-md-surface-lowest", STATUS_DOT[task.status])} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {task.status === "scheduled" && (
                      <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-md-secondary-container px-2.5 py-0.5 text-[11px] font-semibold text-md-on-secondary-container">
                        <Clock size={11} />
                        定时
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14.5px] font-medium text-md-on-surface">{task.title}</span>
                      <StatusBadge status={task.status} className="ml-auto" />
                    </div>
                    <div className={cn("mt-1 line-clamp-2 text-[12.5px] leading-relaxed", NEEDS_ATTENTION.includes(task.status) ? "text-rally-warn" : "text-md-on-surface-variant")}>
                      {task.summary}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-md-on-surface-variant/70">
                      <span className="font-mono">{task.id.toUpperCase()}</span>
                      <span>·</span>
                      <span>{task.duration}</span>
                      <span className="ml-auto tabular-nums">
                        {clockText(task.createdAt)} · {timeAgo(task.createdAt)}
                      </span>
                    </div>
                  </div>
                </motion.button>
              </motion.div>
            ))}
          </AnimatePresence>
          {list.length === 0 && <div className="py-10 text-center text-sm text-md-on-surface-variant/70">没有符合条件的任务</div>}
        </div>
      </div>
    </div>
  );
}

const STATUS_DOT: Record<SimTask["status"], string> = {
  running: "bg-md-primary",
  done: "bg-rally-ok",
  scheduled: "bg-md-secondary",
  needs_gate: "bg-md-tertiary",
  needs_answer: "bg-md-tertiary",
  interrupted: "bg-rally-warn",
};

/* ───────────────────────── 任务详情（对应 TaskView，只读转录） ───────────────────────── */

function TaskView({ taskId }: { taskId: string }) {
  const { state, mention } = useSim();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return null;

  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-5 pt-2 pb-28">
          <motion.div layout transition={SPRING_LAYOUT} className="rounded-[26px] bg-md-surface-high p-5">
            <div className="flex items-start gap-4">
              <Critter seed={task.id} size={60} className="shrink-0" />
              <div className="min-w-0 flex-1">
                {task.status === "scheduled" && (
                  <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-md-secondary-container px-2.5 py-0.5 text-[11px] font-semibold text-md-on-secondary-container">
                    <Clock size={11} />
                    定时派发
                  </span>
                )}
                <div className="flex items-start gap-2">
                  <h2 className="font-display min-w-0 flex-1 text-[20px] leading-snug font-semibold text-md-on-surface">{task.title}</h2>
                  <StatusBadge status={task.status} />
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-md-on-surface-variant">{task.summary}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] text-md-on-surface-variant">
              <span className="font-mono">{task.id.toUpperCase()}</span>
              <span className="text-md-on-surface-variant/60">·</span>
              <span>由 {NAME} 派发 · {clockText(task.createdAt)}</span>
              <span className="text-md-on-surface-variant/60">·</span>
              <span>{task.duration}</span>
              <span title={task.cwd} className="max-w-full truncate font-mono text-[11px]">{task.cwd}</span>
            </div>
          </motion.div>

          <div className="mt-7 flex flex-col gap-4">
            {task.items.map((entry) =>
              entry.kind === "text" ? (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 8, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={SPRING_LAYOUT}
                  className="flex gap-2.5"
                >
                  <div className="mt-0.5 h-7 w-7 shrink-0">
                    <Critter seed={task.id} size={28} />
                  </div>
                  <div className="max-w-[90%] min-w-0 rounded-[20px] rounded-tl-md bg-md-surface-lowest/80 px-4 py-2.5 text-sm leading-[1.65] whitespace-pre-wrap text-md-on-surface">
                    {entry.text}
                  </div>
                </motion.div>
              ) : (
                <motion.div key={entry.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_LAYOUT} className="pl-[38px]">
                  <ToolRow entry={entry} />
                </motion.div>
              ),
            )}
            {task.status === "running" && (
              <div className="flex items-center gap-2 pl-[38px] text-sm text-md-on-surface-variant">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-md-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-md-primary" />
                </span>
                工位正在执行…
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4">
        <div className="pointer-events-auto mx-auto flex max-w-[640px] items-center gap-2.5 rounded-[24px] bg-md-surface-high/95 py-2 pr-2.5 pl-4 shadow-float">
          <Lock size={14} className="shrink-0 text-md-on-surface-variant/70" />
          <div className="min-w-0 flex-1 text-xs text-md-on-surface-variant">
            这段对话由 <span className="font-medium text-md-on-surface">{NAME}</span> 管理。要调整，请在左侧主对话里告诉它。
          </div>
          <motion.button
            type="button"
            onClick={() => mention(task.id)}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING_JELLY}
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-md-primary px-3.5 text-xs font-bold text-md-on-primary"
          >
            <AtSign size={12} />
            在主对话中提及
          </motion.button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 连接页（对应 ConnectionsView，权限三档可切换） ───────────────────────── */

const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: "reversible", label: TIER_LABEL.reversible },
  { value: "external", label: TIER_LABEL.external },
  { value: "irreversible", label: TIER_LABEL.irreversible },
];

const TIER_HINT: Record<Tier, string> = {
  reversible: "直接执行，不打扰你",
  external: "执行并提示，留审计记录",
  irreversible: "每次先问你（默认）",
};

function ConnectionsView() {
  const { state, setTier } = useSim();
  return (
    <div className="chat-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[620px] flex-col gap-3 px-5 pt-2 pb-10">
        <p className="px-1 text-[12.5px] leading-relaxed text-md-on-surface-variant">
          每个连接器的工具统一在这里设权限。试着把「QQ 邮箱 · 发送」改成「对外」，再发起周报任务，看看门禁还会不会拦你。
        </p>
        {CONNECTORS.map((connector) => (
          <motion.div
            key={connector.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING_LAYOUT}
            className="rounded-[24px] bg-md-surface-lowest/92 p-4"
          >
            <div className="flex items-center gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-md-surface-low text-[14px] font-bold" style={{ color: connector.color }}>
                {connector.mark}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-md-on-surface">{connector.name}</div>
                <div className="mt-0.5 truncate text-[12px] text-md-on-surface-variant">{connector.desc}</div>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-md-on-surface-variant">
                <span className={cn("h-1.5 w-1.5 rounded-full", connector.plugged ? "bg-rally-ok" : "bg-md-outline")} />
                {connector.plugged ? "已连接" : "未连接"}
              </span>
            </div>
            {connector.tier && (
              <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-md-surface-low p-3">
                <div className="min-w-0">
                  <div className="font-mono text-[12px] font-semibold text-md-on-surface">{connector.tier}</div>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={state.tiers[connector.tier] ?? "irreversible"}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.16 }}
                      className="text-[11.5px] text-md-on-surface-variant"
                    >
                      {TIER_HINT[state.tiers[connector.tier] ?? "irreversible"]}
                    </motion.div>
                  </AnimatePresence>
                </div>
                <Segmented value={state.tiers[connector.tier] ?? "irreversible"} options={TIER_OPTIONS} onChange={(tier) => setTier(connector.tier!, tier)} />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
