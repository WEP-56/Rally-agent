import { BrowserOverlayLease, useBrowserOverlay } from "../browser-overlays";
import clsx from "clsx";
import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SPRING_FAST, SPRING_JELLY, SPRING_LAYOUT } from "./springs";

/* ───────────────────────── Click Outside Hook ───────────────────────── */
export function useClickOutside<T extends HTMLElement>(active: boolean, onClose: () => void) {
  useBrowserOverlay(active);
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [active, onClose]);
  return ref;
}

/* ─────────── Horizontal Drag + Wheel + Touch Scroller (Zero Scrollbar!) ─────────── */
export function HorizontalDragScroll({
  activeKey,
  fadeWidth = 18,
  className,
  children,
}: {
  activeKey?: string | number;
  fadeWidth?: number;
  className?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const [dragging, setDragging] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false, overflow: false });

  const syncEdges = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const overflow = maxScroll > 2;
    const left = overflow && el.scrollLeft > 2;
    const right = overflow && el.scrollLeft < maxScroll - 2;
    setEdges((prev) =>
      prev.left === left && prev.right === right && prev.overflow === overflow
        ? prev
        : { left, right, overflow },
    );
  }, []);

  useLayoutEffect(() => {
    syncEdges();
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    Array.from(el.children).forEach((child) => ro.observe(child));
    return () => ro.disconnect();
  }, [syncEdges, children]);

  /* Smoothly scroll active item (`[data-active="true"]`) into comfortable view */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const activeNode = el.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeNode) return;
    const viewRect = el.getBoundingClientRect();
    const itemRect = activeNode.getBoundingClientRect();
    const pad = 16;
    if (itemRect.left < viewRect.left + pad) {
      el.scrollTo({
        left: Math.max(0, el.scrollLeft + (itemRect.left - viewRect.left) - pad),
        behavior: "smooth",
      });
    } else if (itemRect.right > viewRect.right - pad) {
      el.scrollTo({
        left: el.scrollLeft + (itemRect.right - viewRect.right) + pad,
        behavior: "smooth",
      });
    }
  }, [activeKey]);

  /* Translate vertical mouse wheel into smooth horizontal scroll when overflowing */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      const scale = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += delta * scale;
      syncEdges();
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [syncEdges]);

  const finishDrag = (pointerId: number) => {
    if (dragStateRef.current?.pointerId !== pointerId) return;
    dragStateRef.current = null;
    setDragging(false);
  };

  const maskImage =
    edges.left && edges.right
      ? `linear-gradient(to right, transparent, black ${fadeWidth}px, black calc(100% - ${fadeWidth}px), transparent)`
      : edges.left
        ? `linear-gradient(to right, transparent, black ${fadeWidth}px, black 100%)`
        : edges.right
          ? `linear-gradient(to right, black 0%, black calc(100% - ${fadeWidth}px), transparent)`
          : undefined;

  return (
    <div
      ref={containerRef}
      onScroll={syncEdges}
      onPointerDown={(e) => {
        suppressClickRef.current = false;
        const el = e.currentTarget;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (el.scrollWidth <= el.clientWidth) return;
        /* Only use JS drag for mouse; touch uses native touch-pan-x inertia! */
        if (e.pointerType !== "mouse") return;
        dragStateRef.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startScrollLeft: el.scrollLeft,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const st = dragStateRef.current;
        if (!st || st.pointerId !== e.pointerId) return;
        const dx = e.clientX - st.startX;
        if (!st.moved) {
          if (Math.abs(dx) < 5) return;
          st.moved = true;
          suppressClickRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
        }
        e.currentTarget.scrollLeft = st.startScrollLeft - dx;
        syncEdges();
      }}
      onPointerLeave={(e) => { if (!dragStateRef.current?.moved) finishDrag(e.pointerId); }}
      onPointerUp={(e) => finishDrag(e.pointerId)}
      onPointerCancel={(e) => finishDrag(e.pointerId)}
      onLostPointerCapture={(e) => finishDrag(e.pointerId)}
      onClickCapture={(e) => {
        if (!suppressClickRef.current || e.detail === 0) return;
        suppressClickRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      style={
        maskImage
          ? { maskImage, WebkitMaskImage: maskImage }
          : undefined
      }
      className={clsx(
        "no-scrollbar flex min-w-0 touch-pan-x items-center overflow-x-auto select-none",
        edges.overflow && (dragging ? "cursor-grabbing" : "cursor-grab"),
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ───────────────────────── MD3 Expressive Bouncy Button ───────────────────────── */
export interface MdButtonProps {
  variant?: "filled" | "tonal" | "surface" | "text" | "error-tonal";
  size?: "xs" | "sm" | "md";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function MdButton({
  variant = "tonal",
  size = "sm",
  type = "button",
  disabled,
  title,
  onClick,
  leadingIcon,
  trailingIcon,
  className,
  children,
}: MdButtonProps) {
  const variantCls = {
    filled: "bg-md-primary text-md-on-primary font-semibold",
    tonal: "bg-md-secondary-container text-md-on-secondary-container font-semibold",
    surface: "bg-md-surface-high text-md-on-surface font-medium",
    text: "bg-transparent text-md-primary font-semibold",
    "error-tonal": "bg-md-error-container text-md-on-error-container font-semibold",
  }[variant];

  const sizeCls = {
    xs: "h-[30px] px-3 text-[12px] gap-1.5",
    sm: "h-[34px] px-3.5 text-[12.5px] gap-1.5",
    md: "h-[40px] px-4.5 text-[13.5px] gap-2",
  }[size];

  return (
    <motion.button
      type={type}
      disabled={disabled}
      title={title}
      onClick={onClick}
      initial={false}
      animate={{ borderRadius: 20, scale: 1, y: 0 }}
      whileHover={disabled ? undefined : { scale: 1.035, y: -1, borderRadius: 24 }}
      whileTap={disabled ? undefined : { scale: 0.91, y: 0.5, borderRadius: 9 }}
      transition={SPRING_JELLY}
      className={clsx(
        "md3-state-layer inline-flex shrink-0 items-center justify-center whitespace-nowrap tracking-[0.01em] disabled:opacity-40",
        variantCls,
        sizeCls,
        className,
      )}
    >
      {leadingIcon && <span className="flex shrink-0 items-center">{leadingIcon}</span>}
      <span>{children}</span>
      {trailingIcon && <span className="flex shrink-0 items-center">{trailingIcon}</span>}
    </motion.button>
  );
}

/* ───────────────────────── MD3 Expressive Bouncy Icon Button ───────────────────────── */
export interface MdIconButtonProps {
  variant?: "standard" | "tonal" | "surface" | "filled";
  size?: 30 | 34 | 38;
  selected?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: ReactNode;
}

export function MdIconButton({
  variant = "surface",
  size = 34,
  selected = false,
  disabled,
  title,
  onClick,
  className,
  children,
}: MdIconButtonProps) {
  const variantCls = selected
    ? "bg-md-secondary-container text-md-on-secondary-container"
    : {
        standard: "bg-transparent text-md-on-surface-variant hover:text-md-on-surface",
        surface: "bg-md-surface-high/90 text-md-on-surface-variant hover:text-md-on-surface",
        tonal: "bg-md-secondary-container text-md-on-secondary-container",
        filled: "bg-md-primary text-md-on-primary",
      }[variant];

  const restRadius = selected ? 12 : Math.round(size / 2);

  return (
    <motion.button
      type="button"
      disabled={disabled}
      title={title}
      aria-pressed={selected || undefined}
      onClick={onClick}
      initial={false}
      animate={{ borderRadius: restRadius, scale: 1 }}
      whileHover={
        disabled ? undefined : { scale: 1.09, borderRadius: selected ? 14 : restRadius }
      }
      whileTap={disabled ? undefined : { scale: 0.85, borderRadius: 8 }}
      transition={SPRING_JELLY}
      style={{ width: size, height: size }}
      className={clsx(
        "md3-state-layer inline-flex shrink-0 items-center justify-center disabled:opacity-38",
        variantCls,
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

/* ─────────────── M3 Expressive Connected Segments (Sliding Pill + Neighbor Squeeze!) ─────────────── */
export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export function MdConnectedSegments<T extends string>({
  value,
  options,
  onChange,
  size = "sm",
  ariaLabel,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (next: T) => void;
  size?: "xs" | "sm";
  ariaLabel?: string;
}) {
  const groupId = useId();
  const [pressedIdx, setPressedIdx] = useState<number | null>(null);
  const basePad = size === "xs" ? 11 : 13;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-[3px] rounded-full bg-md-surface-high/95 p-[3px]"
    >
      {options.map((opt, idx) => {
        const active = opt.value === value;
        const isPressed = pressedIdx === idx;
        const neighborPressed =
          pressedIdx !== null && Math.abs(pressedIdx - idx) === 1;
        const padX = isPressed ? basePad + 5 : neighborPressed ? Math.max(7, basePad - 3) : active ? basePad + 3 : basePad;

        return (
          <motion.button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onPointerDown={() => setPressedIdx(idx)}
            onPointerUp={() => setPressedIdx(null)}
            onPointerLeave={() => setPressedIdx(null)}
            onClick={() => onChange(opt.value)}
            animate={{
              paddingLeft: padX,
              paddingRight: padX,
              scale: isPressed ? 0.95 : 1,
            }}
            transition={SPRING_FAST}
            className={clsx(
              "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full select-none",
              size === "xs" ? "h-[26px] text-[11.5px]" : "h-[30px] text-[12.5px]",
              active
                ? "font-semibold text-md-on-secondary-container"
                : "font-medium text-md-on-surface-variant hover:text-md-on-surface",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-pill-${groupId}`}
                transition={SPRING_FAST}
                className="absolute inset-0 rounded-full bg-md-secondary-container shadow-xs"
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {opt.icon}
              <span>{opt.label}</span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/* ───────────────────── M3 Expressive Filter Chip (Shared Sliding Pill!) ───────────────────── */
export function MdFilterChip({
  groupId,
  selected,
  onClick,
  label,
  count,
  dotColor,
}: {
  groupId: string;
  selected: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  dotColor?: string;
}) {
  return (
    <motion.button
      type="button"
      layout
      data-active={selected ? "true" : undefined}
      aria-pressed={selected}
      onClick={onClick}
      whileHover={{ scale: 1.04, y: -1 }}
      whileTap={{ scale: 0.91 }}
      transition={SPRING_FAST}
      style={{ borderRadius: selected ? 999 : 14 }}
      className={clsx(
        "relative inline-flex h-[32px] shrink-0 items-center gap-1.5 px-3.5 text-[12.5px] select-none",
        selected
          ? "font-semibold text-md-on-secondary-container"
          : "bg-md-surface-high/85 font-medium text-md-on-surface-variant hover:text-md-on-surface",
      )}
    >
      {selected && (
        <motion.span
          layoutId={`filter-pill-${groupId}`}
          transition={SPRING_FAST}
          className="absolute inset-0 rounded-full bg-md-secondary-container"
        />
      )}

      <span className="relative z-10 flex items-center gap-1.5">
        <AnimatePresence mode="popLayout" initial={false}>
          {selected ? (
            <motion.span
              key="check"
              initial={{ scale: 0.2, opacity: 0, rotate: -35 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.2, opacity: 0 }}
              transition={SPRING_JELLY}
              className="flex items-center"
            >
              <Check size={13} strokeWidth={2.7} />
            </motion.span>
          ) : dotColor ? (
            <motion.span
              key="dot"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={SPRING_FAST}
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: dotColor }}
            />
          ) : null}
        </AnimatePresence>

        <span>{label}</span>

        {count !== undefined && count > 0 && (
          <span
            className={clsx(
              "ml-0.5 rounded-full px-1.5 py-px text-[10.5px] tabular-nums",
              selected
                ? "bg-md-on-secondary-container/14 text-md-on-secondary-container"
                : "bg-md-on-surface/8 text-md-on-surface-variant",
            )}
          >
            {count}
          </span>
        )}
      </span>
    </motion.button>
  );
}

/* ───────────────────────── Authentic Jelly MD3 Switch ───────────────────────── */
export function MdSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  const [pressing, setPressing] = useState(false);

  return (
    <motion.button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onPointerDown={() => setPressing(true)}
      onPointerUp={() => setPressing(false)}
      onPointerLeave={() => setPressing(false)}
      onClick={() => onChange(!checked)}
      whileTap={disabled ? undefined : { scale: 0.94 }}
      transition={SPRING_FAST}
      className={clsx(
        "flex h-[28px] w-[50px] shrink-0 items-center rounded-full p-[3px] transition-colors duration-150 disabled:opacity-40",
        checked ? "justify-end bg-md-primary" : "justify-start bg-md-surface-highest",
      )}
    >
      <motion.span
        layout
        transition={SPRING_JELLY}
        animate={{
          width: pressing ? 27 : checked ? 22 : 16,
          height: pressing ? 22 : checked ? 22 : 16,
        }}
        className={clsx(
          "flex items-center justify-center rounded-full",
          checked
            ? "bg-md-on-primary text-md-primary"
            : "ml-[2px] bg-md-on-surface-variant/80 text-transparent",
        )}
      >
        {checked && <Check size={12} strokeWidth={3} />}
      </motion.span>
    </motion.button>
  );
}

/* ───────────────────────── Kbd Shortcut Chip ───────────────────────── */
export function MdKbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded-[7px] bg-md-surface-highest px-1.5 font-mono text-[10.5px] font-medium text-md-on-surface-variant">
      {children}
    </kbd>
  );
}

/* ─────────────── Authentic MD3 12-Crest Sinusoidal Wavy Halo & Wavy Ring ─────────────── */
export function buildWavyPath(
  lobes = 12,
  midRadius = 43.5,
  amplitude = 4.8,
  phase = 0,
): string {
  const steps = 192;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    const r = midRadius + amplitude * Math.cos(lobes * theta + phase);
    const x = 50 + r * Math.cos(theta);
    const y = 50 + r * Math.sin(theta);
    pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  pts.push("Z");
  return pts.join(" ");
}

/**
 * Classic MD3 Wavy Halo SVG (matches Pixel / Android 16 scalloped halo proportions:
 * inner circle ~64%, valley ~78%, 12 smooth sinusoidal crests ~96%).
 */
export function ExpressiveCookie({
  size = 64,
  lobes = 12,
  amplitude = 4.8,
  className,
  fill = "var(--md-sys-color-primary-container)",
}: {
  size?: number;
  lobes?: number;
  amplitude?: number;
  className?: string;
  fill?: string;
}) {
  const d = buildWavyPath(lobes, 43.4, amplitude, 0);
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path d={d} fill={fill} />
    </svg>
  );
}

/**
 * MD3 Expressive CircularWavyProgressIndicator (sinusoidal stroke arc!)
 */
export function Md3WavyProgressRing({
  size = 22,
  lobes = 8,
  stroke = "var(--md-sys-color-primary)",
  trackStroke = "color-mix(in srgb, var(--md-sys-color-primary) 20%, transparent)",
}: {
  size?: number;
  lobes?: number;
  stroke?: string;
  trackStroke?: string;
}) {
  const d = buildWavyPath(lobes, 39, 4.4, 0);
  return (
    <motion.svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      animate={{ rotate: 360 }}
      transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
      aria-hidden="true"
      className="shrink-0"
    >
      <circle
        cx="50"
        cy="50"
        r="39"
        fill="none"
        stroke={trackStroke}
        strokeWidth="7"
      />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="175 90"
      />
    </motion.svg>
  );
}

/* ─────────── Elastic Draggable/Pokeable Persona Charm (经典 MD3 波浪环挂件!) ─────────── */
export function PlayfulPersonaCharm({
  src,
  name,
  children,
  size = 72,
  busy = false,
}: {
  src?: string;
  name: string;
  children?: ReactNode;
  size?: number;
  busy?: boolean;
}) {
  /* Exact 0.64 inner-circle-to-wavy-halo ratio from Google's MD3 wavy medallion! */
  const avatarSize = Math.round(size * 0.64);
  return (
    <motion.div
      drag
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.42}
      whileHover={{ scale: 1.07, rotate: 5 }}
      whileTap={{ scale: 0.9, rotate: -6 }}
      transition={SPRING_JELLY}
      title="可以轻轻拖拽或戳一戳我！"
      style={{ width: size, height: size }}
      className="relative flex shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
    >
      <motion.div
        animate={{
          rotate: 360,
          scale: busy ? [1, 1.07, 1] : 1,
        }}
        transition={{
          rotate: { duration: busy ? 7 : 32, repeat: Infinity, ease: "linear" },
          scale: busy
            ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
            : SPRING_JELLY,
        }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <ExpressiveCookie
          size={size}
          lobes={12}
          amplitude={busy ? 5.2 : 4.6}
          fill="var(--md-sys-color-primary-container)"
        />
      </motion.div>
      {children ?? (<img
        src={src}
        alt={name}
        width={avatarSize}
        height={avatarSize}
        draggable={false}
        style={{
          width: avatarSize,
          height: avatarSize,
          boxShadow: "0 3px 10px rgba(0, 0, 0, 0.22)",
        }}
        className="pointer-events-none relative z-10 rounded-full object-cover ring-2 ring-md-primary/25 select-none"
      />)}
    </motion.div>
  );
}

/* ─────────────────── Rally Orbit Ring (Refined MD3 Tonal) ─────────────────── */
export function OrbitRingMd3({ size = 240, active = false }: { size?: number; active?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="-100 -56 200 112"
      width={size}
      height={(size * 112) / 200}
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`md3-orbit-${id}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--md-sys-color-primary)" stopOpacity="0.04" />
          <stop offset="0.45" stopColor="var(--md-sys-color-primary)" stopOpacity="0.42" />
          <stop offset="0.8" stopColor="var(--md-sys-color-tertiary)" stopOpacity="0.56" />
          <stop offset="1" stopColor="var(--md-sys-color-primary)" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <g transform="rotate(-19)">
        <ellipse
          rx="84"
          ry="27"
          fill="none"
          stroke={`url(#md3-orbit-${id})`}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeDasharray="390 130"
        />
        <g>
          <path
            d="M0,-5.5 Q0.8,-0.8 5.5,0 Q0.8,0.8 0,5.5 Q-0.8,0.8 -5.5,0 Q-0.8,-0.8 0,-5.5Z"
            fill="var(--md-sys-color-primary)"
          />
          <animateMotion
            dur={active ? "5s" : "15s"}
            repeatCount="indefinite"
            path="M -84 0 A 84 27 0 1 1 84 0 A 84 27 0 1 1 -84 0"
          />
        </g>
      </g>
    </svg>
  );
}

/* ─────────────────── Rally Pixel Critters (Playful Squircle / Organic Tile) ─────────────────── */
const SPRITES: string[][] = [
  [".....", ".#...", ".##..", ".####", ".#e##", ".####", ".###m", "..###", "...##", "....."],
  [".....", "..###", ".####", "#####", "#e###", "#####", "###mm", ".####", ".#.##", "....."],
  ["....#", "....#", ".####", ".#mmm", ".#mem", ".#mmm", ".####", "..###", ".#.#.", "....."],
  [".....", "..###", ".####", "#####", "#e###", "#####", "#####", "#####", "#.#.#", "....."],
  [".#...", "..#..", "..###", ".####", ".#e##", "#####", "#.###", "..###", ".#.##", "....."],
];

const CRITTER_ROLES = [
  { fg: "var(--md-sys-color-primary)", bg: "var(--md-sys-color-primary-container)" },
  { fg: "var(--md-sys-color-tertiary)", bg: "var(--md-sys-color-tertiary-container)" },
  { fg: "var(--rally-color-ok)", bg: "var(--rally-color-ok-container)" },
  { fg: "var(--rally-color-warn)", bg: "var(--rally-color-warn-container)" },
  { fg: "var(--md-sys-color-secondary)", bg: "var(--md-sys-color-secondary-container)" },
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function CritterAvatar({
  seed,
  size = 42,
  expressive = false,
  className,
}: {
  seed: string;
  size?: number;
  expressive?: boolean;
  className?: string;
}) {
  const h = hashSeed(seed);
  const rows = SPRITES[h % SPRITES.length];
  const palette = CRITTER_ROLES[(h >>> 3) % CRITTER_ROLES.length];
  const rects: ReactNode[] = [];

  rows.forEach((half, y) => {
    const full = half + half.split("").reverse().join("");
    full.split("").forEach((c, x) => {
      if (c === ".") return;
      const fill =
        c === "#"
          ? palette.fg
          : c === "m"
            ? "color-mix(in srgb, var(--md-sys-color-on-surface) 45%, var(--md-sys-color-primary))"
            : "var(--md-sys-color-surface-container-lowest)";
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1.03" height="1.03" fill={fill} />);
    });
  });

  /* Subtle organic shape diversity across critters — feels playful & alive */
  const shapeVariant = expressive ? (h % 3 === 0 ? "rounded-full" : h % 3 === 1 ? "rounded-[18px]" : "rounded-[15px_21px_16px_20px]") : "rounded-[13px]";

  return (
    <motion.div
      whileHover={{ scale: 1.12, rotate: h % 2 === 0 ? 6 : -6 }}
      whileTap={{ scale: 0.9 }}
      transition={SPRING_JELLY}
      className={clsx(
        "relative flex shrink-0 items-center justify-center",
        shapeVariant,
        className,
      )}
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${palette.bg} 82%, var(--md-sys-color-surface-container-high))`,
      }}
    >
      <svg
        viewBox="0 0 10 10"
        shapeRendering="crispEdges"
        style={{ width: size * 0.64, height: size * 0.64 }}
      >
        {rects}
      </svg>
    </motion.div>
  );
}

/* ─────────────────── Persona Avatar (Hikari or Rally Mark) ─────────────────── */
export function PersonaAvatar({
  src,
  name,
  size = 36,
  shape = "circle",
  className,
}: {
  src: string;
  name: string;
  size?: number;
  shape?: "circle" | "squircle";
  className?: string;
}) {
  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      draggable={false}
      style={{ width: size, height: size }}
      className={clsx(
        "shrink-0 select-none object-cover",
        shape === "circle" ? "rounded-full" : "rounded-[30%]",
        className,
      )}
    />
  );
}

/* ─────────────────── MD3 Inverse-Surface Bouncy Snackbar ─────────────────── */
export function MdSnackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
}: {
  message: string | null;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  return (
    <AnimatePresence>
      {message && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex justify-center px-4">
          <motion.div
            key={message}
            role="status"
            initial={{ opacity: 0, y: 26, scale: 0.88 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.92 }}
            transition={SPRING_LAYOUT}
            className="pointer-events-auto flex min-h-[44px] max-w-[460px] items-center gap-3 rounded-full bg-md-inverse-surface px-4.5 py-2 text-[13px] text-md-inverse-on-surface shadow-xl"
          >
            <BrowserOverlayLease />
            <span className="flex-1">{message}</span>
            {actionLabel && onAction && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                transition={SPRING_JELLY}
                onClick={() => {
                  onAction();
                  onDismiss();
                }}
                className="rounded-full bg-md-inverse-primary/15 px-3 py-1 text-[12.5px] font-semibold text-md-inverse-primary"
              >
                {actionLabel}
              </motion.button>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
