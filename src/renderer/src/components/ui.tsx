import { Check, ChevronDown } from "lucide-react";
import { useBrowserOverlay } from "../browser-overlays";
export { RallyMark as RallyLogo } from "./brand";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../utils/cn";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dark" | "glass";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "secondary", size = "md", className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-7 px-3 text-xs",
        size === "md" && "h-9 px-4 text-[13px]",
        size === "lg" && "h-11 px-6 text-sm",
        variant === "primary" && "bg-accent text-accent-fg shadow-[0_3px_10px_color-mix(in_srgb,var(--c-accent)_26%,transparent)] hover:brightness-110",
        variant === "dark" && "bg-ink text-white hover:bg-ink/85 dark:bg-white dark:text-ink dark:hover:bg-white/85",
        variant === "secondary" && "bg-sunken text-fg hover:bg-deep",
        variant === "glass" && "glass text-fg hover:brightness-[1.03]",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-fg",
        variant === "danger" && "bg-danger/10 text-danger hover:bg-danger/15",
        className,
      )}
    />
  );
}

/** Round floating button — the "IM" style chrome used on both panes. */
export function RoundButton({ className, active, size = 40, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: number }) {
  return (
    <button
      {...p}
      style={{ width: size, height: size }}
      className={cn(
        "glass-strong inline-flex shrink-0 items-center justify-center rounded-full text-fg/80 transition-all hover:text-fg hover:brightness-[1.04] active:scale-95",
        active && "text-accent",
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
        "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg active:bg-press",
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
        "h-10 w-full rounded-xl bg-sunken px-3.5 text-sm text-fg shadow-[inset_0_0_0_1px_var(--c-line)] transition-all placeholder:text-faint focus:bg-panel focus:shadow-[inset_0_0_0_1px_var(--c-accent),0_0_0_4px_color-mix(in_srgb,var(--c-accent)_16%,transparent)]",
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
        "w-full resize-none rounded-xl bg-sunken px-3.5 py-2.5 text-sm leading-relaxed text-fg shadow-[inset_0_0_0_1px_var(--c-line)] transition-all placeholder:text-faint focus:bg-panel focus:shadow-[inset_0_0_0_1px_var(--c-accent),0_0_0_4px_color-mix(in_srgb,var(--c-accent)_16%,transparent)]",
        className,
      )}
    />
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        checked ? "bg-accent" : "bg-fg/15",
      )}
    >
      <span
        className={cn(
          "absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200 ease-[cubic-bezier(.3,1.4,.5,1)]",
          checked && "translate-x-[18px]",
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-full bg-fg/[0.06] p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full px-3 text-xs font-medium transition-all",
            value === o.value ? "bg-panel text-fg shadow-soft" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-fg/[0.07] px-1.5 font-mono text-[10.5px] font-medium text-muted", className)}>
      {children}
    </kbd>
  );
}

export function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  useBrowserOverlay(open);
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

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.14em] text-faint", className)}>{children}</div>;
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
