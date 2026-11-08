import { useState } from "react";
import { Search, Minus, Square, X, Copy, Check } from "lucide-react";
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
  mnemonic: string;
  groups?: MenuItem[][];
  action?: () => void;
}

export function WindowControls({ maximized, onMin, onMax, onClose }: { maximized: boolean; onMin: () => void; onMax: () => void; onClose: () => void }) {
  return (
    <div className="flex h-full items-stretch">
      <button onClick={onMin} className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg">
        <Minus size={15} strokeWidth={1.4} />
      </button>
      <button onClick={onMax} className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg">
        {maximized ? <Copy size={12} strokeWidth={1.4} className="-scale-x-100" /> : <Square size={12} strokeWidth={1.4} />}
      </button>
      <button onClick={onClose} className="flex w-11 items-center justify-center text-muted transition-colors hover:bg-[#e81123] hover:text-white">
        <X size={16} strokeWidth={1.3} />
      </button>
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
  center,
  onDoubleClick,
}: {
  menus: Menu[];
  onSearch: () => void;
  maximized: boolean;
  onMin: () => void;
  onMax: () => void;
  onClose: () => void;
  center?: React.ReactNode;
  onDoubleClick?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useClickOutside<HTMLDivElement>(!!open, () => setOpen(null));

  return (
    <div className="drag relative flex h-10 shrink-0 items-center bg-app pl-2.5" onDoubleClick={onDoubleClick}>
      <button
        onClick={onSearch}
        onDoubleClick={(e) => e.stopPropagation()}
        className="no-drag flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
        title="搜索 (Ctrl+K)"
      >
        <Search size={15} strokeWidth={1.8} />
      </button>

      <div ref={ref} className="no-drag ml-3 flex items-center gap-0.5" onDoubleClick={(e) => e.stopPropagation()}>
        {menus.map((m) => (
          <div key={m.key} className="relative">
            <button
              onClick={() => {
                if (m.action) {
                  setOpen(null);
                  m.action();
                } else setOpen(open === m.key ? null : m.key);
              }}
              onMouseEnter={() => open && !m.action && setOpen(m.key)}
              className={cn("h-7 rounded-md px-2 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg", open === m.key && "bg-hover text-fg")}
            >
              {m.label}({m.mnemonic})
            </button>
            {open === m.key && m.groups && (
              <div className="animate-pop absolute left-0 top-8 z-[60] w-60 rounded-xl bg-raised p-1.5 shadow-pop">
                {m.groups.map((g, gi) => (
                  <div key={gi} className={cn(gi > 0 && "mt-1.5")}>
                    {g.map((it) => (
                      <button
                        key={it.label}
                        disabled={it.disabled}
                        onClick={() => {
                          setOpen(null);
                          it.action?.();
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-fg transition-colors hover:bg-hover disabled:text-faint disabled:hover:bg-transparent"
                      >
                        <span className="flex w-4 justify-center">{it.checked && <Check size={13} className="text-accent" />}</span>
                        <span className="flex-1">{it.label}</span>
                        {it.shortcut && <span className="text-[11px] text-faint">{it.shortcut}</span>}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-x-0 flex justify-center text-xs text-faint">{center}</div>
      <div className="flex-1" />
      <div onDoubleClick={(e) => e.stopPropagation()} className="no-drag h-full">
        <WindowControls maximized={maximized} onMin={onMin} onMax={onMax} onClose={onClose} />
      </div>
    </div>
  );
}
