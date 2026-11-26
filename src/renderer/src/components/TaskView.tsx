import { MdButton } from "../md3/components";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "../md3/springs";
import { AgentAvatar } from "./AgentAvatar";
import { Critter } from "./brand";
import { Lock, AtSign, SquareTerminal } from "lucide-react";
import type { Task } from "../data";
import { useApp } from "../store";
import { useEffect, useState } from "react";
import type { RoleWorkerProfile } from "../../../shared/role-workers";
import { RichText } from "./RichText";
import { ToolSteps } from "./ToolSteps";
import { ToolActivity } from "./ToolActivity";
import { AssistantContent } from "./AssistantContent";
import { StatusBadge, clock } from "./status";

import { ArchiveTaskButton } from "./ArchiveTaskButton";
import { ScheduledWorkerBadge } from "./ScheduledWorkerBadge";
import { AttachmentCards } from "./Attachments";
import { AgentBrowserCard } from "./AgentBrowser";
import { useAgentBrowsers } from "../agent-browser";

export function TaskView({ task, onMention }: { task: Task; onMention: (t: Task) => void }) {
  const { config, openTab } = useApp();
  const [role, setRole] = useState<RoleWorkerProfile>();
  useEffect(() => { let alive = true; if (!task.roleId) { setRole(undefined); return; } void window.rally.roleWorkers.getState().then(roles => { if (alive) setRole(roles.find(item => item.id === task.roleId)); }); return () => { alive = false; }; }, [task.roleId]);
  const roleAvatar = role?.avatar ? <img src={role.avatar} alt="" width={28} height={28} className="mt-0.5 shrink-0 rounded-xl object-cover" /> : <Critter seed={task.id} size={28} className="mt-0.5 shrink-0" />;
  const browsers = useAgentBrowsers().filter(browser => browser.taskId === task.id);
  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-5 pb-28 pt-2">
          {/* header */}
          <motion.div layout transition={SPRING_LAYOUT} className="bg-md-surface-high rounded-[26px] p-5">
            <div className="flex items-start gap-4">{role?.avatar ? <img src={role.avatar} alt="" width={60} height={60} className="shrink-0 rounded-2xl object-cover" /> : <Critter seed={task.id} size={60} />}
              <div className="min-w-0 flex-1">
                {task.schedule && <div className="mb-2"><ScheduledWorkerBadge /></div>}
                <div className="flex items-start gap-2">
                  <h2 className="font-display min-w-0 flex-1 text-[20px] font-semibold leading-snug">{task.title}</h2>
                  <StatusBadge status={task.status} />
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{task.summary}</p>
                {role && <p className="mt-2 text-xs text-accent">{role.name}</p>}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px] text-muted">
              <span className="font-mono">{task.id.toUpperCase()}</span><span className="text-faint">·</span>
              <span>{task.schedule ? "定时派发" : `由 ${config.name || "Rally"} 派发`} · {clock(task.createdAt)}</span><span className="text-faint">·</span>
              <span>{task.duration}</span>
              {task.cwd && <span title={task.cwd} className="max-w-full truncate font-mono text-[11px]">{task.cwd}</span>}
              <span className="ml-auto"><ArchiveTaskButton task={task} /></span>
            </div>
          </motion.div>

          {/* transcript */}
          <div className="mt-7 flex flex-col gap-4">
            {browsers.map(browser => <AgentBrowserCard key={browser.id} browser={browser} />)}
            {task.messages.map((m, i) => {
              if (m.role === "assistant") return <motion.div key={m.message.id} className=" min-w-0" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
                <AssistantContent blocks={m.message.blocks} calls={m.message.toolCalls} streaming={m.message.streaming} avatar={roleAvatar} />
				<AttachmentCards items={m.message.attachments} />
                {m.message.streaming && !m.message.blocks.length && <div className="py-1 pl-[38px] text-sm text-muted">正在思考…</div>}
              </motion.div>;
              if (m.role === "rally")
                return (
                  <motion.div key={m.id ?? i} className=" flex flex-col items-end" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint">
                      <AgentAvatar size={14} />
                      {config.name || "Rally"} · {m.label ?? "任务简报"}
                    </div>
                    <div className="bubble-user max-w-[88%] rounded-[22px] rounded-tr-md px-4 py-3 text-sm leading-[1.65]">
                      <RichText text={m.text} />
                      <AttachmentCards items={m.attachments} />
                    </div>
                  </motion.div>
                );
              if (m.role === "agent")
                return (
                  <motion.div key={i} className=" flex gap-2.5" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
                    {roleAvatar}
                    <div className="glass min-w-0 max-w-[90%] rounded-[20px] rounded-tl-md px-4 py-2.5 text-sm leading-[1.65]"><RichText text={m.text} /></div>
                  </motion.div>
                );
              return (
                <motion.div key={i} className=" pl-[38px]" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
                  <ToolSteps steps={m.steps} rich />
                </motion.div>
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
        <div className="pointer-events-auto mx-auto flex max-w-[640px] items-center gap-2.5 rounded-[24px] bg-md-surface-high/95 py-2 pl-4 pr-2.5 shadow-float">
          <Lock size={14} className="shrink-0 text-faint" />
          <div className="min-w-0 flex-1 text-xs text-muted">
            这段对话由 <span className="font-medium text-fg">{config.name || "Rally"}</span> 管理。要调整，请在左侧主对话里告诉它。
          </div>
          {window.runtime.mode!=="cloud" && <MdButton size="xs" variant="surface" title="在此目录打开终端" leadingIcon={<SquareTerminal size={13} />} onClick={() => openTab("terminal", { taskId: task.id })}>终端</MdButton>}
          <MdButton size="xs" variant="filled" leadingIcon={<AtSign size={12} />} onClick={() => onMention(task)}>
            在主对话中提及
          </MdButton>
        </div>
      </div>
    </div>
  );
}
