import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../utils/cn";

/* ── Rally 的 MD3 Expressive 弹簧（src/renderer/src/md3/springs.ts） ── */
export const SPRING_JELLY = { type: "spring", stiffness: 520, damping: 16, mass: 0.68 } as const;
export const SPRING_LAYOUT = { type: "spring", stiffness: 390, damping: 25, mass: 0.88 } as const;
/** 快速空间弹簧：指示块滑动、分隔条高亮 */
export const SPRING_FAST = { type: "spring", stiffness: 600, damping: 23, mass: 0.72 } as const;
/** 柔和弹簧：面板展开收起 */
export const SPRING_PANEL = { type: "spring", stiffness: 330, damping: 26, mass: 0.95 } as const;

/* ── 滚动进入视野 ── */
export function useInView<T extends HTMLElement>(threshold = 0.18) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

export function Reveal({
  children,
  delay = 0,
  className,
  y = 26,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.65, delay, ease: [0.05, 0.7, 0.1, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ── 章节标题 ── */
export function SectionHead({
  kicker,
  title,
  desc,
  align = "left",
}: {
  kicker: string;
  title: ReactNode;
  desc?: string;
  align?: "left" | "center";
}) {
  return (
    <Reveal className={cn("mb-10 max-w-2xl md:mb-14", align === "center" && "mx-auto text-center")}>
      <span className="font-display inline-flex items-center gap-1.5 rounded-full bg-md-primary-container px-3.5 py-1.5 text-xs font-bold tracking-wide text-md-on-primary-container">
        <SparkIcon className="h-3.5 w-3.5" />
        {kicker}
      </span>
      <h2 className="font-display mt-4 text-[clamp(1.75rem,4vw,2.7rem)] leading-[1.15] font-extrabold text-md-on-surface">
        {title}
      </h2>
      {desc && <p className="mt-3.5 text-[15px] leading-relaxed font-medium text-md-on-surface-variant md:text-base">{desc}</p>}
    </Reveal>
  );
}

/* ── 按钮 ── */
export function JellyButton({
  children,
  href,
  onClick,
  variant = "filled",
  className,
  external,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "filled" | "tonal" | "outline" | "coral";
  className?: string;
  external?: boolean;
}) {
  const cls = cn(
    "state-layer font-display inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-bold transition-shadow",
    variant === "filled" && "bg-md-primary text-md-on-primary shadow-jelly hover:shadow-pop",
    variant === "tonal" && "bg-md-secondary-container text-md-on-secondary-container",
    variant === "outline" && "border-2 border-md-outline-variant bg-transparent text-md-primary",
    variant === "coral" && "bg-mochi-coral text-[#4a1f16] shadow-[0_10px_30px_-8px_rgba(250,158,142,0.65)]",
    className,
  );
  return (
    <motion.a
      href={href}
      onClick={onClick}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      initial={false}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.94 }}
      transition={SPRING_JELLY}
      className={cls}
    >
      {children}
    </motion.a>
  );
}

/* ── 自绘图标（暖圆风格） ── */
type IconProps = { className?: string };
const S = { fill: "none", stroke: "currentColor", strokeWidth: 2.1, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const SparkIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12 2Q13.5 10.5 22 12Q13.5 13.5 12 22Q10.5 13.5 2 12Q10.5 10.5 12 2Z" />
  </svg>
);

export const GitHubIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12 1.8A10.2 10.2 0 0 0 1.8 12c0 4.5 2.9 8.3 6.9 9.7.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.2-.4-1.2.1-2.6 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.6.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.2 10.2 0 0 0 22.2 12 10.2 10.2 0 0 0 12 1.8z" />
  </svg>
);

export const ChatIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <path d="M20.5 11.5c0 4.1-3.8 7.5-8.5 7.5-1 0-2-.2-2.9-.5L4 20l1.3-3.2A7 7 0 0 1 3.5 11.5c0-4.1 3.8-7.5 8.5-7.5s8.5 3.4 8.5 7.5z" />
    <circle cx="8.7" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="15.3" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const TasksIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <rect x="3.5" y="4" width="17" height="16" rx="4.5" />
    <path d="m8 10 1.6 1.6L13 8.2M8 15.5h8" />
  </svg>
);

export const ClockIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const PlugIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <path d="M9 3.5V8m6-4.5V8M6.5 8h11v3.5a5.5 5.5 0 0 1-5.5 5.5 5.5 5.5 0 0 1-5.5-5.5V8zM12 17v3.5" />
  </svg>
);

export const GearIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8 13.6 5a7.2 7.2 0 0 1 2.5 1l2.6-.6 1.6 2.8-1.9 2a7.3 7.3 0 0 1 0 2.6l1.9 2-1.6 2.8-2.6-.6a7.2 7.2 0 0 1-2.5 1L12 21.2 10.4 19a7.2 7.2 0 0 1-2.5-1l-2.6.6-1.6-2.8 1.9-2a7.3 7.3 0 0 1 0-2.6l-1.9-2 1.6-2.8 2.6.6a7.2 7.2 0 0 1 2.5-1L12 2.8z" />
  </svg>
);

export const SearchIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 4.8 4.8" />
  </svg>
);

export const GlobeIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5s1.2-6.2 3.6-8.5z" />
  </svg>
);

export const FileIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <path d="M6 3.5h8L19.5 9v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5z" />
    <path d="M14 3.5V9h5.5M8 13h8M8 16.5h5" />
  </svg>
);

export const MailIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
    <path d="m4.5 8 6.6 4.6a1.6 1.6 0 0 0 1.8 0L19.5 8" />
  </svg>
);

export const TerminalIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <rect x="3" y="4.5" width="18" height="15" rx="3.5" />
    <path d="m7 9.5 3 2.7-3 2.7M12.5 15.5H17" />
  </svg>
);

export const CheckIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} strokeWidth={2.6} aria-hidden>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const SendIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M4.4 3.6 20 11.1c.9.4.9 1.4 0 1.8L4.4 20.4c-.8.4-1.6-.4-1.3-1.2l1.8-5.4c.1-.4.1-.8 0-1.2L3.1 4.8c-.3-.8.5-1.6 1.3-1.2z" />
  </svg>
);

export const SunIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
  </svg>
);

export const MoonIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
);

export const WarnIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <path d="M12 4 2.8 19.5h18.4L12 4z" />
    <path d="M12 10v4.2" />
    <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

export const DownloadIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} {...S} aria-hidden>
    <path d="M12 4v10m0 0 4-4m-4 4-4-4M4.5 16.5v2A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </svg>
);

export const HeartIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
    <path d="M12 20.3C6.4 16.6 3 13.3 3 9.6 3 7 5 5 7.5 5c1.7 0 3.3.9 4.5 2.6C13.2 5.9 14.8 5 16.5 5 19 5 21 7 21 9.6c0 3.7-3.4 7-9 10.7z" />
  </svg>
);

/* ── 四角星装饰（金色，来自吉祥物） ── */
export function Sparkle({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("animate-twinkle text-mochi-gold", className)}
      style={{ animationDelay: `${delay}s` }}
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 1.5Q13.2 8.6 15 10.4 16.8 12.2 22.5 12 16.8 11.8 15 13.6 13.2 15.4 12 22.5 10.8 15.4 9 13.6 7.2 11.8 1.5 12 7.2 12.2 9 10.4 10.8 8.6 12 1.5Z" transform="translate(0 -0.5)" />
    </svg>
  );
}

/* ── 漂浮花瓣装饰（薰衣草紫） ── */
export function Petal({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("animate-bob text-mochi-lilac", className)}
      style={{ animationDelay: `${delay}s` }}
      fill="currentColor"
      aria-hidden
    >
      <path d="M16 3C22 8 28 12 28 19a12 12 0 0 1-24 0C4 12 10 8 16 3z" opacity="0.55" />
      <path d="M16 8c3.6 3.4 7 6 7 10.4A7 7 0 0 1 9 18.4C9 14 12.4 11.4 16 8z" opacity="0.5" />
    </svg>
  );
}
