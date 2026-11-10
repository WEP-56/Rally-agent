import { useEffect, useState } from "react";
import { Plus, X, Globe, SquareTerminal, IdCard, ChevronRight } from "lucide-react";
import type { Tab } from "../store";
import { useApp } from "../store";
import type { Task } from "../data";
import { cn } from "../utils/cn";
import { Workstation } from "./Workstation";
import { TaskView } from "./TaskView";
import { BrowserView } from "./BrowserView";
import { TerminalView } from "./TerminalView";
import { StatusIcon, timeAgo } from "./status";
import { Kbd } from "./ui";

export const KIND_META = {
  workstation: { icon: IdCard, title: "Rally 的工位", desc: "名片与任务列表，查看每个任务的上下文", key: "Ctrl+1" },
  browser: { icon: Globe, title: "浏览器", desc: "打开网页或本地 http 服务进行预览", key: "Ctrl+2" },
  terminal: { icon: SquareTerminal, title: "终端", desc: "在工作区中运行命令", key: "Ctrl+3" },
} as const;

type NewKind = keyof typeof KIND_META;

function Launcher({ onPick, tasks, compact }: { onPick: (k: NewKind) => void; tasks: Task[]; compact?: boolean }) {
  const { openTask } = useApp();
  const recent = [...tasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  return (
    <div>
      <div className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}>
        {(Object.keys(KIND_META) as NewKind[]).map((k) => {
          const M = KIND_META[k];
          return (
            <button
              key={k}
              onClick={() => onPick(k)}
              className="group flex flex-col items-start rounded-xl bg-sunken p-3.5 text-left transition-all hover:bg-raised hover:shadow-card active:scale-[0.98]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <M.icon size={18} strokeWidth={1.8} />
              </div>
              <div className="mt-3 text-sm font-medium">{M.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-faint">{M.desc}</div>
              <div className="mt-2.5"><Kbd>{M.key}</Kbd></div>
            </button>
          );
        })}
      </div>
      <div className="mt-4 px-1 text-[11px] font-medium text-faint">最近任务</div>
      <div className="mt-1.5 flex flex-col gap-0.5">
        {recent.map((t) => (
          <button key={t.id} onClick={() => openTask(t.id)} className="group flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover">
            <StatusIcon status={t.status} size={14} />
            <span className="flex-1 truncate text-[13px]">{t.title}</span>
            <span className="text-[11px] text-faint">{timeAgo(t.createdAt)}</span>
            <ChevronRight size={13} className="text-faint" />
          </button>
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
}) {
  const [drawer, setDrawer] = useState(false);
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
    <div className="relative flex h-full min-w-0 flex-col">
      {/* tab strip */}
      <div className="no-scrollbar flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto bg-deep px-2 pt-1.5">
        {tabs.map((t) => {
          const isActive = t.id === active;
          const task = t.taskId ? tasks.find((x) => x.id === t.taskId) : undefined;
          const Icon = t.kind === "task" ? null : KIND_META[t.kind].icon;
          return (
            <div
              key={t.id}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(t.id);
                }
              }}
              onClick={() => setActive(t.id)}
              className={cn(
                "group relative flex h-[34px] min-w-[96px] max-w-[200px] flex-1 items-center gap-2 rounded-t-[10px] px-3 text-[12.5px] transition-colors",
                isActive ? "z-10 bg-panel text-fg" : "text-muted hover:text-fg",
              )}
            >
              {!isActive && <span className="pointer-events-none absolute inset-x-0.5 bottom-1 top-0 rounded-lg transition-colors group-hover:bg-hover" />}
              {isActive && (
                <>
                  <span className="pointer-events-none absolute -left-2.5 bottom-0 h-2.5 w-2.5" style={{ background: "radial-gradient(circle at 0 0, transparent 9.5px, var(--c-panel) 10px)" }} />
                  <span className="pointer-events-none absolute -right-2.5 bottom-0 h-2.5 w-2.5" style={{ background: "radial-gradient(circle at 100% 0, transparent 9.5px, var(--c-panel) 10px)" }} />
                </>
              )}
              <span className={cn("relative flex shrink-0 items-center", !isActive && "-translate-y-0.5")}>
                {task ? <StatusIcon status={task.status} size={13} /> : Icon && <Icon size={13} strokeWidth={1.9} />}
              </span>
              <span className={cn("relative flex-1 truncate", !isActive && "-translate-y-0.5")}>{t.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
                className={cn(
                  "relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-faint hover:bg-press hover:text-fg",
                  !isActive && "-translate-y-0.5 opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setDrawer((v) => !v)}
          className={cn("mb-1.5 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-all hover:bg-hover hover:text-fg", drawer && "rotate-45 bg-hover text-fg")}
          title="新标签页"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* content */}
      <div className="relative min-h-0 flex-1 bg-panel">
        {tabs.map((t) => {
          const task = t.taskId ? tasks.find((x) => x.id === t.taskId) : undefined;
          return (
            <div key={t.id} className={cn("absolute inset-0", t.id !== active && "invisible")}>
              {t.kind === "workstation" && <Workstation tasks={tasks} />}
              {t.kind === "task" && task && <TaskView task={task} onMention={onMention} />}
              {t.kind === "browser" && <BrowserView id={t.id} visible={visible && t.id === active && !drawer} initialUrl={t.url} onTitle={(s) => renameTab(t.id, s)} />}
              {t.kind === "terminal" && <TerminalView id={t.id} taskId={t.taskId} visible={visible && t.id === active && !drawer} />}
            </div>
          );
        })}
        {tabs.length === 0 && (
          <div className="flex h-full items-center justify-center overflow-y-auto p-6">
            <div className="animate-rise w-full max-w-[520px]">
              <div className="mb-1 text-lg font-semibold">新标签页</div>
              <div className="mb-5 text-sm text-faint">选择要打开的页面</div>
              <Launcher onPick={pick} tasks={tasks} />
            </div>
          </div>
        )}

        {/* drawer */}
        {drawer && (
          <>
            <div className="animate-fade absolute inset-0 z-20 bg-black/[0.06] dark:bg-black/30" onClick={() => setDrawer(false)} />
            <div className="animate-drawer absolute inset-x-2 top-2 z-30 rounded-2xl bg-raised p-3.5 shadow-pop">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-[13px] font-semibold">打开新标签页</span>
                <Kbd>Esc</Kbd>
              </div>
              <Launcher compact onPick={pick} tasks={tasks} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
