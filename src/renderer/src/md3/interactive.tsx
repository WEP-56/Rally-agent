import { Children, isValidElement, useState, type ReactNode, type InputHTMLAttributes } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { Check, ChevronRight } from "lucide-react";
import { SPRING_JELLY, SPRING_LAYOUT } from "./springs";
import { cn } from "../utils/cn";

/** The sample's grouped-row interaction, for actions without a filled-button surface. */
export function ActionButton({ children, className, disabled, type = "button", ...props }: HTMLMotionProps<"button">) {
  const radius = className?.includes("rounded-full") ? 20 : 16;
  return <motion.button initial={false} animate={{ scale: 1, borderRadius: radius }} whileHover={disabled ? undefined : { scale: 1.015 }} whileTap={disabled ? undefined : { scale: 0.95, borderRadius: 10 }} transition={SPRING_JELLY}
    {...props} type={type} disabled={disabled} className={cn("md3-state-layer disabled:opacity-40", className)}>{children}</motion.button>;
}

export function Checkbox({ checked, className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <span className={cn("relative inline-flex h-6 w-6 shrink-0 items-center justify-center", className)}>
    <input {...props} checked={checked} type="checkbox" className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" />
    <motion.span initial={false} animate={{ scale: checked ? 1 : 0.88, borderRadius: checked ? 7 : 9 }} transition={SPRING_JELLY}
      className={cn("pointer-events-none flex h-5 w-5 items-center justify-center peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-md-primary peer-disabled:opacity-40", checked ? "bg-md-primary text-md-on-primary" : "bg-md-surface-highest text-transparent")}>
      <Check size={15} strokeWidth={3} />
    </motion.span>
  </span>;
}

/** Preserve details/summary semantics while keeping the content mounted during collapse. */
export function Disclosure({ children, className, ...props }: Omit<HTMLMotionProps<"details">, "open" | "onToggle" | "children"> & { children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(false);
  const parts = Children.toArray(children);
  const summary = parts.find(child => isValidElement(child) && child.type === "summary");
  const content = parts.filter(child => child !== summary);
  const summaryProps = isValidElement<{ children: ReactNode; className?: string }>(summary) ? summary.props : { children: "详情", className: "" };
  return <motion.details {...props} open={visible} className={cn("overflow-hidden rounded-[20px] bg-md-surface-low", className)}>
    <motion.summary aria-expanded={expanded} onClick={event => { event.preventDefault(); if (!expanded) setVisible(true); setExpanded(!expanded); }}
      whileTap={{ scale: 0.98 }} transition={SPRING_JELLY}
      className={cn("md3-state-layer flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[16px] px-3 py-2 text-left text-xs font-medium text-md-on-surface-variant [&::-webkit-details-marker]:hidden", summaryProps.className)}>
      <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={SPRING_JELLY} className="flex shrink-0"><ChevronRight size={14} /></motion.span>
      {summaryProps.children}
    </motion.summary>
    <motion.div initial={false} animate={{ height: expanded ? "auto" : 0, opacity: expanded ? 1 : 0 }} transition={SPRING_LAYOUT}
      onAnimationComplete={() => { if (!expanded) setVisible(false); }} className="overflow-hidden">
      <div className="px-3 pb-3">{content}</div>
    </motion.div>
  </motion.details>;
}
