import { useEffect, type KeyboardEvent } from "react";
import { AtSign, X } from "lucide-react";
import type { Task } from "../data";
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
  const name = <><AtSign size={13} className="shrink-0" aria-hidden="true" /><span className="truncate">{task.title}</span></>;
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-line bg-sunken px-2 py-0.5 text-xs font-medium text-fg" title={label}>
    {onOpen ? <button type="button" className="flex min-w-0 items-center gap-1.5 hover:text-accent" aria-label={`打开任务 ${label}`} onClick={onOpen}>{name}</button>
      : <span className="flex min-w-0 items-center gap-1.5">{name}</span>}
    {onRemove && <button type="button" aria-label={`移除任务 ${label}`} className="shrink-0 rounded text-muted hover:text-fg" onClick={onRemove}><X size={13} /></button>}
  </span>;
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

  return <div className="glass-strong absolute inset-x-0 bottom-full z-20 mb-2 flex max-h-[min(320px,45dvh)] flex-col overflow-hidden rounded-2xl border border-line p-1.5 shadow-pop sm:right-auto sm:w-96 sm:max-w-full">
    {search ? <Input autoFocus role="combobox" aria-label="搜索任务" aria-expanded="true" aria-controls={id} aria-activedescendant={activeId} aria-autocomplete="list"
      className="mb-1.5 shrink-0" placeholder="搜索任务标题或编号" value={query} onChange={event => onQuery(event.target.value)} onKeyDown={onKeyDown} />
      : <div className="px-2 py-1 text-xs text-muted">引用任务</div>}
    <div id={id} role="listbox" aria-label="任务列表" className="min-h-0 overflow-auto overscroll-contain">
      {!choices.length && <div role="status" className="px-2 py-3 text-sm text-muted">{query ? "没有匹配的任务" : "没有可引用的任务"}</div>}
      {choices.map((task, index) => <button key={task.id} id={`${id}-${index}`} role="option" aria-selected={index === active} tabIndex={-1} type="button"
        onMouseDown={event => event.preventDefault()} onClick={() => onSelect(task)}
        className={cn("flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-hover", index === active && "bg-hover")}>
        <AtSign size={14} className="shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{task.title}</span><span className="block text-xs text-muted">{task.id}</span></span>
        <StatusBadge status={task.status} />
      </button>)}
    </div>
  </div>;
}
