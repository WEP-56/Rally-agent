import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, PanelRightClose, PanelRightOpen, Paperclip, SquarePen, ShieldCheck, ChevronRight, Square, AtSign } from "lucide-react";
import type { ChatMsg, Task } from "../data";
import { allModels, useApp } from "../store";
import { cn } from "../utils/cn";
import { IconButton, RallyLogo, Select } from "./ui";
import { RichText } from "./RichText";
import { ToolSteps } from "./ToolSteps";
import { StatusIcon, StatusBadge } from "./status";

function UserBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160 || text.split("\n").length > 5;
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-bubble px-4 py-3 text-sm leading-relaxed text-fg">
        <div
          className={cn("relative overflow-hidden", long && !expanded && "max-h-[7.6em]")}
          style={long && !expanded ? { maskImage: "linear-gradient(to bottom, black 60%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent)" } : undefined}
        >
          <RichText text={text} />
        </div>
        {long && (
          <button onClick={() => setExpanded((v) => !v)} className="mt-2 text-[13px] text-muted hover:text-fg">
            {expanded ? "收起" : "展示更多"}
          </button>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const { openTask } = useApp();
  return (
    <button
      onClick={() => openTask(task.id)}
      className="group mt-3 flex w-full max-w-md items-center gap-3 rounded-xl bg-sunken px-3.5 py-3 text-left transition-all hover:bg-deep hover:shadow-soft dark:hover:bg-raised"
    >
      <StatusIcon status={task.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
          <span>{task.id.toUpperCase()}</span>
          <span>·</span>
          <span className="truncate">{task.summary}</span>
        </div>
      </div>
      <StatusBadge status={task.status} />
      <ChevronRight size={15} className="text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export function ChatPanel({
  messages,
  tasks,
  busy,
  onSend,
  onStop,
  onNewChat,
  rightOpen,
  onToggleRight,
  inject,
}: {
  messages: ChatMsg[];
  tasks: Task[];
  busy: boolean;
  onSend: (t: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  rightOpen: boolean;
  onToggleRight: () => void;
  inject?: { text: string; n: number };
}) {
  const { config, setConfig } = useApp();
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const running = tasks.filter((t) => t.status === "running").length;
  const models = allModels(config);
  const model = config.rallyModel || models[0]?.value || "";

  useEffect(() => {
    if (inject?.n) {
      setDraft((d) => (d ? d + " " : "") + inject.text);
      ta.current?.focus();
    }
  }, [inject?.n, inject?.text]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useLayoutEffect(() => {
    if (ta.current) {
      ta.current.style.height = "auto";
      ta.current.style.height = Math.min(ta.current.scrollHeight, 200) + "px";
    }
  }, [draft]);

  const send = () => {
    const t = draft.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* header */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 px-4">
        <RallyLogo size={24} />
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{config.name || "Rally"}</div>
          <div className="flex items-center gap-1.5 text-[11px] text-faint">
            <span className={cn("h-1.5 w-1.5 rounded-full", busy ? "animate-pulse bg-amber-500" : "bg-accent")} />
            {busy ? "思考中" : "在线"} · {running} 个任务进行中
          </div>
        </div>
        <div className="flex-1" />
        <IconButton title="新对话 (Ctrl+N)" onClick={onNewChat}>
          <SquarePen size={15} strokeWidth={1.8} />
        </IconButton>
        <IconButton title={rightOpen ? "收起右侧栏 (Ctrl+B)" : "展开右侧栏 (Ctrl+B)"} onClick={onToggleRight} active={!rightOpen}>
          {rightOpen ? <PanelRightClose size={16} strokeWidth={1.8} /> : <PanelRightOpen size={16} strokeWidth={1.8} />}
        </IconButton>
      </div>

      {/* messages */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-6 pb-6 pt-4">
          {messages.length === 0 && (
            <div className="animate-rise flex flex-col items-center pt-[14vh] text-center">
              <RallyLogo size={52} />
              <div className="mt-5 text-xl font-semibold">今天要一起推进什么？</div>
              <div className="mt-2 max-w-sm text-sm text-muted">我会规划、拆解，并把工作派发到工位上并行完成。你可以随时在右侧查看每个任务的进展。</div>
              <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2">
                {["分析一个 GitHub 仓库的架构", "启动本地服务并预览页面", "整理本周 issue 生成周报", "运行测试并修复失败用例"].map((s) => (
                  <button key={s} onClick={() => setDraft(s)} className="rounded-xl bg-sunken px-3.5 py-3 text-left text-[13px] text-muted transition-all hover:bg-deep hover:text-fg dark:hover:bg-raised">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="animate-rise">
                <UserBubble text={m.text} />
              </div>
            ) : (
              <div key={m.id} className="animate-rise text-sm leading-relaxed">
                {m.steps && m.steps.length > 0 && <ToolSteps steps={m.steps} />}
                {m.streaming && !m.text ? (
                  <div className="flex items-center gap-2 py-1 text-sm text-muted">
                    <span className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint" style={{ animationDelay: `${i * 120}ms` }} />
                      ))}
                    </span>
                    正在规划…
                  </div>
                ) : (
                  <RichText text={m.text} className="text-fg" />
                )}
                {m.taskRef && tasks.find((t) => t.id === m.taskRef) && <TaskCard task={tasks.find((t) => t.id === m.taskRef)!} />}
              </div>
            ),
          )}
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 px-5 pb-4">
        <div className="mx-auto max-w-[760px] rounded-2xl bg-raised p-2 shadow-card transition-shadow focus-within:shadow-pop dark:bg-sunken">
          <textarea
            ref={ta}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={`给 ${config.name || "Rally"} 发消息，复杂工作会自动派发到工位…`}
            className="block max-h-[200px] w-full resize-none bg-transparent px-2.5 pb-1 pt-1.5 text-sm leading-relaxed text-fg placeholder:text-faint"
          />
          <div className="mt-1 flex items-center gap-0.5">
            <IconButton title="添加附件">
              <Paperclip size={15} strokeWidth={1.8} />
            </IconButton>
            <IconButton title="引用任务" onClick={() => setDraft((d) => d + "@")}>
              <AtSign size={15} strokeWidth={1.8} />
            </IconButton>
            <Select ghost up value={model} options={models} onChange={(v) => setConfig({ rallyModel: v })} />
            <button
              onClick={() => setConfig({ autoApprove: !config.autoApprove })}
              className={cn("flex h-7 items-center gap-1 rounded-md px-2 text-xs transition-colors", config.autoApprove ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg")}
            >
              <ShieldCheck size={13} />
              {config.autoApprove ? "自动批准" : "需要批准"}
            </button>
            <div className="flex-1" />
            {busy ? (
              <button onClick={onStop} className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-panel transition-transform active:scale-95">
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={send}
                disabled={!draft.trim()}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-accent-fg shadow-soft transition-all active:scale-95 disabled:bg-press disabled:text-faint disabled:shadow-none"
              >
                <ArrowUp size={16} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
