import { AgentAvatar } from "./AgentAvatar";
import { Critter } from "./brand";
import { Lock, AtSign, SquareTerminal } from "lucide-react";
import type { Task } from "../data";
import { useApp } from "../store";
import { RichText } from "./RichText";
import { ToolSteps } from "./ToolSteps";
import { ToolActivity } from "./ToolActivity";
import { AssistantContent } from "./AssistantContent";
import { StatusBadge, clock } from "./status";

import { ArchiveTaskButton } from "./ArchiveTaskButton";
import { ScheduledWorkerBadge } from "./ScheduledWorkerBadge";

export function TaskView({ task, onMention }: { task: Task; onMention: (t: Task) => void }) {
  const { config, openTab } = useApp();
  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-5 pb-28 pt-2">
          {/* header */}
          <div className="glass rounded-[26px] p-5">
            <div className="flex items-start gap-4"><Critter seed={task.id} size={60} />
              <div className="min-w-0 flex-1">
                {task.schedule && <div className="mb-2"><ScheduledWorkerBadge /></div>}
                <div className="flex items-start gap-2">
                  <h2 className="font-display min-w-0 flex-1 text-[20px] font-semibold leading-snug">{task.title}</h2>
                  <StatusBadge status={task.status} />
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{task.summary}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] text-muted">
              <span className="font-mono">{task.id.toUpperCase()}</span><span className="text-faint">·</span>
              <span>{task.schedule ? "定时派发" : `由 ${config.name || "Rally"} 派发`} · {clock(task.createdAt)}</span><span className="text-faint">·</span>
              <span>{task.duration}</span>
              {task.cwd && <span title={task.cwd} className="max-w-full truncate font-mono text-[11px]">{task.cwd}</span>}
              <span className="ml-auto"><ArchiveTaskButton task={task} /></span>
            </div>
          </div>

          {/* transcript */}
          <div className="mt-7 flex flex-col gap-4">
            {task.messages.map((m, i) => {
              if (m.role === "assistant") return <div key={m.message.id} className="animate-rise min-w-0">
                <AssistantContent blocks={m.message.blocks} calls={m.message.toolCalls} streaming={m.message.streaming} avatar={<Critter seed={task.id} size={28} className="mt-0.5 shrink-0" />} />
                {m.message.streaming && !m.message.blocks.length && <div className="py-1 pl-[38px] text-sm text-muted">正在思考…</div>}
              </div>;
              if (m.role === "rally")
                return (
                  <div key={m.id ?? i} className="animate-rise flex flex-col items-end">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
                      <AgentAvatar size={14} />
                      {config.name || "Rally"} · {m.label ?? "任务简报"}
                    </div>
                    <div className="bubble-user max-w-[88%] rounded-[22px] rounded-tr-md px-4 py-3 text-sm leading-[1.65]">
                      <RichText text={m.text} />
                    </div>
                  </div>
                );
              if (m.role === "agent")
                return (
                  <div key={i} className="animate-rise flex gap-2.5">
                    <Critter seed={task.id} size={28} className="mt-0.5 shrink-0" />
                    <div className="glass min-w-0 max-w-[90%] rounded-[20px] rounded-tl-md px-4 py-2.5 text-sm leading-[1.65]"><RichText text={m.text} /></div>
                  </div>
                );
              return (
                <div key={i} className="animate-rise pl-[38px]">
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4">
        <div className="glass-strong pointer-events-auto mx-auto flex max-w-[640px] items-center gap-3 rounded-[22px] py-2.5 pl-4 pr-2.5">
          <Lock size={14} className="shrink-0 text-faint" />
          <div className="min-w-0 flex-1 text-xs text-muted">
            这段对话由 <span className="font-medium text-fg">{config.name || "Rally"}</span> 管理。要调整，请在左侧主对话里告诉它。
          </div>
          <button title="在此目录打开终端" onClick={() => openTab("terminal", { taskId: task.id })} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fg/[0.06] px-3 text-xs font-medium hover:bg-fg/[0.1]"><SquareTerminal size={13} />终端</button>
          <button
            onClick={() => onMention(task)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 text-xs font-medium text-white transition-transform hover:scale-[1.03] active:scale-95 dark:bg-white dark:text-ink"
          >
            <AtSign size={12} />
            在主对话中提及
          </button>
        </div>
      </div>
    </div>
  );
}
