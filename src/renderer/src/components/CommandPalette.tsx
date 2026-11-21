import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Task } from "../data";
import { cn } from "../utils/cn";
import { StatusIcon } from "./status";
import { Kbd } from "./ui";

export interface Cmd {
  id: string;
  label: string;
  group: string;
  icon?: React.ReactNode;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose, commands, tasks, onTask }: { open: boolean; onClose: () => void; commands: Cmd[]; tasks: Task[]; onTask: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inp.current?.focus(), 10);
    }
  }, [open]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    const taskCmds: Cmd[] = tasks.map((t) => ({ id: t.id, label: t.title, group: "任务", icon: <StatusIcon status={t.status} size={14} />, hint: t.id.toUpperCase(), run: () => onTask(t.id) }));
    return [...commands, ...taskCmds].filter((c) => !s || (c.label + c.group + (c.hint || "")).toLowerCase().includes(s));
  }, [q, commands, tasks, onTask]);

  if (!open) return null;
  const groups = Array.from(new Set(items.map((i) => i.group)));
  let idx = -1;

  return (
    <div className="animate-fade absolute inset-0 z-[80] flex items-start justify-center bg-ink/25 px-4 pt-[14vh] backdrop-blur-[3px]" onMouseDown={onClose}>
      <div className="glass-strong animate-pop w-full max-w-[560px] overflow-hidden rounded-[28px] shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4">
          <Search size={17} className="text-faint" />
          <input
            ref={inp}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => Math.min(items.length - 1, v + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 1));
              }
              if (e.key === "Enter" && items[sel]) {
                items[sel].run();
                onClose();
              }
            }}
            placeholder="搜索任务、命令与设置…"
            className="flex-1 bg-transparent text-[15px] text-fg placeholder:text-faint"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto border-t border-line p-2">
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{g}</div>
              {items
                .filter((i) => i.group === g)
                .map((c) => {
                  idx++;
                  const my = idx;
                  return (
                    <button
                      key={c.group + c.id}
                      onMouseEnter={() => setSel(my)}
                      onClick={() => {
                        c.run();
                        onClose();
                      }}
                      className={cn("flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-[13.5px] transition-colors", sel === my && "bg-fg/[0.06]")}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-muted">{c.icon}</span>
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="text-[11px] text-faint">{c.hint}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
          {items.length === 0 && <div className="py-8 text-center text-sm text-faint">没有匹配结果</div>}
        </div>
      </div>
    </div>
  );
}
