import { SPRING_FAST, SPRING_JELLY, SPRING_LAYOUT } from "../md3/springs";
import { ActionButton } from "../md3/interactive";
import { AnimatePresence, motion } from "motion/react";
import { HorizontalDragScroll } from "../md3/components";
import { BrowserOverlayLease, useBrowserOverlay } from "../browser-overlays";
import { AgentAvatar } from "./AgentAvatar";
import { File } from "lucide-react";
import { ResourceView } from "./Attachments";
import { Critter } from "./brand";
import { useEffect, useState } from "react";
import { ArrowLeft, Cable, Plus, X, Globe, SquareTerminal, IdCard, ChevronRight, PanelRightClose } from "lucide-react";
import type { Tab } from "../store";
import { useApp } from "../store";
import type { Task } from "../data";
import { cn } from "../utils/cn";
import { ConnectionsView } from "./ConnectionsView";
import { Workstation } from "./Workstation";
import { TaskView } from "./TaskView";
import { BrowserView } from "./BrowserView";
import { AgentBrowserView } from "./AgentBrowser";
import { TerminalView } from "./TerminalView";
import { timeAgo } from "./status";
import { Kbd, RoundButton } from "./ui";

export const KIND_META = {
  workstation: { icon: IdCard, title: "Rally 的工位", desc: "名片与任务列表，查看每个任务的上下文", key: "Ctrl+1" },
  browser: { icon: Globe, title: "浏览器", desc: "打开网页或本地 http 服务进行预览", key: "Ctrl+2" },
  terminal: { icon: SquareTerminal, title: "终端", desc: "在工作区中运行命令", key: "Ctrl+3" },
  connections: { icon: Cable, title: "连接", desc: "飞书等外部应用", key: "Ctrl+4" },
} as const;

type NewKind = keyof typeof KIND_META;

function Launcher({ onPick, tasks }: { onPick: (k: NewKind) => void; tasks: Task[] }) {
  const { openTask } = useApp();
  const recent = tasks.filter(task => task.archivedAt === undefined).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  return (
    <div>
      <div className="flex flex-col gap-0.5">
        {(Object.keys(KIND_META) as NewKind[]).filter(k => !(k === "terminal" && window.runtime.mode === "cloud") && !(k === "browser" && window.runtime.platform === "android")).map((k) => {
          const M = KIND_META[k];
          return (
            <ActionButton
              key={k}
              onClick={() => onPick(k)}
              className="group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors hover:bg-fg/[0.05]"
            >
              <div className="flex w-5 shrink-0 items-center justify-center text-accent">
                <M.icon size={18} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{M.title}</div><div className="mt-0.5 truncate text-[11.5px] text-faint">{M.desc}</div></div>
              <Kbd>{M.key}</Kbd>
            </ActionButton>
          );
        })}
      </div>
      <div className="mt-4 px-1 text-[11px] font-medium text-faint">最近任务</div>
      <div className="mt-1.5 flex flex-col gap-0.5">
        {recent.map((t) => (
          <ActionButton key={t.id} onClick={() => openTask(t.id)} className="group flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover">
            <Critter seed={t.id} size={26} />
            <span className="flex-1 truncate text-[13px]">{t.title}</span>
            <span className="text-[11px] text-faint">{timeAgo(t.createdAt)}</span>
            <ChevronRight size={13} className="text-faint" />
          </ActionButton>
        ))}
      </div>
    </div>
  );
}

export function RightPanel({
	visible = true,
  tabs,
  active,
  setActive,
  closeTab,
  newTab,
  tasks,
  onMention,
  renameTab,
  onCollapse,
}: {
	visible?: boolean;
  tabs: Tab[];
  active: string | null;
  setActive: (id: string) => void;
  closeTab: (id: string) => void;
  newTab: (k: NewKind) => void;
  tasks: Task[];
  onMention: (t: Task) => void;
  renameTab: (id: string, title: string) => void;
  onCollapse: () => void;
}) {
  const [drawer, setDrawer] = useState(false);
  useBrowserOverlay(drawer);
  useEffect(() => {
    if (!drawer) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [drawer]);

  const pick = (k: NewKind) => {
    setDrawer(false);
    newTab(k);
  };

  return (
    <div className="rally-panel-frame md3-workstation-stage relative flex h-full min-w-0 flex-col overflow-hidden rounded-[28px]">
      {/* tab strip */}
      <div className="drag relative z-10 grid grid-cols-[42px_minmax(0,1fr)_42px] h-16 shrink-0 items-center px-2">
        <ActionButton className="no-drag flex h-10 w-10 items-center justify-center rounded-full text-muted md:invisible" aria-label="返回对话" onClick={onCollapse}><ArrowLeft size={18} /></ActionButton>
        <div className="no-drag col-start-2 flex min-w-0 max-w-full items-center gap-0.5 rounded-full bg-md-surface-high/92 p-1">
        <HorizontalDragScroll activeKey={active ?? ""} className="gap-0.5">
        {tabs.map((t) => {
          const isActive = t.id === active;
          const task = t.taskId ? tasks.find((x) => x.id === t.taskId) : undefined;
          const Icon = t.kind === "task" ? null : t.kind === "resource" ? File : t.kind === "agent-browser" ? Globe : KIND_META[t.kind].icon;
          return (
            <div
              key={t.id}
              data-active={isActive}
              onMouseDown={(e) => {
                if (e.button === 1 && t.kind !== "workstation") {
                  e.preventDefault();
                  closeTab(t.id);
                }
              }}
              onClick={() => setActive(t.id)}
              className={cn(
                "group relative flex h-[30px] shrink-0 min-w-[64px] max-w-[164px] cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors",
                isActive ? "z-10 text-md-on-secondary-container" : "text-muted hover:bg-fg/[0.055] hover:text-fg",
              )}
            >
              {isActive && <motion.span layoutId="right-panel-active-tab" transition={SPRING_FAST} className="absolute inset-0 rounded-full bg-md-secondary-container" />}

              <span className="relative flex shrink-0 items-center">
                {task ? <Critter seed={task.id} size={18} /> : t.kind === "workstation" ? <AgentAvatar size={17} /> : Icon && <Icon size={13} strokeWidth={1.9} />}
              </span>
              <span className="relative flex-1 truncate">{t.kind === "workstation" ? "工位" : t.kind === "task" ? t.taskId : t.title}</span>
              {t.kind !== "workstation" && <ActionButton
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className={cn(
                  "relative flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-faint hover:bg-press hover:text-fg",
                  !isActive && "opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={11.5} />
              </ActionButton>}
            </div>
          );
        })}
        </HorizontalDragScroll>
        <ActionButton
          onClick={() => setDrawer((v) => !v)}
          className={cn("ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg", drawer && "bg-md-secondary-container text-md-on-secondary-container")}
          title="新标签页"
        >
          <motion.span animate={{ rotate: drawer ? 45 : 0 }} transition={SPRING_JELLY} className="flex items-center justify-center">
            <Plus size={15} />
          </motion.span>
        </ActionButton>
        </div>
        <RoundButton size={36} className="no-drag justify-self-end" title="收起右侧栏 (Ctrl+B)" onClick={onCollapse}><PanelRightClose size={15} strokeWidth={1.8} /></RoundButton>
      </div>

      {/* content */}
      <div className="relative z-10 min-h-0 flex-1">
        {tabs.map((t) => {
          const task = t.taskId ? tasks.find((x) => x.id === t.taskId) : undefined;
          return (
            <div key={t.id} className={cn("absolute inset-0", t.id !== active && "hidden")}>
              {t.kind === "workstation" && <Workstation tasks={tasks} />}
              {t.kind === "connections" && <ConnectionsView visible={visible && t.id === active} />}
              {t.kind === "resource" && t.resource && <ResourceView resource={t.resource} visible={visible && t.id === active} />}
              {t.kind === "task" && task && <TaskView task={task} onMention={onMention} />}
              {t.kind === "browser" && <BrowserView id={t.id} visible={visible && t.id === active && !drawer} initialUrl={t.url} onTitle={(s) => renameTab(t.id, s)} />}
              {t.kind === "agent-browser" && t.browserId && <AgentBrowserView id={t.browserId} visible={visible && t.id === active && !drawer} onClose={() => closeTab(t.id)} />}
              {t.kind === "terminal" && <TerminalView id={t.id} taskId={t.taskId} visible={visible && t.id === active && !drawer} />}
            </div>
          );
        })}
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center overflow-y-auto p-6">
            <motion.div className=" w-full max-w-[520px]" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
              <div className="mb-1 text-lg font-semibold">新标签页</div>
              <div className="mb-5 text-sm text-faint">选择要打开的页面</div>
              <Launcher onPick={pick} tasks={tasks} />
            </motion.div>
          </div>
        )}

        {/* drawer */}
        <AnimatePresence>
          {drawer && (
            <>
              <BrowserOverlayLease />
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 z-20 bg-black/[0.08] dark:bg-black/32"
                onClick={() => setDrawer(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.94 }}
                transition={SPRING_FAST}
                style={{ transformOrigin: "85% 0%" }}
                className="absolute right-4 top-0 z-30 w-[340px] max-w-[calc(100%_-_32px)] rounded-[28px] bg-md-surface-high p-3 shadow-pop"
              >
                <div className="mb-2.5 flex items-center justify-between px-1.5">
                  <span className="text-[13px] font-semibold">打开新标签页</span>
                  <Kbd>Esc</Kbd>
                </div>
                <Launcher onPick={pick} tasks={tasks} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
