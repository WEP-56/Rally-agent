import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, ChevronRight, PanelRightOpen, Paperclip, Settings, Square, SquarePen } from "lucide-react";
import { SPRING_JELLY, SPRING_LAYOUT, SPRING_PANEL } from "../components/ui";
import { Critter } from "../rally/critter";
import { cn } from "../utils/cn";
import { SUGGESTIONS } from "./scripts";
import { ACTIVITY_LABELS, GateCard, MochiAvatar, NAME, QuestionCard, StatusBadge, ToolRow, mascotFor } from "./parts";
import { useSim } from "./engine";
import type { ChatItem } from "./types";

/* ───────────────────────── 顶部状态胶囊（对应 PresenceCapsule） ───────────────────────── */

function PresenceCapsule() {
  const { state, openKind } = useSim();
  const running = state.tasks.filter((task) => task.status === "running").length;
  const attention = state.tasks.filter((task) => task.status === "needs_gate" || task.status === "needs_answer").length;
  const subtitle = state.running
    ? ACTIVITY_LABELS[state.activity]
    : running > 0
      ? `工位 ${running} 项执行中`
      : attention > 0
        ? `${attention} 项待你确认`
        : "待命";

  return (
    <motion.button
      type="button"
      layout
      onClick={() => openKind("workstation")}
      whileHover={{ scale: 1.035, y: -0.5 }}
      whileTap={{ scale: 0.93 }}
      transition={SPRING_JELLY}
      title="打开工位"
      className="group relative flex h-[48px] max-w-[220px] min-w-0 cursor-pointer items-center gap-2 pr-3.5 select-none"
    >
      <motion.span
        layout
        transition={SPRING_JELLY}
        className={cn(
          "pointer-events-none absolute inset-y-[5px] right-0 left-[10px] rounded-full transition-colors duration-200",
          state.running ? "bg-md-primary-container/90" : "bg-md-surface-high/95 group-hover:bg-md-surface-highest",
        )}
      />
      <div className="relative z-10 -ml-1 flex items-center">
        <MochiAvatar state={mascotFor(state.activity, state.flash)} size={48} />
      </div>
      <div className="relative z-10 min-w-0 text-left leading-[1.16]">
        <div className="font-display text-[15px] font-semibold text-md-on-surface">{NAME}</div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={subtitle}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="truncate text-[11.5px] text-md-on-surface-variant"
          >
            {subtitle}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.button>
  );
}

/* ───────────────────────── 消息流中的各类条目 ───────────────────────── */

function TaskMiniCard({ taskId }: { taskId: string }) {
  const { state, openTask } = useSim();
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return null;
  return (
    <motion.button
      type="button"
      onClick={() => openTask(task.id)}
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ scale: 1.015, y: -1.5 }}
      whileTap={{ scale: 0.96 }}
      transition={SPRING_JELLY}
      className="group flex w-full max-w-[440px] cursor-pointer items-center gap-3 rounded-[18px] bg-md-surface-high/92 px-3.5 py-2.5 text-left transition-colors hover:bg-md-surface-highest"
    >
      <Critter seed={task.id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-md-on-surface">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-md-on-surface-variant">
          <span className="shrink-0 font-mono font-semibold whitespace-nowrap">{task.id.toUpperCase()}</span>
          <span className="shrink-0">·</span>
          <span className="truncate">{task.summary}</span>
        </div>
      </div>
      <StatusBadge status={task.status} />
      <ChevronRight size={14} className="shrink-0 text-md-on-surface-variant/70 transition-transform group-hover:translate-x-0.5" />
    </motion.button>
  );
}

function ChatRow({ item }: { item: ChatItem }) {
  const enter = { initial: { opacity: 0, y: 8, scale: 0.985 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: SPRING_LAYOUT };
  switch (item.kind) {
    case "user":
      return (
        <motion.div {...enter} className="flex justify-end">
          <div className="bubble-user max-w-[82%] rounded-[24px] rounded-br-[6px] px-4 py-2.5 text-[14px] leading-[1.6] whitespace-pre-wrap">{item.text}</div>
        </motion.div>
      );
    case "text":
      return (
        <motion.div
          {...enter}
          className={cn(
            "max-w-[88%] min-w-0 self-start rounded-[22px] rounded-tl-md p-4 text-sm leading-relaxed whitespace-pre-wrap shadow-soft",
            item.final ? "bg-rally-ok-container/55 text-rally-on-ok-container" : "bg-md-surface-low text-md-on-surface",
          )}
        >
          {item.final && <span className="mb-1 block text-[11px] font-extrabold tracking-wide text-rally-ok">✓ 任务完成</span>}
          {item.text}
        </motion.div>
      );
    case "typing":
      return (
        <motion.div {...enter} className="flex items-center gap-1.5 self-start rounded-[18px] rounded-bl-[6px] bg-md-surface-low px-4 py-3">
          {[0, 1, 2].map((i) => (
            <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-md-on-surface-variant" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </motion.div>
      );
    case "tool":
      return (
        <motion.div {...enter} className="w-full max-w-[640px] self-start">
          <ToolRow entry={item} />
        </motion.div>
      );
    case "task":
      return (
        <div className="self-start">
          <TaskMiniCard taskId={item.taskId} />
        </div>
      );
    case "gate":
      return (
        <div className="ml-8 self-start">
          <GateCard gate={item.gate} />
        </div>
      );
    case "question":
      return (
        <div className="ml-8 self-start">
          <QuestionCard question={item.question} />
        </div>
      );
    case "system":
      return <div className="text-center text-[12px] leading-relaxed text-md-on-surface-variant/70">{item.text}</div>;
  }
}

/* ───────────────────────── 输入框（胶囊形，对应 ChatPanel 的 composer） ───────────────────────── */

function Composer() {
  const { state, send, stop, clearMentions } = useSim();
  const [draft, setDraft] = useState("");
  const busy = state.running;
  const canSend = Boolean(draft.trim() || state.mentions.length);

  const submit = () => {
    if (busy) {
      stop();
      return;
    }
    if (!canSend) return;
    const prefix = state.mentions.map((id) => `@${id.toUpperCase()}`).join(" ");
    send([prefix, draft].filter(Boolean).join(" "));
    setDraft("");
    clearMentions();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="mx-auto max-w-[760px] rounded-[26px] bg-md-surface-high/94 px-2.5 py-1.5 transition-shadow duration-200 focus-within:bg-md-surface-high focus-within:shadow-float">
      <AnimatePresence initial={false}>
        {state.mentions.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={SPRING_PANEL} className="overflow-hidden">
            <div className="flex flex-wrap gap-1.5 px-1.5 pt-0.5 pb-1.5">
              {state.mentions.map((id) => (
                <span key={id} className="inline-flex items-center rounded-full bg-md-secondary-container px-2.5 py-0.5 font-mono text-[11px] font-semibold text-md-on-secondary-container">
                  @{id.toUpperCase()}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex min-w-0 items-end gap-1">
        <button
          type="button"
          title="添加附件（演示中不可用）"
          aria-label="添加附件"
          className="mb-[2px] flex h-[30px] w-[30px] shrink-0 cursor-not-allowed items-center justify-center self-center rounded-full text-md-on-surface-variant/60"
        >
          <Paperclip size={14.5} strokeWidth={2} />
        </button>
        <textarea
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={`给 ${NAME} 发消息…`}
          className="block max-h-[120px] min-h-[28px] min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-[3px] text-[14px] leading-[1.45] text-md-on-surface outline-none placeholder:text-md-on-surface-variant/70"
        />
        <motion.button
          type="button"
          onClick={submit}
          aria-label={busy ? "停止" : "发送"}
          disabled={!busy && !canSend}
          initial={false}
          animate={{ scale: busy || canSend ? 1 : 0.92, borderRadius: busy ? 11 : canSend ? 13 : 20 }}
          whileHover={busy || canSend ? { scale: 1.09 } : undefined}
          whileTap={busy || canSend ? { scale: 0.84 } : undefined}
          transition={SPRING_JELLY}
          className={cn(
            "flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center transition-colors duration-150 disabled:cursor-default",
            busy ? "bg-md-on-surface text-md-surface" : canSend ? "bg-md-primary text-md-on-primary" : "bg-md-surface-lowest/55 text-md-on-surface-variant/40",
          )}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={busy ? "stop" : "send"}
              initial={{ scale: 0.35, opacity: 0, rotate: busy ? -45 : 0, y: busy ? 0 : 4 }}
              animate={{ scale: 1, opacity: 1, rotate: 0, y: 0 }}
              exit={{ scale: 0.35, opacity: 0 }}
              transition={SPRING_JELLY}
              className="flex items-center justify-center"
            >
              {busy ? <Square size={11} fill="currentColor" /> : <ArrowUp size={16.5} strokeWidth={2.35} />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </div>
    </div>
  );
}

/* ───────────────────────── 对话面板 ───────────────────────── */

export function ChatPane() {
  const { state, send, newChat, rightOpen, setRightOpen } = useSim();
  const scroller = useRef<HTMLDivElement>(null);
  const empty = state.chat.length === 0;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    else el.scrollTop = el.scrollHeight;
  }, [state.chat]);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3">
        <div className="flex items-center justify-self-start">
          <IconChip title="新建会话" onClick={newChat}>
            <SquarePen size={15} strokeWidth={1.85} />
          </IconChip>
        </div>
        <PresenceCapsule />
        <div className="flex items-center gap-1.5 justify-self-end">
          <IconChip title="设置（演示中不可用）" onClick={() => undefined}>
            <Settings size={15} strokeWidth={1.85} />
          </IconChip>
          {!rightOpen && (
            <IconChip title="展开工位" onClick={() => setRightOpen(true)} accent>
              <PanelRightOpen size={15} strokeWidth={1.85} />
            </IconChip>
          )}
        </div>
      </div>

      <div ref={scroller} className="chat-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-4 pt-2 pb-6">
          {empty && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_LAYOUT} className="flex flex-col items-center pt-[8vh] text-center">
              <MochiAvatar state="idle" size={64} interactive />
              <div className="mt-5 text-xl font-semibold text-md-on-surface">今天要一起推进什么？</div>
              <div className="mt-2 max-w-sm text-sm text-md-on-surface-variant">我会规划、拆解，并把工作派发到工位上并行完成。你可以随时在右侧查看每个任务的进展。</div>
              <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <motion.button
                    key={suggestion}
                    type="button"
                    onClick={() => send(suggestion)}
                    whileHover={{ scale: 1.02, y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    transition={SPRING_JELLY}
                    className="cursor-pointer rounded-xl bg-md-surface-low px-3.5 py-3 text-left text-[13px] leading-snug text-md-on-surface-variant transition-colors hover:bg-md-surface-highest hover:text-md-on-surface"
                  >
                    {suggestion}
                  </motion.button>
                ))}
              </div>
              <div className="mt-4 text-[11.5px] text-md-on-surface-variant/70">点一个建议，或者直接输入你想做的事</div>
            </motion.div>
          )}
          {state.chat.map((item) => (
            <ChatRow key={item.id} item={item} />
          ))}
        </div>
      </div>

      <div className="shrink-0 px-3.5 pt-1 pb-3">
        <Composer />
      </div>
    </div>
  );
}

function IconChip({ children, title, onClick, accent }: { children: ReactNode; title: string; onClick: () => void; accent?: boolean }) {
  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.86 }}
      transition={SPRING_JELLY}
      className={cn(
        "flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full transition-colors",
        accent ? "bg-md-secondary-container text-md-on-secondary-container" : "text-md-on-surface-variant hover:bg-md-on-surface/[0.06] hover:text-md-on-surface",
      )}
    >
      {children}
    </motion.button>
  );
}
