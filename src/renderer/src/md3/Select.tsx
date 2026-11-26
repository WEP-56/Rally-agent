import { Children, Fragment, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown } from "lucide-react";
import { useBrowserOverlay } from "../browser-overlays";
import { SPRING_FAST, SPRING_JELLY } from "./springs";
import { cn } from "../utils/cn";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  group?: string;
  hint?: string;
}

// Legacy option declarations remain data; no native select/menu is rendered.
export function optionsFromChildren(children: ReactNode, group?: string): SelectOption[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; label?: string; disabled?: boolean }>(child)) return [];
    if (child.type === Fragment) return optionsFromChildren(child.props.children, group);
    if (child.type === "optgroup") return optionsFromChildren(child.props.children, child.props.label);
    if (child.type !== "option") return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.children, disabled: child.props.disabled, group }];
  });
}

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value" | "defaultValue" | "multiple" | "size" | "onKeyDown" | "onFocus" | "onBlur"> & {
  value: string | number;
  options?: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  align?: "left" | "right";
  up?: boolean;
};

export function ChoiceSelect({ value, options, children, onValueChange, className, disabled, required, name, id, placeholder = "请选择", align = "left", up, "aria-label": ariaLabel, title }: Props) {
  const choices = options ?? optionsFromChildren(children);
  const selected = choices.findIndex(option => option.value === String(value));
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [active, setActive] = useState(0);
  const [bounds, setBounds] = useState<{ left: number; top?: number; bottom?: number; width: number; height: number; above: boolean }>({ left: 0, top: 0, width: 240, height: 300, above: false });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const listId = useId();
  useBrowserOverlay(open || present);

  const show = () => {
    if (disabled || trigger.current?.matches(":disabled")) return;
    setActive(selected >= 0 && !choices[selected].disabled ? selected : Math.max(0, choices.findIndex(option => !option.disabled)));
    setPresent(true);
    setOpen(true);
  };
  const choose = (index: number) => {
    const option = choices[index];
    if (!option || option.disabled || disabled || trigger.current?.matches(":disabled")) return;
    onValueChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? innerHeight);
      const viewportRight = viewportLeft + (viewport?.width ?? innerWidth);
      const gap = 6;
      const padding = 12;
      const availableAbove = Math.max(0, rect.top - viewportTop - padding - gap);
      const availableBelow = Math.max(0, viewportBottom - rect.bottom - padding - gap);
      const desiredHeight = Math.min(320, menu.current?.scrollHeight || 320);
      const above = up
        ? availableAbove >= desiredHeight || availableAbove > availableBelow
        : availableBelow < desiredHeight && availableAbove > availableBelow;
      const height = Math.min(320, above ? availableAbove : availableBelow);
      const width = Math.min(Math.max(rect.width, 240), viewportRight - viewportLeft - padding * 2);
      const left = align === "right" ? rect.right - width : rect.left;
      // Anchor the bottom edge when opening upwards. maxHeight is a cap, not
      // the menu's actual height (a three-option menu is much shorter).
      const next = {
        left: Math.max(viewportLeft + padding, Math.min(left, viewportRight - width - padding)),
        top: above ? undefined : rect.bottom + gap,
        bottom: above ? innerHeight - rect.top + gap : undefined,
        width,
        height,
        above,
      };
      setBounds(previous =>
        previous.left === next.left && previous.top === next.top && previous.bottom === next.bottom &&
        previous.width === next.width && previous.height === next.height && previous.above === next.above
          ? previous : next,
      );
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    position();
    const observer = new ResizeObserver(position);
    if (trigger.current) observer.observe(trigger.current);
    if (menu.current) observer.observe(menu.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      window.removeEventListener("pointerdown", outside);
      observer.disconnect();
    };
  }, [open, align, up]);

  useLayoutEffect(() => {
    if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  return <span className={cn("relative inline-block min-w-0 max-w-full align-middle", className?.includes("w-full") && "w-full", className?.includes("flex-1") && "flex-1")}>
    <input tabIndex={-1} aria-hidden="true" name={name} required={required} disabled={disabled} value={value} onChange={() => {}} onFocus={() => { show(); trigger.current?.focus(); }} onInvalid={event => { event.preventDefault(); show(); trigger.current?.focus(); }} className="pointer-events-none absolute h-px w-px opacity-0" />
    <motion.button ref={trigger} id={id} type="button" role="combobox" aria-label={ariaLabel} title={title} aria-expanded={open} aria-controls={listId} aria-haspopup="listbox" aria-activedescendant={open ? `${listId}-${active}` : undefined} disabled={disabled}
      initial={false} animate={{ borderRadius: open ? 16 : 20 }} whileTap={{ scale: 0.97 }} transition={SPRING_JELLY}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={event => {
        if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } return; }
        if (event.key === "Tab") { setOpen(false); return; }
        if (["Enter", " "].includes(event.key)) { event.preventDefault(); if (open) choose(active); else show(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!open) { show(); return; }
          const enabled = choices.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
          if (!enabled.length) return;
          const position = enabled.indexOf(active);
          setActive(event.key === "Home" ? enabled[0] : event.key === "End" ? enabled[enabled.length - 1] : enabled[(position + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length] ?? 0);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          const now = Date.now();
          search.current = { text: (now - search.current.at < 600 ? search.current.text : "") + event.key.toLowerCase(), at: now };
          const index = choices.findIndex(option => !option.disabled && String(option.label).toLowerCase().startsWith(search.current.text));
          if (!open) show();
          if (index >= 0) setActive(index);
        }
      }}
      className={cn("md3-state-layer flex min-h-10 w-full items-center justify-between gap-3 bg-md-surface-low px-3.5 py-2 text-left text-sm text-md-on-surface disabled:opacity-40", className)}>
      <span className="min-w-0 flex-1 truncate">{choices[selected]?.label ?? placeholder}</span>
      <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING_FAST}><ChevronDown size={15} /></motion.span>
    </motion.button>
    {typeof document !== "undefined" && createPortal(<AnimatePresence onExitComplete={() => setPresent(false)}>{open && <motion.div ref={menu} id={listId} role="listbox" aria-label={ariaLabel} initial={{ opacity: 0, y: -6, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.96 }} transition={SPRING_FAST}
      style={{ position: "fixed", left: bounds.left, top: bounds.top, bottom: bounds.bottom, width: bounds.width, maxHeight: bounds.height, transformOrigin: bounds.above ? "bottom center" : "top center" }}
      className="z-[250] overflow-auto rounded-[22px] bg-md-surface-high p-1.5 shadow-pop" onPointerDown={event => event.preventDefault()}>
      {choices.map((option, index) => <Fragment key={`${option.group ?? ""}-${option.value}`}>
        {option.group && option.group !== choices[index - 1]?.group && <div className="px-3 py-2 text-xs text-muted">{option.group}</div>}
        <motion.button type="button" id={`${listId}-${index}`} data-index={index} role="option" aria-selected={String(value) === option.value} disabled={option.disabled} tabIndex={-1}
          onPointerMove={() => setActive(index)} onClick={() => choose(index)} whileHover={{ x: 2 }} whileTap={{ scale: 0.96, borderRadius: 10 }} transition={SPRING_JELLY}
          className={cn("md3-state-layer my-0.5 flex min-h-10 w-full items-center gap-2 rounded-[16px] px-3 py-2 text-left text-sm disabled:opacity-40", active === index ? "bg-md-secondary-container text-md-on-secondary-container" : "text-md-on-surface")}>
          <span className="min-w-0 flex-1 break-words">{option.label}</span>{option.hint && <span className="text-xs text-muted">{option.hint}</span>}{String(value) === option.value && <Check size={15} className="shrink-0" />}
        </motion.button>
      </Fragment>)}
    </motion.div>}</AnimatePresence>, trigger.current?.closest("dialog") ?? document.body)}
  </span>;
}
