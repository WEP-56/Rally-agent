import { AgentAvatar } from "./AgentAvatar";
import { File } from "lucide-react";
import { ResourceView } from "./Attachments";
import { Critter } from "./brand";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Cable, Plus, X, Globe, SquareTerminal, IdCard, ChevronRight, PanelRightClose } from "lucide-react";
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
            <button
              key={k}
              onClick={() => onPick(k)}
              className="group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors hover:bg-fg/[0.05]"
            >
              <div className="flex w-5 shrink-0 items-center justify-center text-accent">
                <M.icon size={18} strokeWidth={1.8} />
              </div>
              <div className="min-w-0 flex-1"><div className="text-[13.5px] font-medium">{M.title}</div><div className="mt-0.5 truncate text-[11.5px] text-faint">{M.desc}</div></div>
              <Kbd>{M.key}</Kbd>
            </button>
          );
        })}
      </div>
      <div className="mt-4 px-1 text-[11px] font-medium text-faint">最近任务</div>
      <div className="mt-1.5 flex flex-col gap-0.5">
        {recent.map((t) => (
          <button key={t.id} onClick={() => openTask(t.id)} className="group flex items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover">
            <Critter seed={t.id} size={26} />
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
  const [dragging, setDragging] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const selectedTab = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);

  useLayoutEffect(() => {
    const list = strip.current;
    const tab = selectedTab.current;
    if (!visible || !list || !tab) return;
    const viewport = list.getBoundingClientRect();
    const target = tab.getBoundingClientRect();
    // Scroll only the tabs; scrollIntoView can also move the surrounding panel.
    if (target.left < viewport.left) list.scrollLeft += target.left - viewport.left;
    else if (target.right > viewport.right) list.scrollLeft += target.right - viewport.right;
  }, [active, tabs.length, visible]);

  useEffect(() => {
    const list = strip.current;
    if (!list) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaX || !event.deltaY || list.scrollWidth <= list.clientWidth) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1;
      list.scrollLeft += event.deltaY * scale;
      event.preventDefault();
    };
    list.addEventListener("wheel", wheel, { passive: false });
    return () => list.removeEventListener("wheel", wheel);
  }, []);

  const endDrag = (id: number) => {
    if (drag.current?.id !== id) return;
    drag.current = null;
    setDragging(false);
  };
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
    <div className="stage relative flex h-full min-w-0 flex-col overflow-hidden rounded-[28px]">
      {/* tab strip */}
      <div className="drag relative z-10 flex h-16 shrink-0 items-center justify-center px-16">
        <div className="no-drag glass-strong flex min-w-0 max-w-full items-center gap-0.5 rounded-full p-1">
        <div ref={strip} className={cn("no-scrollbar flex min-w-0 select-none items-center gap-0.5 overflow-x-auto", dragging && "cursor-grabbing")}
          onPointerDown={event => {
            skipClick.current = false;
            const list = event.currentTarget;
            if (event.pointerType !== "mouse" || event.button !== 0 || list.scrollWidth <= list.clientWidth || (event.target instanceof Element && event.target.closest("button"))) return;
            drag.current = { id: event.pointerId, x: event.clientX, left: list.scrollLeft, moved: false };
          }}
          onPointerMove={event => {
            const gesture = drag.current;
            if (!gesture || gesture.id !== event.pointerId) return;
            const delta = event.clientX - gesture.x;
            if (!gesture.moved) {
              if (Math.abs(delta) < 5) return;
              gesture.moved = true;
              skipClick.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
            }
            event.currentTarget.scrollLeft = gesture.left - delta;
          }}
          onPointerLeave={event => { if (!drag.current?.moved) endDrag(event.pointerId); }}
          onPointerUp={event => endDrag(event.pointerId)}
          onPointerCancel={event => endDrag(event.pointerId)}
          onLostPointerCapture={event => endDrag(event.pointerId)}
          onClickCapture={event => {
            if (!skipClick.current || event.detail === 0) return;
            skipClick.current = false;
            event.stopPropagation();
            event.preventDefault();
          }}>
        {tabs.map((t) => {
          const isActive = t.id === active;
          const task = t.taskId ? tasks.find((x) => x.id === t.taskId) : undefined;
          const Icon = t.kind === "task" ? null : t.kind === "resource" ? File : t.kind === "agent-browser" ? Globe : KIND_META[t.kind].icon;
          return (
            <div
              key={t.id}
              ref={isActive ? selectedTab : undefined}
              onMouseDown={(e) => {
                if (e.button === 1 && t.kind !== "workstation") {
                  e.preventDefault();
                  closeTab(t.id);
                }
              }}
              onClick={() => setActive(t.id)}
              className={cn(
                "group relative flex h-[30px] shrink-0 min-w-[64px] max-w-[160px] items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors",
                isActive ? "z-10 bg-ink text-white shadow-soft dark:bg-white dark:text-ink" : "text-muted hover:text-fg",
              )}
            >
              {!isActive && <span className="pointer-events-none absolute inset-x-0.5 bottom-1 top-0 rounded-lg transition-colors group-hover:bg-hover" />}

              <span className={cn("relative flex shrink-0 items-center", !isActive && "-translate-y-0.5")}>
                {task ? <Critter seed={task.id} size={19} /> : t.kind === "workstation" ? <AgentAvatar size={17} /> : Icon && <Icon size={13} strokeWidth={1.9} />}
              </span>
              <span className={cn("relative flex-1 truncate", !isActive && "-translate-y-0.5")}>{t.kind === "workstation" ? "工位" : t.kind === "task" ? t.taskId : t.title}</span>
              {t.kind !== "workstation" && <button
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
              </button>}
            </div>
          );
        })}
        </div>
        <button
          onClick={() => setDrawer((v) => !v)}
          className={cn("ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-all hover:bg-hover hover:text-fg", drawer && "rotate-45 bg-hover text-fg")}
          title="新标签页"
        >
          <Plus size={16} />
        </button>
        </div>
        <RoundButton size={36} className="no-drag absolute right-3.5" title="收起右侧栏 (Ctrl+B)" onClick={onCollapse}><PanelRightClose size={15} strokeWidth={1.8} /></RoundButton>
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
            <div className="glass-strong animate-pop absolute right-4 top-0 z-30 w-[340px] max-w-[calc(100%_-_32px)] rounded-3xl p-2 shadow-pop">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-[13px] font-semibold">打开新标签页</span>
                <Kbd>Esc</Kbd>
              </div>
              <Launcher onPick={pick} tasks={tasks} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
