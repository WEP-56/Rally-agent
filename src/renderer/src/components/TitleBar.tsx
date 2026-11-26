import { BrowserOverlayLease } from "../browser-overlays";
import { ActionButton } from "../md3/interactive";
import { AnimatePresence, motion } from "motion/react";
import { SPRING_FAST } from "../md3/springs";
import { useState } from "react";
import { Search, Minus, Square, X, Copy, Check, type LucideIcon } from "lucide-react";
import { cn } from "../utils/cn";
import { useClickOutside } from "./ui";

export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  checked?: boolean;
  disabled?: boolean;
}
export interface Menu {
  key: string;
  label: string;
  icon: LucideIcon;
  groups?: MenuItem[][];
  action?: () => void;
}

export function WindowControls({ maximized, onMin, onMax, onClose }: { maximized: boolean; onMin: () => void; onMax: () => void; onClose: () => void }) {
  return (
    <div className="flex h-full items-stretch">
      <ActionButton onClick={onMin} title="最小化" aria-label="最小化" className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg">
        <Minus size={15} strokeWidth={1.4} />
      </ActionButton>
      <ActionButton onClick={onMax} title={maximized ? "还原" : "最大化"} aria-label={maximized ? "还原" : "最大化"} className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg">
        {maximized ? <Copy size={12} strokeWidth={1.4} className="-scale-x-100" /> : <Square size={12} strokeWidth={1.4} />}
      </ActionButton>
      <ActionButton onClick={onClose} title="关闭窗口" aria-label="关闭窗口" className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-[#e81123] hover:text-white">
        <X size={16} strokeWidth={1.3} />
      </ActionButton>
    </div>
  );
}

export function TitleBar({
  menus,
  onSearch,
  maximized,
  onMin,
  onMax,
  onClose,
  onDoubleClick,
}: {
  menus: Menu[];
  onSearch: () => void;
  maximized: boolean;
  onMin: () => void;
  onMax: () => void;
  onClose: () => void;
  onDoubleClick?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useClickOutside<HTMLDivElement>(!!open, () => setOpen(null));

  return (
    <div className="drag relative flex h-9 shrink-0 items-center bg-app pl-2.5" onDoubleClick={onDoubleClick}>
      <ActionButton
        onClick={onSearch}
        onDoubleClick={(e) => e.stopPropagation()}
        className="no-drag flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg"
        title="搜索 (Ctrl+K)"
        aria-label="搜索"
      >
        <Search size={15} strokeWidth={1.8} />
      </ActionButton>

      <div ref={ref} className="no-drag ml-1 flex items-center gap-1" onDoubleClick={(e) => e.stopPropagation()}>
        {menus.map((m) => (
          <div key={m.key} className="relative">
            <ActionButton
              title={m.label}
              aria-label={m.label}
              aria-expanded={m.groups ? open === m.key : undefined}
              onClick={() => {
                if (m.action) {
                  setOpen(null);
                  m.action();
                } else setOpen(open === m.key ? null : m.key);
              }}
              onMouseEnter={() => open && !m.action && setOpen(m.key)}
              className={cn("flex h-[30px] w-[30px] items-center justify-center rounded-full transition-colors", open === m.key ? "bg-md-secondary-container text-md-on-secondary-container" : "text-md-on-surface-variant hover:bg-md-surface-high hover:text-md-on-surface")}
            >
              <m.icon size={17} strokeWidth={1.8} aria-hidden="true" />
            </ActionButton>
            <AnimatePresence>{open === m.key && m.groups && (
              <motion.div initial={{ opacity: 0, y: -5, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -5, scale: 0.96 }} transition={SPRING_FAST} className="absolute left-0 top-8 z-[60] w-60 rounded-xl bg-raised p-1.5 shadow-pop">
                <BrowserOverlayLease />
                {m.groups.map((g, gi) => (
                  <div key={gi} className={cn("md3-grouped-list", gi > 0 && "mt-1.5")}>
                    {g.map((it) => (
                      <ActionButton
                        key={it.label}
                        disabled={it.disabled}
                        onClick={() => {
                          setOpen(null);
                          it.action?.();
                        }}
                        className="md3-grouped-item bg-md-surface-low flex h-8 w-full items-center gap-2 rounded-full px-2.5 text-left text-[13px] text-fg transition-colors hover:bg-hover disabled:text-faint disabled:hover:bg-transparent"
                      >
                        <span className="flex w-4 justify-center">{it.checked && <Check size={13} className="text-accent" />}</span>
                        <span className="flex-1">{it.label}</span>
                        {it.shortcut && <span className="text-[11px] text-faint">{it.shortcut}</span>}
                      </ActionButton>
                    ))}
                  </div>
                ))}
              </motion.div>
            )}</AnimatePresence>
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <div onDoubleClick={(e) => e.stopPropagation()} className="no-drag h-full">
        <WindowControls maximized={maximized} onMin={onMin} onMax={onMax} onClose={onClose} />
      </div>
    </div>
  );
}
