import { Lock, AtSign, Clock, Hash, SquareTerminal } from "lucide-react";
import type { Task } from "../data";
import { useApp } from "../store";
import { RichText } from "./RichText";
import { ToolSteps } from "./ToolSteps";
import { ToolActivity } from "./ToolActivity";
import { AssistantContent } from "./AssistantContent";
import { StatusBadge, clock } from "./status";
import { RallyLogo } from "./ui";
import { ArchiveTaskButton } from "./ArchiveTaskButton";

export function TaskView({ task, onMention }: { task: Task; onMention: (t: Task) => void }) {
  const { config, openTab } = useApp();
  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 pb-6 pt-5">
          {/* header */}
          <div className="rounded-2xl bg-sunken px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-base font-semibold">{task.title}</h2>
                  <StatusBadge status={task.status} />
                  <ArchiveTaskButton task={task} />
                </div>
                <p className="mt-1 text-xs text-muted">{task.summary}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-faint">
              <span className="flex items-center gap-1"><Hash size={11} />{task.id.toUpperCase()}</span>
              <span className="flex items-center gap-1"><RallyLogo size={11} />由 {config.name || "Rally"} 派发 · {clock(task.createdAt)}</span>
              <span className="flex items-center gap-1"><Clock size={11} />{task.duration}</span>
            </div>
          </div>

          {/* transcript */}
          <div className="mt-6 flex flex-col gap-5">
            {task.messages.map((m, i) => {
              if (m.role === "assistant") return <div key={m.message.id} className="animate-rise text-sm leading-relaxed">
                <AssistantContent blocks={m.message.blocks} calls={m.message.toolCalls} streaming={m.message.streaming} />
                {m.message.streaming && !m.message.blocks.length && <div className="py-1 text-muted">正在思考…</div>}
              </div>;
              if (m.role === "rally")
                return (
                  <div key={m.id ?? i} className="animate-rise flex flex-col items-end">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
                      <RallyLogo size={14} />
                      {config.name || "Rally"} · {m.label ?? "任务简报"}
                    </div>
                    <div className="max-w-[88%] rounded-2xl bg-bubble px-4 py-3 text-sm leading-relaxed">
                      <RichText text={m.text} />
                    </div>
                  </div>
                );
              if (m.role === "agent")
                return (
                  <div key={i} className="animate-rise text-sm leading-relaxed">
                    <RichText text={m.text} />
                  </div>
                );
              return (
                <div key={i} className="animate-rise">
                  <ToolSteps steps={m.steps} rich />
                </div>
              );
            })}
            {!task.messages.some((message) => message.role === "assistant") && task.toolCalls && task.toolCalls.length > 0 && <div><div className="mb-1 text-xs text-faint">最近工具调用（最多 20 条）</div><ToolActivity calls={task.toolCalls} /></div>}
            {task.status === "running" && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                工位正在执行…
              </div>
            )}
            {task.status === "queued" && <div className="text-sm text-faint">{task.duration}</div>}
          </div>
        </div>
      </div>

      {/* read-only footer */}
      <div className="shrink-0 px-5 pb-4">
        <div className="mx-auto flex max-w-[760px] items-center gap-3 rounded-2xl bg-sunken px-4 py-3">
          <Lock size={14} className="shrink-0 text-faint" />
          <div className="min-w-0 flex-1 text-xs text-muted">
            此对话由 <span className="font-medium text-fg">{config.name || "Rally"}</span> 主代理管理，无法直接发送消息。需要调整时，请在左侧主对话中告诉它。
          </div>
          <button title="在此目录打开终端" onClick={() => openTab("terminal", { taskId: task.id })} className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-raised px-2.5 text-xs font-medium text-fg shadow-soft"><SquareTerminal size={12} /><span className="hidden xl:inline">在此目录打开终端</span></button>
          <button
            onClick={() => onMention(task)}
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg bg-raised px-2.5 text-xs font-medium text-fg shadow-soft transition-transform hover:brightness-[0.98] active:scale-95"
          >
            <AtSign size={12} />
            在主对话中提及
          </button>
        </div>
      </div>
    </div>
  );
}
