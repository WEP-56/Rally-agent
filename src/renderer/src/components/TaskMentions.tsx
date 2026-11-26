import { BrowserOverlayLease } from "../browser-overlays";
import { ActionButton } from "../md3/interactive";
import { SPRING_FAST, SPRING_JELLY } from "../md3/springs";
import { motion } from "motion/react";
import { useEffect, type KeyboardEvent } from "react";
import { AtSign, X } from "lucide-react";
import type { Task } from "../data";
import { Critter } from "./brand";
import { cn } from "../utils/cn";
import { StatusBadge } from "./status";
import { Input } from "./ui";

export type TaskMention = Pick<Task, "id" | "title">;
export type MentionQuery = { query: string; range?: [start: number, end: number] };

export function mentionAt(text: string, caret: number): MentionQuery | null {
  // Avoid matching addresses; allow mentions immediately after Chinese text.
  const match = /(?:^|[^a-z\d_.@＠+-])[@＠]([^\s@＠]{0,80})$/i.exec(text.slice(0, caret));
  if (!match) return null;
  return { query: match[1], range: [caret - match[1].length - 1, caret] };
}

export function withTaskMentions(text: string, mentions: TaskMention[]) {
  if (!mentions.length) return text;
  return [text.trimEnd(), mentions.map(task => `@${task.id.toUpperCase()}`).join("\n")].filter(Boolean).join("\n\n");
}

export function splitTaskMentions(text: string): { body: string; ids: string[] } {
  const block = /(?:^|\n\n)((?:@T-\d+\n)*@T-\d+)$/.exec(text.trimEnd());
  return block ? { body: text.slice(0, block.index), ids: block[1].split("\n").map(id => id.slice(1)) } : { body: text, ids: [] };
}

export function TaskMentionTag({ task, onRemove, onOpen }: { task: TaskMention; onRemove?: () => void; onOpen?: () => void }) {
  const label = `${task.id} · ${task.title}`;
  const name = <><AtSign size={12} className="shrink-0 opacity-80" aria-hidden="true" /><span className="font-mono text-[11px]">{task.id.toUpperCase()}</span><span className="max-w-36 truncate opacity-85">· {task.title}</span></>;
  return <motion.span layout initial={{ scale: 0.78, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.78, opacity: 0 }} transition={SPRING_JELLY}
    className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-md-secondary-container py-0.5 pl-2.5 pr-1.5 text-[11.5px] font-medium text-md-on-secondary-container" title={label}>
    {onOpen ? <ActionButton type="button" className="flex min-w-0 items-center gap-1 hover:underline" aria-label={`打开任务 ${label}`} onClick={onOpen}>{name}</ActionButton>
      : <span className="flex min-w-0 items-center gap-1">{name}</span>}
    {onRemove && <ActionButton type="button" aria-label={`移除任务 ${label}`} className="shrink-0 rounded-full p-0.5 text-md-on-secondary-container/75 hover:bg-md-on-secondary-container/12 hover:text-md-on-secondary-container" onClick={onRemove}><X size={11.5} /></ActionButton>}
  </motion.span>;
}

export function TaskMentionPicker({ id, choices, active, query, search, onQuery, onKeyDown, onSelect }: {
  id: string;
  choices: Task[];
  active: number;
  query: string;
  search: boolean;
  onQuery: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelect: (task: Task) => void;
}) {
  const activeId = active >= 0 ? `${id}-${active}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId, query]);

  return <motion.div
    initial={{ opacity: 0, scale: 0.88, y: 10 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    exit={{ opacity: 0, scale: 0.9, y: 8 }}
    transition={SPRING_FAST}
    style={{ transformOrigin: "0% 100%" }}
    className="absolute inset-x-0 bottom-[calc(100%+8px)] z-30 flex max-h-[min(320px,45dvh)] flex-col overflow-hidden rounded-[24px] bg-md-surface-high p-2 shadow-pop sm:left-2 sm:right-auto sm:w-84 sm:max-w-[calc(100vw-32px)]"
  >
    <BrowserOverlayLease />
    {search ? <Input autoFocus role="combobox" aria-label="搜索任务" aria-expanded="true" aria-controls={id} aria-activedescendant={activeId} aria-autocomplete="list"
      className="mb-1.5 h-9 shrink-0 rounded-full bg-md-surface-lowest" placeholder="搜索任务标题或编号" value={query} onChange={event => onQuery(event.target.value)} onKeyDown={onKeyDown} />
      : <div className="mb-1 px-2 py-0.5 text-[11px] font-medium text-muted">引用工位任务到当前对话</div>}
    <div id={id} role="listbox" aria-label="任务列表" className="flex min-h-0 flex-col gap-1 overflow-auto overscroll-contain">
      {!choices.length && <div role="status" className="px-2.5 py-3 text-xs text-muted">{query ? "没有匹配的任务" : "没有可引用的任务"}</div>}
      {choices.map((task, index) => <ActionButton key={task.id} id={`${id}-${index}`} role="option" aria-selected={index === active} tabIndex={-1} type="button"
        onMouseDown={event => event.preventDefault()} onClick={() => onSelect(task)}
        className={cn("flex w-full items-center gap-2.5 rounded-[16px] px-2.5 py-2 text-left transition-colors", index === active ? "bg-md-secondary-container text-md-on-secondary-container" : "bg-md-surface-lowest/80 hover:bg-md-surface-lowest")}>
        <Critter seed={task.id} size={26} />
        <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium">{task.title}</span><span className="block font-mono text-[10.5px] opacity-70">{task.id}</span></span>
        <StatusBadge status={task.status} />
      </ActionButton>)}
    </div>
  </motion.div>;
}
