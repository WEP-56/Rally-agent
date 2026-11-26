import { ChoiceSelect } from "../md3/Select";
import { motion } from "motion/react";
import { SPRING_JELLY } from "../md3/springs";
import { MdSwitch, MdConnectedSegments } from "../md3/components";
import { useBrowserOverlay } from "../browser-overlays";
export { RallyMark as RallyLogo } from "./brand";
import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../utils/cn";

const SpringButton = motion.create("button");

type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dark" | "glass";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "secondary", size = "md", className, disabled, ...p }: BtnProps) {
  return (
    <SpringButton initial={false} animate={{ borderRadius: 20, scale: 1, y: 0 }} whileHover={disabled ? undefined : { scale: 1.035, y: -1, borderRadius: 24 }} whileTap={disabled ? undefined : { scale: 0.91, y: 0.5, borderRadius: 9 }} transition={SPRING_JELLY} disabled={disabled}
      {...p}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium md3-state-layer disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-[30px] px-3 text-[12px]",
        size === "md" && "h-[34px] px-3.5 text-[12.5px]",
        size === "lg" && "h-10 px-4.5 text-[13.5px]",
        variant === "primary" && "bg-md-primary text-md-on-primary",
        variant === "dark" && "bg-md-inverse-surface text-md-inverse-on-surface",
        variant === "secondary" && "bg-md-secondary-container text-md-on-secondary-container",
        variant === "glass" && "glass text-fg hover:brightness-[1.03]",
        variant === "ghost" && "text-muted hover:bg-hover hover:text-fg",
        variant === "danger" && "bg-md-error-container text-md-on-error-container",
        className,
      )}
    />
  );
}

/** Round floating button — the "IM" style chrome used on both panes. */
export function RoundButton({ className, active, size = 38, disabled, ...p }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"> & { active?: boolean; size?: number }) {
  return (
    <SpringButton initial={false} animate={{ borderRadius: active ? 12 : size / 2, scale: 1 }} whileHover={disabled ? undefined : { scale: 1.09, borderRadius: active ? 14 : size / 2 }} whileTap={disabled ? undefined : { scale: 0.85, borderRadius: 8 }} transition={SPRING_JELLY} disabled={disabled}
      {...p}
      style={{ width: size, height: size }}
      className={cn(
        "glass-strong inline-flex shrink-0 items-center justify-center rounded-full text-fg/80 md3-state-layer hover:text-fg",
        active && "text-accent",
        className,
      )}
    />
  );
}

export function IconButton({ className, active, disabled, ...p }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"> & { active?: boolean }) {
  return (
    <SpringButton initial={false} animate={{ borderRadius: active ? 12 : 17, scale: 1 }} whileHover={disabled ? undefined : { scale: 1.09 }} whileTap={disabled ? undefined : { scale: 0.85, borderRadius: 8 }} transition={SPRING_JELLY} disabled={disabled}
      {...p}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-full text-muted md3-state-layer hover:bg-hover hover:text-fg active:bg-press",
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
        "h-10 w-full rounded-xl bg-sunken px-3.5 text-sm text-fg transition-colors placeholder:text-faint focus:bg-md-surface-highest focus-visible:outline-2 focus-visible:outline-md-primary",
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
        "w-full resize-none rounded-xl bg-sunken px-3.5 py-2.5 text-sm leading-relaxed text-fg transition-colors placeholder:text-faint focus:bg-md-surface-highest focus-visible:outline-2 focus-visible:outline-md-primary",
        className,
      )}
    />
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <MdSwitch checked={checked} onChange={onChange} label={label ?? "切换"} disabled={disabled} />;
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
  return <div className={className}><MdConnectedSegments value={value} onChange={onChange} options={options} /></div>;
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
  return <ChoiceSelect value={value} options={options} onValueChange={onChange} align={align} up={up} placeholder={placeholder} className={cn(ghost && "min-h-7 bg-transparent text-xs", className)} />;
}
