import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Check, ChevronRight, Clock, Copy, FilePen, FilePlus2, FileText, FolderOpen, FolderPlus,
  ArrowRightLeft, GitBranch, Globe, Mail, MessageCircleQuestion, Search, Shield, SquareTerminal, Wrench, type LucideIcon,
} from "lucide-react";
import { MochiMascotSvg } from "../rally/mascot/MochiMascotSvg";
import { DEFAULT_PHYSICS, type AgentStateId } from "../rally/mascot/types";
import { SPRING_JELLY, SPRING_LAYOUT, SPRING_FAST } from "../components/ui";
import { cn } from "../utils/cn";
import { useSim } from "./engine";
import type { Activity, GateReq, QuestionReq, TaskStatus, Tier, ToolEntry } from "./types";

/* ───────────────────────── 状态与文案（与客户端 status.tsx 一致） ───────────────────────── */

export const NAME = "Rally";

export const STATUS_META: Record<TaskStatus, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  running: { label: "进行中", cls: "bg-md-primary-container text-md-on-primary-container", dot: "bg-md-primary", pulse: true },
  done: { label: "已完成", cls: "bg-rally-ok-container text-rally-on-ok-container", dot: "bg-rally-ok" },
  scheduled: { label: "定时中", cls: "bg-md-secondary-container text-md-on-secondary-container", dot: "bg-md-secondary" },
  needs_gate: { label: "待确认", cls: "bg-md-tertiary-container text-md-on-tertiary-container", dot: "bg-md-tertiary", pulse: true },
  needs_answer: { label: "待回答", cls: "bg-md-tertiary-container text-md-on-tertiary-container", dot: "bg-md-tertiary", pulse: true },
  interrupted: { label: "已中断", cls: "bg-rally-warn-container text-rally-on-warn-container", dot: "bg-rally-warn" },
};

export const ACTIVITY_LABELS: Record<Activity, string> = {
  idle: "待命",
  thinking: "思考中",
  querying: "查询中",
  orchestrating: "编排中",
  tooling: "调用工具",
  replying: "回复中",
};

const ACTIVITY_POSE: Record<Activity, AgentStateId> = {
  idle: "idle",
  thinking: "thinking",
  querying: "searching",
  orchestrating: "orchestrating",
  tooling: "coding",
  replying: "replying",
};

export function mascotFor(activity: Activity, flash: "completed" | null): AgentStateId {
  if (flash) return flash;
  return ACTIVITY_POSE[activity];
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={cn("inline-flex h-[21px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold tracking-[0.01em]", meta.cls, className)}>
      <span className="relative flex h-1.5 w-1.5 items-center justify-center">
        {meta.pulse && <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-65", meta.dot)} />}
        <span className={cn("relative h-1.5 w-1.5 rounded-full", meta.dot)} />
      </span>
      {meta.label}
    </span>
  );
}

export function clockText(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function timeAgo(ms: number) {
  const minutes = Math.floor(Math.max(0, Date.now() - ms) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`;
}

export const TIER_LABEL: Record<Tier, string> = { reversible: "可逆", external: "对外", irreversible: "不可逆" };

/* ───────────────────────── 图标与按钮 ───────────────────────── */

const TOOL_ICON: Record<string, LucideIcon> = {
  bash: SquareTerminal,
  read: FileText,
  write: FilePlus2,
  edit: FilePen,
  ls: FolderOpen,
  grep: Search,
  github: GitBranch,
  git: GitBranch,
  browser: Globe,
  qqmail_send: Mail,
  schedule_create: Clock,
  mkdir: FolderPlus,
  move: ArrowRightLeft,
};

export function MiniButton({
  children,
  onClick,
  tone = "tonal",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "primary" | "tonal" | "surface";
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.04 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      transition={SPRING_JELLY}
      className={cn(
        "inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-full px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40",
        tone === "primary" && "bg-md-primary text-md-on-primary",
        tone === "tonal" && "bg-md-secondary-container text-md-on-secondary-container",
        tone === "surface" && "bg-md-surface-lowest/85 text-md-on-surface",
      )}
    >
      {children}
    </motion.button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="复制"
      onClick={(event) => {
        event.stopPropagation();
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="cursor-pointer rounded-md p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/* ───────────────────────── 工具步骤（对应 ToolSteps） ───────────────────────── */

export function ToolRow({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[entry.name] ?? Wrench;
  const expandable = entry.status !== "running" && entry.output.length > 0;
  const outcome = entry.status === "running" ? "执行中…" : entry.note ?? "完成";

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-md-on-surface-variant transition-colors",
          expandable && "cursor-pointer hover:bg-md-on-surface/[0.06]",
          open && "bg-md-on-surface/[0.06]",
        )}
      >
        <Icon size={15} strokeWidth={1.7} className="shrink-0 text-md-on-surface-variant/70" />
        <span className="max-w-[40%] shrink-0 truncate text-md-on-surface/80">{entry.name}</span>
        <span className="min-w-0 truncate font-mono text-[0.92em] text-md-on-surface-variant/70">{entry.target}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          <span className={cn("text-[11px]", entry.status === "running" ? "text-md-primary" : "text-rally-ok")}>{outcome}</span>
          {entry.duration && <span className="text-[11px] text-md-on-surface-variant/70">{entry.duration}</span>}
          {expandable && (
            <motion.span animate={{ rotate: open ? 90 : 0 }} transition={SPRING_JELLY} className="flex text-md-on-surface-variant/70">
              <ChevronRight size={14} />
            </motion.span>
          )}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div
            key="output"
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={SPRING_LAYOUT}
            className="mt-1 mr-1 mb-2 ml-7 overflow-hidden rounded-xl bg-term shadow-soft"
          >
            <div className="flex items-center justify-between bg-white/5 px-3 py-1.5 text-xs text-white/60">
              <span className="truncate font-mono">{entry.target}</span>
              <CopyButton text={entry.output} />
            </div>
            <pre className="max-h-48 overflow-auto px-3 py-2.5 font-mono text-[12px] leading-[1.65] whitespace-pre-wrap text-white/80">{entry.output}</pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────────────────── 门禁卡（对应 GateCard） ───────────────────────── */

export function GateCard({ gate }: { gate: GateReq }) {
  const { decideGate } = useSim();
  const pending = !gate.decision;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  const seconds = Math.max(0, Math.ceil((gate.expiresAt - now) / 1000));
  useEffect(() => {
    // 超时按拒绝处理，与客户端的门禁行为一致
    if (pending && seconds === 0) decideGate(gate.id, "deny");
  }, [pending, seconds, decideGate, gate.id]);

  if (!pending) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={SPRING_LAYOUT}
        className="inline-flex max-w-[448px] items-center gap-2 self-start rounded-full bg-md-surface-low px-3.5 py-1.5 text-xs text-md-on-surface-variant"
      >
        <Shield size={13} className="shrink-0 text-md-primary" />
        <span className="min-w-0 break-words">
          <span className="font-mono font-semibold">{gate.tool.split(" · ")[0]}</span> · {gate.decision === "allow" ? "已允许" : "已拒绝"}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={SPRING_LAYOUT}
      className="max-w-[448px] overflow-hidden rounded-[26px] bg-md-surface-high p-2 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[20px] bg-rally-warn-container px-3.5 py-2 text-xs font-semibold text-rally-on-warn-container">
        <span className="flex items-center gap-1.5">
          <Shield size={13} className="shrink-0" />
          {gate.tool.split(" · ")[0]} · 请求不可逆操作
        </span>
        <span className="font-mono text-[11px] tabular-nums opacity-85">
          剩余 {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="px-2.5 pt-2.5 pb-2">
        <div className="leading-snug font-medium break-words whitespace-pre-wrap">{gate.action}</div>
        <div className="mt-1 font-mono text-[11.5px] break-all text-md-on-surface-variant">{gate.tool} · {gate.cwd}</div>
        <div className="mt-2 rounded-[16px] bg-md-surface-lowest/75 px-3 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap text-md-on-surface-variant">
          影响范围：{gate.scope.join("\n")}
          <br />
          可替代做法：{gate.alternative}
        </div>
        {gate.mailBody && (
          <div className="mt-2.5 text-xs text-md-on-surface-variant">
            <span className="font-medium">邮件正文</span>
            <pre className="mt-1 max-h-40 overflow-auto rounded-2xl bg-md-surface-lowest/80 p-2.5 font-sans whitespace-pre-wrap text-md-on-surface">{gate.mailBody}</pre>
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <MiniButton tone="surface" onClick={() => decideGate(gate.id, "deny")}>拒绝</MiniButton>
          <MiniButton tone="primary" onClick={() => decideGate(gate.id, "allow")}>{gate.mailBody ? "确认发送" : "允许"}</MiniButton>
        </div>
      </div>
    </motion.div>
  );
}

/* ───────────────────────── 问题卡（对应 QuestionCard） ───────────────────────── */

export function QuestionCard({ question }: { question: QuestionReq }) {
  const { answerQuestion } = useSim();
  if (question.closed) {
    return <div className="inline-flex self-start rounded-full bg-md-surface-low px-3.5 py-1.5 text-xs text-md-on-surface-variant">问题已取消</div>;
  }
  if (question.answer) {
    return (
      <div className="inline-flex max-w-[448px] items-center gap-2 self-start rounded-full bg-md-surface-low px-3.5 py-1.5 text-xs text-md-on-surface-variant">
        <MessageCircleQuestion size={13} className="shrink-0 text-md-primary" />
        你选择了：<span className="font-semibold text-md-on-surface">{question.answer}</span>
      </div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={SPRING_LAYOUT}
      className="max-w-[448px] rounded-[26px] bg-md-surface-high p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-md-primary">
          <MessageCircleQuestion size={14} className="shrink-0" />
          主对话在提问
        </div>
        <span className="shrink-0 rounded-full bg-md-tertiary-container px-2.5 py-0.5 text-[10.5px] font-semibold text-md-on-tertiary-container">待回答</span>
      </div>
      <div className="mt-2.5 text-[13.5px] leading-relaxed font-medium break-words whitespace-pre-wrap">{question.question}</div>
      <div className="mt-3 flex flex-col gap-2">
        {question.options.map((option) => (
          <motion.button
            type="button"
            key={option}
            whileHover={{ scale: 1.015, x: 2 }}
            whileTap={{ scale: 0.96, borderRadius: 10 }}
            transition={SPRING_JELLY}
            onClick={() => answerQuestion(question.id, option)}
            className="flex min-h-10 cursor-pointer items-center rounded-[16px] bg-md-surface-lowest px-3.5 py-2 text-left text-[13px] font-semibold text-md-on-surface hover:bg-md-surface-highest"
          >
            {option}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

/* ───────────────────────── 通用小部件 ───────────────────────── */

/** MD3 分段控件：滑动的 secondary-container 指示块 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="inline-flex rounded-full bg-md-surface-high p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "relative cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              selected ? "text-md-on-secondary-container" : "text-md-on-surface-variant hover:text-md-on-surface",
            )}
          >
            {selected && <motion.span layoutId={`seg-${id}`} transition={SPRING_FAST} className="absolute inset-0 rounded-full bg-md-secondary-container" />}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 小 Mochi：与客户端 AgentAvatar 相同的吉祥物与物理参数 */
export function MochiAvatar({ state, size, interactive = false }: { state: AgentStateId; size: number; interactive?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <MochiMascotSvg
      state={state}
      physics={{ ...DEFAULT_PHYSICS, followCursor: false }}
      size={size}
      compactMode={size < 80}
      interactive={interactive}
      reducedMotion={Boolean(reduced)}
      showSquircleBg={false}
    />
  );
}
