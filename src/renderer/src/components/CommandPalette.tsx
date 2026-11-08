import { useEffect, useMemo, useRef, useState } from "react";
import { Search, CornerDownLeft } from "lucide-react";
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
    <div className="animate-fade absolute inset-0 z-[80] flex justify-center bg-black/10 pt-[12vh] dark:bg-black/40" onMouseDown={onClose}>
      <div className="animate-pop h-fit w-[560px] max-w-[90%] overflow-hidden rounded-2xl bg-raised shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex h-12 items-center gap-3 px-4">
          <Search size={16} className="text-faint" />
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
        <div className="max-h-[50vh] overflow-y-auto bg-sunken/60 p-1.5">
          {groups.map((g) => (
            <div key={g} className="mb-1">
              <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-faint">{g}</div>
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
                      className={cn("flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[13px]", sel === my ? "bg-panel shadow-soft dark:bg-raised" : "")}
                    >
                      <span className="flex w-4 justify-center text-muted">{c.icon}</span>
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="text-[11px] text-faint">{c.hint}</span>}
                      {sel === my && <CornerDownLeft size={12} className="text-faint" />}
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
