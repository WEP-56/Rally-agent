import { ActionButton } from "../md3/interactive";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_FAST } from "../md3/springs";
import { BrowserOverlayLease, useBrowserOverlay } from "../browser-overlays";
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
  useBrowserOverlay(open);
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

  const groups = Array.from(new Set(items.map((i) => i.group)));
  let idx = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-[80] flex items-start justify-center bg-black/32 px-4 pt-[13vh] backdrop-blur-[4px]"
          onMouseDown={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <BrowserOverlayLease />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -8 }}
            transition={SPRING_FAST}
            className="w-full max-w-[560px] overflow-hidden rounded-[28px] bg-md-surface-high shadow-pop"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="m-2.5 flex items-center gap-3 rounded-full bg-md-surface-lowest px-4 py-3">
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
                className="flex-1 bg-transparent text-[14.5px] text-fg placeholder:text-faint"
              />
              <Kbd>Esc</Kbd>
            </div>
            <div className="max-h-[52vh] overflow-y-auto px-2.5 pb-2.5">
              {groups.map((g) => (
                <div key={g} className="mb-1.5">
                  <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-faint">{g}</div>
                  <div className="flex flex-col gap-0.5">
                    {items
                      .filter((i) => i.group === g)
                      .map((c) => {
                        idx++;
                        const my = idx;
                        const active = sel === my;
                        return (
                          <ActionButton
                            key={c.group + c.id}
                            onMouseEnter={() => setSel(my)}
                            onClick={() => {
                              c.run();
                              onClose();
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-[13.5px] transition-colors",
                              active ? "bg-md-secondary-container font-medium text-md-on-secondary-container" : "text-fg hover:bg-fg/[0.05]",
                            )}
                          >
                            <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center", active ? "text-md-on-secondary-container" : "text-muted")}>{c.icon}</span>
                            <span className="flex-1 truncate">{c.label}</span>
                            {c.hint && <span className={cn("font-mono text-[11px]", active ? "text-md-on-secondary-container/75" : "text-faint")}>{c.hint}</span>}
                          </ActionButton>
                        );
                      })}
                  </div>
                </div>
              ))}
              {items.length === 0 && <div className="py-8 text-center text-sm text-faint">没有匹配结果</div>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
