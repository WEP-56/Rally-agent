import { AgentAvatar } from "./AgentAvatar";
import { Critter } from "./brand";
import { IM_SOURCE_LABELS, type ImSource } from "../../../shared/connections";
import type { ChatActivity, ChatHeaderState } from "../../../shared/ipc";
import type { NotificationTarget } from "../../../shared/notifications";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Settings, Search, ArrowUp, PanelRightOpen, Paperclip, ListRestart, LoaderCircle, SquarePen, ShieldCheck, ChevronRight, Square, AtSign } from "lucide-react";
import type { ModelSummary, ThinkingLevelName } from "../../../shared/models";
import type { ChatMsg, Task } from "../data";
import type { TaskQuestionView } from "../../../shared/task";
import { useApp } from "../store";
import { cn } from "../utils/cn";
import { Button, RoundButton, IconButton } from "./ui";
import { ModelPicker } from "./ModelPicker";
import { RichText } from "./RichText";
import { GateCard } from "./GateCard";
import { QuestionCard } from "./QuestionCard";
import { StatusBadge } from "./status";
import { conversationItems } from "../conversation";

function UserBubble({ text, source }: { text: string; source?: ImSource }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 160 || text.split("\n").length > 5;
  return (
    <div className="flex justify-end">
      <div className="bubble-user max-w-[82%] rounded-[22px] rounded-br-md px-4 py-2.5 text-[14.5px] leading-[1.65]">
        {source && <div className="mb-1 text-[11px] font-medium text-muted">来自{IM_SOURCE_LABELS[source.platform]}</div>}
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

function taskSourceLabel(task: Task): string {
  const labels = new Set(task.quotes?.flatMap(quote => quote.source ? [IM_SOURCE_LABELS[quote.source.platform]] : []));
  return labels.size ? ` · 来自${[...labels].join("、")}` : "";
}

function TaskCard({ task }: { task: Task }) {
  const { openTask } = useApp();
  return (
    <button
      onClick={() => openTask(task.id)}
      className="group mt-3 flex w-full max-w-md items-center gap-3 rounded-[22px] bg-panel px-3.5 py-3 text-left shadow-soft transition-all hover:bg-deep hover:shadow-soft dark:hover:bg-raised"
    >
      <Critter seed={task.id} size={38} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
          <span>{task.id.toUpperCase()}{taskSourceLabel(task)}</span>
          <span>·</span>
          <span className="truncate">{task.summary}</span>
        </div>
      </div>
      <StatusBadge status={task.status} />
      <ChevronRight size={15} className="text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

const ACTIVITY_LABEL: Record<ChatActivity, string> = {
  thinking: "思考中", replying: "回复中", querying: "查询中", planning: "制订任务", orchestrating: "编排中", compacting: "整理中",
};

export function ChatPanel({
	onShowHistory,
	historyBefore,
	header,
	conversationId,
	notificationFocus,
	messages,
	tasks,
	questions = [],
	busy,
	onSend,
	onStop,
	onNewChat,
	onCompactChat,
	rightOpen,
	onToggleRight,
	inject,
	models,
	model,
	thinkingLevel,
	onSelectModel,
	autoApprove,
	onAutoApprove,
}: {
	onShowHistory?: () => void;
	historyBefore?: number;
	header: ChatHeaderState;
	conversationId?: string;
	notificationFocus?: { target: NotificationTarget; n: number };
	messages: ChatMsg[];
	questions?: TaskQuestionView[];
	tasks: Task[];
	busy: boolean;
	onSend: (t: string) => void | Promise<void>;
	onStop: () => void;
	onNewChat: () => void;
	onCompactChat: () => void;
	rightOpen: boolean;
	onToggleRight: () => void;
	inject?: { text: string; n: number };
	models: ModelSummary[];
	model: string | null;
	thinkingLevel: string | null;
	onSelectModel: (provider: string, model: string, level?: ThinkingLevelName) => void;
	autoApprove: boolean;
	onAutoApprove: (enabled: boolean) => Promise<void>;
}) {
	const { config, openTab, openTask, openSettings } = useApp();
	const [actionError, setActionError] = useState<string | null>(null);
	const action = (operation: Promise<unknown>) => { setActionError(null); void operation.catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error))); };
	const [draft, setDraft] = useState("");
	const scroller = useRef<HTMLDivElement>(null);
	const followTail = useRef(true);
	const focusedNotice = useRef<number | undefined>(undefined);
	const ta = useRef<HTMLTextAreaElement>(null);
	const visibleMessages = messages.filter((message) => message.text.trim() || message.blocks?.some(block => block.type === "text" && block.text.trim()) || message.taskRef);
	const conversation = conversationItems(visibleMessages, questions, tasks, historyBefore);
	const latestGateId = conversation.findLast(item => item.role === "gate")?.id;
	const activityLabel = header.activity ? ACTIVITY_LABEL[header.activity] : "待命";

  useEffect(() => {
    setDraft("");
    setActionError(null);
    followTail.current = true;
  }, [conversationId]);

  useEffect(() => {
    if (inject?.n) {
      setDraft((d) => (d ? d + " " : "") + inject.text);
      ta.current?.focus();
    }
  }, [inject?.n, inject?.text]);

  useEffect(() => {
    if (!notificationFocus || focusedNotice.current === notificationFocus.n || !notificationFocus.target.cardId) return;
    followTail.current = false;
    const card = document.getElementById(notificationFocus.target.cardId);
    if (card) {
      card.scrollIntoView({ block: "center", behavior: "instant" });
      card.focus({ preventScroll: true });
      focusedNotice.current = notificationFocus.n;
    }
  }, [notificationFocus, tasks, questions]);

  useEffect(() => {
    if (followTail.current) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, questions.length, latestGateId]);

  useLayoutEffect(() => {
    if (ta.current) {
      ta.current.style.height = "auto";
      ta.current.style.height = Math.min(ta.current.scrollHeight, 200) + "px";
    }
  }, [draft]);

  const sending = useRef(false);
  const send = async () => {
    if (!draft.trim() || sending.current) return;
    followTail.current = true;
    sending.current=true;
    try {await onSend(draft);setDraft(current=>current===draft?"":current);setActionError(null);}catch(e){setActionError(String(e));}finally{sending.current=false;}
  };

  return (
    <div className="left-ambient relative flex h-full min-w-0 flex-col">
      <div className="chat-mobile-header drag relative z-10 flex h-16 shrink-0 items-center justify-between gap-2 px-3">
        <div className="chat-session-actions no-drag flex gap-2">
          {header.showNewConversation && <RoundButton size={36} title="新建会话 (Ctrl+N)" onClick={onNewChat}><SquarePen size={15} strokeWidth={1.8} /></RoundButton>}
          {header.showCompact && <RoundButton size={36} title="整理上下文 (Ctrl+Shift+N)" onClick={onCompactChat}><ListRestart size={15} strokeWidth={1.8} /></RoundButton>}
        </div>
        <button onClick={() => openTab("workstation")} title="打开 Rally 的工位" className={cn(
          "chat-identity no-drag glass-strong flex h-[42px] items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 md:absolute md:left-1/2 md:-translate-x-1/2",
          rightOpen ? "max-w-[min(45%,calc(100%_-_196px))]" : "max-w-[min(45%,calc(100%_-_272px))]",
        )}>
          <AgentAvatar size={32} />
          <span className="min-w-0 text-left leading-tight">
            <span className="block truncate text-[13px] font-semibold">{config.name}</span>
            <span role="status" className="flex items-center gap-1 whitespace-nowrap text-[10px] text-muted">
              {header.activity && <LoaderCircle aria-hidden="true" size={10} className="shrink-0 motion-safe:animate-spin" />}
              {activityLabel}
            </span>
          </span>
        </button>
        <div className="no-drag ml-auto flex gap-2"><RoundButton size={36} title="搜索 (Ctrl+K)" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}><Search size={15} strokeWidth={1.8} /></RoundButton><RoundButton size={36} title="设置 (Ctrl+,)" onClick={() => openSettings()}><Settings size={15} strokeWidth={1.8} /></RoundButton>{!rightOpen && <RoundButton size={36} title="展开右侧栏 (Ctrl+B)" onClick={onToggleRight}><PanelRightOpen size={15} strokeWidth={1.8} /></RoundButton>}</div>
      </div>
      {onShowHistory && <button onClick={onShowHistory} className="relative z-10 text-xs text-muted">显示旧会话</button>}

      {/* messages */}
      <div ref={scroller} onScroll={event => {
        const node = event.currentTarget;
        followTail.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }} className="chat-scroll relative z-10 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="mx-auto flex min-w-0 max-w-[760px] flex-col gap-4 px-4 pb-6 pt-4">
          {visibleMessages.length === 0 && (
            <div className="chat-welcome animate-rise flex flex-col items-center pt-[14vh] text-center">
              <AgentAvatar size={52} />
              <div className="mt-5 text-xl font-semibold">今天要一起推进什么？</div>
              <div className="mt-2 max-w-sm text-sm text-muted">我会规划、拆解，并把工作派发到工位上并行完成。你可以随时在右侧查看每个任务的进展。</div>
              <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2">
                {["分析一个 GitHub 仓库的架构", window.runtime.mode === "cloud" ? "检查服务器上的项目" : "启动本地服务并预览页面", "整理本周 issue 生成周报", "运行测试并修复失败用例"].map((s) => (
                  <button key={s} onClick={() => setDraft(s)} className="rounded-xl bg-sunken px-3.5 py-3 text-left text-[13px] text-muted transition-all hover:bg-deep hover:text-fg dark:hover:bg-raised">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {conversation.map((m) =>
            m.role === "gate" ? <GateCard key={m.id} taskId={m.taskId} gate={m.gate} openTask={() => openTask(m.taskId)} decide={(value) => window.rally.gates.decide(m.gate.id, value)} /> :
            m.role === "question" ? <QuestionCard key={m.id} {...m.record} answer={(option) => window.rally.tasks.answerOption(m.record.taskId, m.record.question.id, option)} /> : m.role === "system" ? (
              <div key={m.id} className="animate-rise whitespace-pre-wrap break-words text-center text-[12px] leading-relaxed text-faint">
                {m.text}
              </div>
            ) : m.role === "user" ? (
              <div key={m.id} className="animate-rise">
                <UserBubble text={m.text} source={m.source} />
              </div>
            ) : (
              <div key={m.id} className="animate-rise relative ml-8 min-w-0 max-w-[88%] self-start rounded-[22px] rounded-tl-md bg-panel p-4 text-sm leading-relaxed shadow-soft">
                <AgentAvatar size={28} className="absolute -left-9 top-1 rounded-full" />
                {m.blocks?.length ? m.blocks.filter(block => block.type === "text").map((block, index) => block.type === "text" ? <RichText key={index} text={block.text} /> : null) : m.text.trim() && <RichText text={m.text} className="text-fg" />}
                {m.taskRef && tasks.find((t) => t.id === m.taskRef) && <TaskCard task={tasks.find((t) => t.id === m.taskRef)!} />}
              </div>
            ),
          )}
          {tasks.filter((task) => task.approval === "pending" && task.status === "pending_approval").map((task) => (
            <div key={`approval-${task.id}`} className="ml-8 max-w-[440px] rounded-[22px] border border-warn/30 bg-panel p-4 text-sm shadow-soft">
              <div className="flex items-center gap-3"><Critter seed={task.id} size={40} /><div className="min-w-0 flex-1"><div className="truncate font-medium" title={task.title}>{task.title}</div><div className="mt-0.5 truncate text-[11.5px] text-faint" title={task.cwd}>{task.id}{taskSourceLabel(task)} · {task.mode === "readonly" ? "只读" : "改写"} · {task.cwd}</div></div><StatusBadge status={task.status} /></div>
              <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer py-1">原话 · 任务简报</summary><div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
                {task.quotes?.map((quote) => <div key={quote.messageId} className="mb-1">{quote.messageId}{quote.source && ` · ${IM_SOURCE_LABELS[quote.source.platform]}`} · {quote.text}</div>)}
                {task.note && <div>备注：{task.note}</div>}
                {!!task.dependsOn?.length && <div>依赖：{task.dependsOn.join("、")}</div>}
              </div></details>
              <div className="mt-3.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-faint">需要批准才会开始执行</span>
                <div className="flex gap-2"><Button size="sm" onClick={() => action(window.rally.tasks.cancel(task.id))}>取消</Button><Button size="sm" variant="primary" onClick={() => action(window.rally.tasks.approve(task.id))}>批准</Button></div>
              </div>
            </div>
          ))}
          {questions.filter(({ question }) => !question.answer && !question.closed).sort((a, b) => a.question.askedAt - b.question.askedAt).map(({ taskId, title, question }) => <QuestionCard key={question.id} taskId={taskId} title={title} question={question} answer={(option) => window.rally.tasks.answerOption(taskId, question.id, option)} />)}
          {actionError && <div role="alert" className="text-xs text-red-500">{actionError}</div>}
        </div>
      </div>

      {/* composer */}
      <div className="chat-composer relative z-10 shrink-0 px-3 pb-3.5">
        <div className="glass-strong mx-auto max-w-[760px] rounded-[28px] p-2 transition-shadow focus-within:shadow-pop">
          <textarea
            ref={ta}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (window.runtime.platform !== "android" || e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={`给 ${config.name || "Rally"} 发消息，复杂工作会自动派发到工位…`}
            className="block max-h-[200px] min-h-[42px] w-full resize-none bg-transparent px-3.5 pb-1 pt-2.5 text-[14.5px] leading-relaxed text-fg placeholder:text-faint"
          />
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-0.5">
            <IconButton className="no-drag" title="添加附件">
              <Paperclip size={15} strokeWidth={1.8} />
            </IconButton>
            <IconButton className="no-drag" title="引用任务" onClick={() => setDraft((d) => d + "@")}>
              <AtSign size={15} strokeWidth={1.8} />
            </IconButton>
            <ModelPicker models={models} model={model} thinkingLevel={thinkingLevel} onSelect={onSelectModel} />
            <button
              onClick={() => action(onAutoApprove(!autoApprove))}
              className={cn("flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors", autoApprove ? "bg-accent-soft text-accent" : "text-muted hover:bg-hover hover:text-fg")}
            >
              <ShieldCheck size={13} />
              {autoApprove ? "自动批准" : "需要批准"}
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
