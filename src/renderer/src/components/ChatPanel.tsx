import { SPRING_FAST, SPRING_JELLY, SPRING_LAYOUT } from "../md3/springs";
import { ActionButton, Disclosure } from "../md3/interactive";
import { AnimatePresence, motion } from "motion/react";
import { PresenceCapsule } from "./PresenceCapsule";
import { AgentAvatar } from "./AgentAvatar";
import { CredentialCard } from "./CredentialCard";
import { AgentBrowserCard } from "./AgentBrowser";
import { useAgentBrowsers } from "../agent-browser";
import { useCredentials } from "../credentials";
import { Critter } from "./brand";
import { IM_SOURCE_LABELS, type ImSource } from "../../../shared/connections";
import type { ChatHeaderState, ChatDelivery } from "../../../shared/ipc";
import type { NotificationTarget } from "../../../shared/notifications";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Settings, Search, ArrowUp, Paperclip, ListRestart, PanelRightOpen, SquarePen, ChevronRight, Square, Pause, Undo2, RotateCw, AtSign } from "lucide-react";
import type { ChatMsg, Task } from "../data";
import type { TaskQuestionView } from "../../../shared/task";
import { useApp } from "../store";
import { cn } from "../utils/cn";
import { Button, RoundButton, IconButton, useClickOutside } from "./ui";
import { RichText } from "./RichText";
import { GateCard } from "./GateCard";
import { QuestionCard } from "./QuestionCard";
import { StatusBadge } from "./status";
import { conversationItems } from "../conversation";
import type { ResourceRef } from "../../../shared/resources";
import { useAttachments } from "../attachments";
import { AttachmentCards, PendingThumbnail, fileSize } from "./Attachments";
import { TaskMentionPicker, TaskMentionTag, type TaskMention, type MentionQuery, mentionAt, splitTaskMentions, withTaskMentions } from "./TaskMentions";

function UserBubble({ text, source, attachments, tasks }: { text: string; source?: ImSource; attachments?: ResourceRef[]; tasks: Task[] }) {
  const [expanded, setExpanded] = useState(false);
  const { openTask } = useApp();
  const { body, ids } = splitTaskMentions(text);
  const long = body.length > 160 || body.split("\n").length > 5;
  return (
    <div className="flex justify-end">
      <div className="bubble-user max-w-[82%] rounded-[24px] rounded-br-[6px] px-4 py-2.5 text-[14px] leading-[1.6]">
        {source && <div className="mb-1 text-[11px] font-medium text-md-on-primary-container/72">来自{IM_SOURCE_LABELS[source.platform]}</div>}
        <AttachmentCards items={attachments} />
        <div
          className={cn("relative overflow-hidden", long && !expanded && "max-h-[7.6em]")}
          style={long && !expanded ? { maskImage: "linear-gradient(to bottom, black 60%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, black 60%, transparent)" } : undefined}
        >
          {body && <RichText text={body} />}
        </div>
        {!!ids.length && <div className="flex flex-wrap gap-1.5 py-1">{ids.map((id, index) => {
          const task = tasks.find(task => task.id.toUpperCase() === id);
          return <TaskMentionTag key={`${id}-${index}`} task={task ?? { id, title: id }} onOpen={task ? () => openTask(task.id) : undefined} />;
        })}</div>}
        {long && (
          <ActionButton onClick={() => setExpanded((v) => !v)} className="mt-1.5 rounded-full px-2 py-0.5 text-[12.5px] font-medium text-md-on-primary-container/80 hover:text-md-on-primary-container">
            {expanded ? "收起" : "展示更多"}
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function taskSourceLabel(task: Task): string {
  const labels = new Set(task.quotes?.flatMap(quote => quote.source ? [IM_SOURCE_LABELS[quote.source.platform]] : []));
  return labels.size ? ` · 来自${[...labels].join("、")}` : "";
}

function DeliveryStatus({ id, delivery, act }: { id: string; delivery?: ChatDelivery; act: (operation: Promise<unknown>) => void }) {
  if (!delivery) return null;
  const replyFailed = delivery.status === "done" && delivery.reply?.status === "failed";
  const canWithdraw = delivery.status === "queued" || delivery.status === "failed";
  const canRetry = delivery.status === "failed" || replyFailed;
  const canCancelReply = delivery.status === "done" && (delivery.reply?.status === "pending" || replyFailed);
  if (!canWithdraw && !canRetry && !canCancelReply) return null;
  return <div className="mt-1 flex items-center justify-end gap-0.5">
    {(canWithdraw || canCancelReply) && <IconButton aria-label={canWithdraw ? "撤回" : "取消回传"} onClick={() => act(window.rally.chat.inbox({ action: "cancel", id }))}><Undo2 size={14} /></IconButton>}
    {canRetry && <IconButton aria-label={replyFailed ? "重发回复" : "重试"} onClick={() => act(window.rally.chat.inbox({ action: "retry", id }))}><RotateCw size={14} /></IconButton>}
  </div>;
}

function TaskCard({ task }: { task: Task }) {
  const { openTask } = useApp();
  return (
    <ActionButton
      onClick={() => openTask(task.id)}
      initial={false} animate={{ borderRadius: 18, scale: 1, y: 0 }} whileHover={{ scale: 1.02, y: -1.5, borderRadius: 24 }} whileTap={{ scale: 0.95, borderRadius: 12 }} transition={SPRING_JELLY}
      className="group mt-2.5 flex w-full max-w-[420px] items-center gap-3 bg-md-surface-high/92 px-3.5 py-2.5 text-left transition-colors hover:bg-md-surface-highest"
    >
      <Critter seed={task.id} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-md-on-surface">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-md-on-surface-variant">
          <span className="shrink-0 whitespace-nowrap font-mono font-semibold">{task.id.toUpperCase()}{taskSourceLabel(task)}</span>
          <span className="shrink-0">·</span>
          <span className="truncate">{task.summary}</span>
        </div>
      </div>
      <StatusBadge status={task.status} />
      <ChevronRight size={14} className="shrink-0 text-faint transition-transform duration-200 group-hover:translate-x-0.5" />
    </ActionButton>
  );
}


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
	inboxPaused,
	modelReady,
	onSend,
	onStop,
	onNewChat,
	onCompactChat,
	rightOpen,
	onToggleRight,
	inject,
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
	inboxPaused?: boolean;
	modelReady?: boolean;
	onSend: (t: string, attachments?: string[]) => void | Promise<void>;
	onStop: () => void;
	onNewChat: () => void;
	onCompactChat: () => void;
	rightOpen: boolean;
	onToggleRight: () => void;
	inject?: { task: TaskMention; n: number };
}) {
	const { config, openTab, openTask, openSettings } = useApp();
	const [actionError, setActionError] = useState<string | null>(null);
	const action = (operation: Promise<unknown>) => { setActionError(null); void operation.catch((error: unknown) => setActionError(error instanceof Error ? error.message : String(error))); };
	const [draft, setDraft] = useState("");
	const attachments = useAttachments(conversationId);
	const fileInput = useRef<HTMLInputElement>(null);
	const [sendPending, setSendPending] = useState(false);
  const [resumePending, setResumePending] = useState(false);
	const scroller = useRef<HTMLDivElement>(null);
  const chatBody = useRef<HTMLDivElement>(null);
  const chatHeader = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = chatHeader.current;
    const body = chatBody.current;
    if (!header || !body) return;
    const update = () => body.style.setProperty("--chat-header-height", `${header.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
	const followTail = useRef(true);
	const focusedNotice = useRef<number | undefined>(undefined);
	const ta = useRef<HTMLTextAreaElement>(null);
	const visibleMessages = messages.filter((message) => message.attachments?.length || message.text.trim() || message.blocks?.some(block => block.type === "text" && block.text.trim()) || message.taskRef);
	const credentials = useCredentials();
	const browsers = useAgentBrowsers();
	const conversation = conversationItems(visibleMessages, questions, tasks, historyBefore, credentials.state.requests, browsers);
	const latestGateId = conversation.findLast(item => item.role === "gate")?.id;
	const queuedCount = messages.filter(message => message.delivery?.status === "queued").length;

  const [mentions, setMentions] = useState<TaskMention[]>([]);
  const [picker, setPicker] = useState<MentionQuery | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const pickerId = useId();
  const pickerButtonId = `${pickerId}-button`;
  const composer = useClickOutside<HTMLDivElement>(picker !== null, () => setPicker(null));
  const composing = useRef(false);
  const consumedMention = useRef(0);
  const cursor = useRef<number | null>(null);
  const query = picker?.query.toLowerCase() ?? "";
  const mentionChoices = picker ? tasks.filter(task => task.archivedAt === undefined &&
    !mentions.some(mention => mention.id === task.id) &&
    (task.id.toLowerCase().includes(query) || task.title.toLowerCase().includes(query)))
    .sort((a, b) => b.createdAt - a.createdAt) : [];
  const activeChoice = Math.min(highlighted, mentionChoices.length - 1);

  function updateQuery(value: string, caret: number) {
    setPicker(mentionAt(value, caret));
    setHighlighted(0);
  }
  function addTask({ id, title }: TaskMention) {
    setMentions(current => current.some(item => item.id === id) ? current : [...current, { id, title }]);
    setPicker(null);
    ta.current?.focus();
  }
  function addMention(task: TaskMention) {
    if (picker?.range) {
      const [start, end] = picker.range;
      cursor.current = start;
      setDraft(current => current.slice(0, start) + current.slice(end));
    }
    addTask(task);
  }
  function pickerKey(event: KeyboardEvent, fromButton: boolean) {
    if (!picker || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (mentionChoices.length) {
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlighted((activeChoice + step + mentionChoices.length) % mentionChoices.length);
      }
    } else if (event.key === "Escape") {
      setPicker(null);
      if (fromButton) document.getElementById(pickerButtonId)?.focus();
    } else if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const task = mentionChoices[activeChoice];
      if (task) addMention(task);
    } else return false;
    event.preventDefault();
    return true;
  }

  useEffect(() => {
    setDraft("");
    setMentions([]);
    setPicker(null);
    setActionError(null);
    followTail.current = true;
  }, [conversationId]);

  useEffect(() => {
    if (!inject || consumedMention.current === inject.n) return;
    consumedMention.current = inject.n;
    addTask(inject.task);
  }, [inject]);

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
      if (cursor.current !== null) {
        ta.current.setSelectionRange(cursor.current, cursor.current);
        cursor.current = null;
      }
    }
  }, [draft]);

  const sending = useRef(false);
  const send = async () => {
    if ((!draft.trim() && !mentions.length && !attachments.items.length) || !attachments.ready || sending.current) return;
    setPicker(null);
    followTail.current = true;
    sending.current=true; setSendPending(true);
    const submitted = attachments.items;
    try {
      await onSend(withTaskMentions(draft, mentions), submitted.map(item => item.resource!.id));
      setDraft(current => current === draft ? "" : current);
      setMentions(current => current.filter(mention => !mentions.includes(mention)));
      for (const item of submitted) attachments.remove(item.id);
      setActionError(null);
    } catch (e) { setActionError(String(e)); }
    finally { sending.current = false; setSendPending(false); }
  };

  const canSend = attachments.ready && Boolean(draft.trim() || mentions.length || attachments.items.length);
  const canResumeQueue = !busy && !canSend && Boolean(inboxPaused) && queuedCount > 0;
  const composerTitle = canResumeQueue ? `继续队列（${queuedCount} 条待处理）` : busy && !canSend ? "停止回复并暂停队列" : busy ? "加入消息队列" : "发送消息";
  async function resumeQueue() {
    if (resumePending) return;
    setResumePending(true);
    setActionError(null);
    try { await window.rally.chat.inbox({ action: "resume" }); }
    catch (error) { setActionError(String(error)); }
    finally { setResumePending(false); }
  }

  return (
    <div className="md3-chat-stage relative flex h-full min-w-0 flex-col" onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { if (event.dataTransfer.files.length) { event.preventDefault(); if (!sendPending) attachments.add(Array.from(event.dataTransfer.files)); } }}>
      <div ref={chatBody} className="chat-body relative flex min-h-0 flex-1 flex-col">
      <div ref={chatHeader} className="chat-header-overlay">
      <div className="chat-mobile-header drag relative z-10 grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 px-3">
        <div className="chat-session-actions no-drag flex items-center gap-1.5 justify-self-start">
          {header.showNewConversation && <RoundButton size={34} title="新建会话 (Ctrl+N)" onClick={onNewChat}><SquarePen size={15} strokeWidth={1.85} /></RoundButton>}
          {header.showCompact && <RoundButton size={34} title="整理上下文 (Ctrl+Shift+N)" onClick={onCompactChat}><ListRestart size={15} strokeWidth={1.85} /></RoundButton>}
        </div>
        <PresenceCapsule personaName={config.name} activity={header.activity ?? "idle"} tasks={tasks} rightOpen={rightOpen} onOpenWorkstation={() => openTab("workstation")} />
        <div className="chat-header-tools no-drag ml-auto flex items-center gap-1.5 justify-self-end">
          <RoundButton size={34} className="chat-header-search" title="搜索 (Ctrl+K)" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}><Search size={15} strokeWidth={1.85} /></RoundButton>
          <RoundButton size={34} className="chat-header-settings" title="设置 (Ctrl+,)" onClick={() => openSettings()}><Settings size={15} strokeWidth={1.85} /></RoundButton>
          {!rightOpen && <RoundButton size={34} className="hidden md:inline-flex bg-md-secondary-container text-md-on-secondary-container" title="展开工位栏 (Ctrl+B)" onClick={onToggleRight}><PanelRightOpen size={15} strokeWidth={1.85} /></RoundButton>}
        </div>
      </div>
      {onShowHistory && <ActionButton onClick={onShowHistory} className="relative z-10 text-xs text-muted">显示旧会话</ActionButton>}

      </div>

      {/* messages */}
      <div ref={scroller} onScroll={event => {
        const node = event.currentTarget;
        followTail.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }} className="chat-scroll no-scrollbar relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="chat-message-content mx-auto flex min-w-0 max-w-[760px] flex-col gap-4 px-4 pb-6">
          {visibleMessages.length === 0 && (
            <motion.div className="chat-welcome  flex flex-col items-center pt-[14vh] text-center" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
              <AgentAvatar size={52} />
              <div className="mt-5 text-xl font-semibold">今天要一起推进什么？</div>
              <div className="mt-2 max-w-sm text-sm text-muted">我会规划、拆解，并把工作派发到工位上并行完成。你可以随时在右侧查看每个任务的进展。</div>
              <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-2">
                {["分析一个 GitHub 仓库的架构", window.runtime.mode === "cloud" ? "检查服务器上的项目" : "启动本地服务并预览页面", "整理本周 issue 生成周报", "运行测试并修复失败用例"].map((s) => (
                  <ActionButton key={s} onClick={() => setDraft(s)} className="rounded-xl bg-sunken px-3.5 py-3 text-left text-[13px] text-muted  hover:bg-deep hover:text-fg dark:hover:bg-raised">
                    {s}
                  </ActionButton>
                ))}
              </div>
            </motion.div>
          )}
          {conversation.map((m) =>
            m.role === "browser" ? <AgentBrowserCard key={m.id} browser={m.browser} /> :
            m.role === "credential" ? <CredentialCard key={m.id} request={m.request} changed={credentials.setState} /> :
            m.role === "gate" ? <GateCard key={m.id} taskId={m.taskId} gate={m.gate} openTask={() => openTask(m.taskId)} decide={(value) => window.rally.gates.decide(m.gate.id, value)} /> :
            m.role === "question" ? <QuestionCard key={m.id} {...m.record} answer={(option) => window.rally.tasks.answerOption(m.record.taskId, m.record.question.id, option)} /> : m.role === "system" ? (
              <motion.div key={m.id} className=" whitespace-pre-wrap break-words text-center text-[12px] leading-relaxed text-faint" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
                {m.text}
                <AttachmentCards items={m.attachments} />
              </motion.div>
            ) : m.role === "user" ? (
              <motion.div key={m.id} className="" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
                <UserBubble text={m.text} source={m.source} attachments={m.attachments} tasks={tasks} />
                <DeliveryStatus id={m.id} delivery={m.delivery} act={action} />
              </motion.div>
            ) : (
              <motion.div key={m.id} className="relative min-w-0 max-w-[88%] self-start rounded-[22px] rounded-tl-md bg-md-surface-low p-4 text-sm leading-relaxed shadow-soft" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING_LAYOUT}>
                <AttachmentCards items={m.attachments} />
                {m.blocks?.length ? m.blocks.filter(block => block.type === "text").map((block, index) => block.type === "text" ? <RichText key={index} text={block.text} /> : null) : m.text.trim() && <RichText text={m.text} className="text-fg" />}
                {m.taskRef && tasks.find((t) => t.id === m.taskRef) && <TaskCard task={tasks.find((t) => t.id === m.taskRef)!} />}
              </motion.div>
            ),
          )}
          <AnimatePresence initial={false}>{tasks.filter((task) => task.approval === "pending" && task.status === "pending_approval").map((task) => (
            <motion.div key={`approval-${task.id}`} layout initial={{ opacity: 0, scale: 0.93, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: -6 }} transition={SPRING_LAYOUT} className="ml-8 max-w-[440px] rounded-[24px] bg-md-surface-high p-4 text-sm">
              <div className="flex items-center gap-3"><Critter seed={task.id} size={40} /><div className="min-w-0 flex-1"><div className="truncate font-medium" title={task.title}>{task.title}</div><div className="mt-0.5 truncate text-[11.5px] text-faint" title={task.cwd}>{task.id}{taskSourceLabel(task)} · {task.mode === "readonly" ? "只读" : "改写"} · {task.cwd}</div></div><StatusBadge status={task.status} /></div>
              <Disclosure className="mt-2 text-xs text-muted"><summary className="cursor-pointer py-1">原话 · 任务简报</summary><div className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed">
                {task.quotes?.map((quote) => <div key={quote.messageId} className="mb-1">{quote.messageId}{quote.source && ` · ${IM_SOURCE_LABELS[quote.source.platform]}`} · {quote.text}<AttachmentCards items={quote.attachments} /></div>)}
                {task.note && <div>备注：{task.note}</div>}
                {!!task.dependsOn?.length && <div>依赖：{task.dependsOn.join("、")}</div>}
              </div></Disclosure>
              <div className="mt-3.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-faint">需要批准才会开始执行</span>
                <div className="flex gap-2"><Button size="sm" onClick={() => action(window.rally.tasks.cancel(task.id))}>取消</Button><Button size="sm" variant="primary" onClick={() => action(window.rally.tasks.approve(task.id))}>批准</Button></div>
              </div>
            </motion.div>
          ))}</AnimatePresence>
          {questions.filter(({ question }) => !question.answer && !question.closed).sort((a, b) => a.question.askedAt - b.question.askedAt).map(({ taskId, title, question }) => <QuestionCard key={question.id} taskId={taskId} title={title} question={question} answer={(option) => window.rally.tasks.answerOption(taskId, question.id, option)} />)}
          {actionError && <div role="alert" className="ml-8 rounded-2xl bg-md-error-container px-3.5 py-2 text-xs text-md-on-error-container">{actionError}</div>}
        </div>
      </div>

      </div>

      {/* composer — compact MD3 single-line capsule */}
      <div className="chat-composer relative z-10 shrink-0 px-3.5 pb-3 pt-1">
        <div ref={composer} onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPicker(null);
        }} className="relative mx-auto max-w-[760px] rounded-[26px] bg-md-surface-high/94 px-2.5 py-1.5 transition-shadow duration-200 focus-within:bg-md-surface-high focus-within:shadow-float">
          <AnimatePresence>
            {picker && <TaskMentionPicker id={pickerId} choices={mentionChoices} active={activeChoice} query={picker.query}
              search={!picker.range} onQuery={value => { setPicker({ query: value }); setHighlighted(0); }}
              onKeyDown={event => pickerKey(event, true)} onSelect={addMention} />}
          </AnimatePresence>
          <input ref={fileInput} type="file" multiple hidden onChange={event => { attachments.add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />

          <AnimatePresence initial={false}>
            {(attachments.items.length > 0 || mentions.length > 0 || Boolean(attachments.error)) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={SPRING_FAST}
                className="overflow-hidden"
              >
                {!!attachments.items.length && <div className="flex max-h-44 flex-wrap gap-2 overflow-auto px-1.5 pb-1.5 pt-1">{attachments.items.map(item => <motion.div key={item.id} layout initial={{ scale: 0.86, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.86, opacity: 0 }} transition={SPRING_JELLY} className="max-w-full rounded-2xl bg-md-surface-lowest/85 p-2.5 text-xs"><PendingThumbnail file={item.file} /><div className="max-w-52 truncate font-medium">{item.file.name}</div><div className="mt-0.5 text-muted">{item.resource ? `${fileSize(item.file.size)} · 已就绪` : item.error ?? `上传 ${Math.round(item.offset / Math.max(1, item.file.size) * 100)}%`}</div><div className="mt-1.5 flex gap-2">{item.error && <ActionButton disabled={sendPending} onClick={() => attachments.retry(item.id)} className="text-accent">重试</ActionButton>}<ActionButton disabled={sendPending} onClick={() => attachments.remove(item.id)} className="text-muted hover:text-fg">{item.running ? "取消" : "移除"}</ActionButton></div></motion.div>)}</div>}
                {attachments.error && <p role="alert" className="px-2 pb-1 text-xs text-danger">{attachments.error}</p>}
                {!!mentions.length && <div className="flex max-h-24 flex-wrap gap-1.5 overflow-auto px-1.5 pb-1.5 pt-0.5">
                  {mentions.map(task => <TaskMentionTag key={task.id} task={task} onRemove={() => {
                    setMentions(current => current.filter(item => item.id !== task.id));
                    ta.current?.focus();
                  }} />)}
                </div>}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex min-w-0 items-end gap-1">
            <div className="flex h-[34px] shrink-0 items-center gap-0.5">
              <IconButton className="no-drag h-[30px] w-[30px] shrink-0" title="添加附件" disabled={sendPending} onClick={() => fileInput.current?.click()}>
                <Paperclip size={14.5} strokeWidth={1.85} />
              </IconButton>
              <IconButton id={pickerButtonId} className="no-drag h-[30px] w-[30px] shrink-0" title="引用任务 (@)" aria-haspopup="listbox" aria-expanded={!!picker}
                aria-controls={picker ? pickerId : undefined} active={!!picker} onClick={() => {
                  setPicker(picker ? null : { query: "" });
                  setHighlighted(0);
                }}>
                <AtSign size={14.5} strokeWidth={1.85} />
              </IconButton>
            </div>
            <textarea
              ref={ta}
              value={draft}
              onPaste={event => { const files = Array.from(event.clipboardData.files); if (files.length && !sendPending) { event.preventDefault(); attachments.add(files); } }}
              aria-controls={picker?.range ? pickerId : undefined}
              aria-activedescendant={picker?.range && activeChoice >= 0 ? `${pickerId}-${activeChoice}` : undefined}
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={event => {
                composing.current = false;
                updateQuery(event.currentTarget.value, event.currentTarget.selectionStart);
              }}
              onChange={event => {
                setDraft(event.currentTarget.value);
                if (!composing.current) updateQuery(event.currentTarget.value, event.currentTarget.selectionStart);
              }}
              onClick={event => {
                if (picker?.range && (event.currentTarget.selectionStart !== picker.range[1] || event.currentTarget.selectionEnd !== picker.range[1])) setPicker(null);
              }}
              onKeyDown={(e) => {
                if (pickerKey(e, false) || composing.current || e.keyCode === 229) return;
                if (picker?.range && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) setPicker(null);
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && (window.runtime.platform !== "android" || e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={`给 ${config.name || "Rally"} 发消息…`}
              className={cn(
                "block max-h-[160px] min-h-[28px] min-w-0 flex-1 resize-none self-center bg-transparent px-2 py-[3px] text-base md:text-[14px] leading-[1.45] text-fg placeholder:text-faint",
                !draft && "overflow-hidden whitespace-nowrap",
              )}
            />
            {(() => {
              const showStop = busy && !canSend;
              const activeBtn = canSend || showStop || canResumeQueue;
              return (
                <motion.button
                  type="button"
                  title={composerTitle}
                  aria-label={composerTitle}
                  onClick={canResumeQueue ? () => void resumeQueue() : showStop ? onStop : send}
                  disabled={sendPending || resumePending || !activeBtn}
                  initial={false}
                  animate={{
                    scale: activeBtn ? 1 : 0.92,
                    borderRadius: showStop || canResumeQueue ? 11 : canSend ? 13 : 20,
                  }}
                  whileHover={
                    activeBtn && !sendPending && !resumePending
                      ? { scale: 1.09, borderRadius: showStop || canResumeQueue ? 13 : 16 }
                      : undefined
                  }
                  whileTap={
                    activeBtn && !sendPending && !resumePending
                      ? { scale: 0.84, borderRadius: 8 }
                      : undefined
                  }
                  transition={SPRING_JELLY}
                  className={cn(
                    "md3-state-layer flex h-[34px] w-[34px] shrink-0 items-center justify-center transition-colors duration-150",
                    showStop
                      ? "bg-md-on-surface text-md-surface"
                      : canSend || canResumeQueue
                        ? "bg-md-primary text-md-on-primary"
                        : "bg-md-surface-lowest/55 text-md-on-surface-variant/40",
                  )}
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    {canResumeQueue ? (
                      <motion.span
                        key="resume"
                        initial={{ scale: 0.35, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.35, opacity: 0 }}
                        transition={SPRING_JELLY}
                        className="flex items-center justify-center"
                      >
                        <Pause size={15} fill="currentColor" />
                      </motion.span>
                    ) : showStop ? (
                      <motion.span
                        key="stop"
                        initial={{ scale: 0.3, opacity: 0, rotate: -45 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        exit={{ scale: 0.3, opacity: 0, rotate: 45 }}
                        transition={SPRING_JELLY}
                        className="flex items-center justify-center"
                      >
                        <Square size={11} fill="currentColor" />
                      </motion.span>
                    ) : (
                      <motion.span
                        key="send"
                        initial={{ scale: 0.4, opacity: 0, y: 4 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.4, opacity: 0, y: -4 }}
                        transition={SPRING_JELLY}
                        className="flex items-center justify-center"
                      >
                        <ArrowUp size={16.5} strokeWidth={2.35} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {queuedCount > 0 && <span aria-label={`${queuedCount} 条待处理`} className="absolute right-0.5 top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-md-tertiary-container px-0.5 text-[9px] font-semibold leading-[14px] text-md-on-tertiary-container">{queuedCount}</span>}
                </motion.button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
