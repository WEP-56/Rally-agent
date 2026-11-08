import { useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../utils/cn";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" };

export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap",
        size === "sm" && "h-7 px-2.5 text-xs",
        size === "md" && "h-8 px-3.5 text-sm",
        size === "lg" && "h-10 px-5 text-sm",
        variant === "primary" && "bg-accent text-accent-fg shadow-soft hover:brightness-110",
        variant === "secondary" && "bg-sunken text-fg hover:bg-deep dark:hover:bg-raised",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-fg",
        variant === "danger" && "bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15",
        className,
      )}
    />
  );
}

export function IconButton({ className, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg active:bg-press",
        active && "bg-hover text-fg",
        className,
      )}
    />
  );
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={cn(
        "h-9 w-full rounded-lg bg-sunken px-3 text-sm text-fg placeholder:text-faint transition-all focus:bg-panel focus:shadow-[0_0_0_3px_var(--c-accent-soft),var(--s-soft)]",
        className,
      )}
    />
  );
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={cn(
        "w-full resize-none rounded-lg bg-sunken px-3 py-2 text-sm leading-relaxed text-fg placeholder:text-faint transition-all focus:bg-panel focus:shadow-[0_0_0_3px_var(--c-accent-soft),var(--s-soft)]",
        className,
      )}
    />
  );
}

export function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("mousedown", h);
      window.removeEventListener("keydown", k);
    };
  }, [open, onClose]);
  return ref;
}

export interface Opt {
  value: string;
  label: string;
  group?: string;
  hint?: string;
}

export function Select({ value, options, onChange, placeholder = "请选择", className, align = "left", ghost, up }: { value: string; options: Opt[]; onChange: (v: string) => void; placeholder?: string; className?: string; align?: "left" | "right"; ghost?: boolean; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const cur = options.find((o) => o.value === value);
  const groups = Array.from(new Set(options.map((o) => o.group || "")));
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          ghost
            ? "flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors hover:bg-hover hover:text-fg"
            : "flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-sunken px-3 text-left text-sm transition-colors hover:bg-deep dark:hover:bg-raised",
          open && (ghost ? "bg-hover text-fg" : "bg-deep dark:bg-raised"),
        )}
      >
        <span className={cn("truncate", !cur && "text-faint")}>
          {cur ? cur.label : placeholder}
          {cur?.group && !ghost && <span className="ml-2 text-xs text-faint">{cur.group}</span>}
        </span>
        <ChevronDown size={14} className={cn("shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className={cn("animate-pop absolute z-50 max-h-72 min-w-full overflow-auto rounded-xl bg-raised p-1.5 shadow-pop", up ? "bottom-full mb-1.5" : "mt-1.5", align === "right" ? "right-0" : "left-0")}>
          {groups.map((g) => (
            <div key={g}>
              {g && <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-faint">{g}</div>}
              {options
                .filter((o) => (o.group || "") === g)
                .map((o) => (
                  <button
                    key={o.value}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className="flex w-full items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-hover"
                  >
                    <span className="flex-1">{o.label}</span>
                    {o.hint && <span className="text-xs text-faint">{o.hint}</span>}
                    <Check size={14} className={cn("text-accent", o.value === value ? "opacity-100" : "opacity-0")} />
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-press")}
    >
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-soft transition-all", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all",
            value === o.value ? "bg-raised text-fg shadow-soft" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded bg-sunken px-1.5 py-px font-mono text-[10px] text-faint">{children}</span>;
}

export function RallyLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <div
      className={cn("relative flex shrink-0 items-center justify-center rounded-[28%] bg-accent text-accent-fg shadow-soft", className)}
      style={{ width: size, height: size, background: "linear-gradient(140deg, color-mix(in srgb, var(--c-accent) 75%, white), var(--c-accent) 55%, color-mix(in srgb, var(--c-accent) 70%, black))" }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58} fill="none">
        <path d="M6 19V5h6.2a4.3 4.3 0 0 1 1.2 8.43L18 19" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="18" cy="5.5" r="1.8" fill="currentColor" />
      </svg>
    </div>
  );
}
