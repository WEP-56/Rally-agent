import clsx from "clsx";
import { AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Task } from "../data";
import { AgentAvatar } from "./AgentAvatar";
import {
  CritterAvatar,
  Md3WavyProgressRing,
} from "../md3/components";
import { SPRING_FAST, SPRING_JELLY } from "../md3/springs";

/** Matches Rally's real `ChatActivity` union in `src/shared/ipc.ts` */
export type RallyChatActivity =
  | "idle"
  | "thinking"
  | "querying"
  | "planning"
  | "orchestrating"
  | "replying"
  | "compacting";

export const ACTIVITY_LABELS: Record<RallyChatActivity, string> = {
  idle: "待命",
  thinking: "思考中",
  querying: "查询中",
  planning: "制订任务",
  orchestrating: "编排中",
  replying: "回复中",
  compacting: "整理中",
};

/* ─── Live Undulating MD3 12-Wave Halo Medallion ─── */
function LivingWavyMedallion({
  personaName,
  mode,
  hasAttention,
}: {
  personaName: string;
  mode: "idle" | "background" | "active";
  hasAttention: boolean;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let rafId = 0;
    let phase = 0;
    let currentAmp =
      modeRef.current === "active" ? 5.4 : modeRef.current === "background" ? 4.6 : 3.7;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const m = modeRef.current;
      const targetAmp = m === "active" ? 5.5 : m === "background" ? 4.7 : 3.8;
      const speed = m === "active" ? 3.8 : m === "background" ? 1.8 : 0.65;
      const secondaryRipple = m === "active" ? 1.15 : m === "background" ? 0.45 : 0;

      currentAmp += (targetAmp - currentAmp) * Math.min(1, dt * 8);
      phase += dt * speed;

      if (pathRef.current) {
        const steps = 168;
        const pts: string[] = [];
        for (let i = 0; i <= steps; i++) {
          const theta = (i / steps) * Math.PI * 2;
          const r =
            43.2 +
            currentAmp * Math.cos(12 * theta - phase) +
            secondaryRipple * Math.sin(5 * theta + phase * 0.75);
          const x = 50 + r * Math.cos(theta);
          const y = 50 + r * Math.sin(theta);
          pts.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
        }
        pts.push("Z");
        pathRef.current.setAttribute("d", pts.join(" "));
      }

      if (!reduced) rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const haloFill =
    mode === "active"
      ? "var(--md-sys-color-primary)"
      : mode === "background"
        ? "var(--md-sys-color-primary-container)"
        : "color-mix(in srgb, var(--md-sys-color-primary-container) 78%, var(--md-sys-color-surface-container-highest))";

  return (
    <motion.div
      layout
      animate={{
        scale: mode === "active" ? 1.07 : mode === "background" ? 1.02 : 1,
      }}
      transition={SPRING_JELLY}
      className="relative -ml-1 flex h-[48px] w-[48px] shrink-0 items-center justify-center"
    >
      <svg
        viewBox="0 0 100 100"
        width={48}
        height={48}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-visible"
      >
        <path
          ref={pathRef}
          fill={haloFill}
          style={{ transition: "fill 260ms ease" }}
        />
      </svg>

      <div
        style={{ boxShadow: "0 2px 7px rgba(0, 0, 0, 0.26)" }}
        className="relative z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-md-surface-lowest ring-[1.5px] ring-md-surface-lowest/80"
      >
        <AgentAvatar size={30} className="rounded-full" />
      </div>

      <span
        className={clsx(
          "absolute bottom-1 right-1 z-20 h-2.5 w-2.5 rounded-full ring-2 ring-md-surface-high",
          mode === "active"
            ? "bg-md-tertiary"
            : mode === "background"
              ? "bg-md-primary"
              : hasAttention
                ? "bg-rally-warn"
                : "bg-rally-ok",
        )}
      />
    </motion.div>
  );
}

/* ─── Right-Wing Micro-Glyphs per Real Activity ─── */
function ExpressiveActivityGlyph({ activity }: { activity: RallyChatActivity }) {
  if (activity === "thinking") {
    return <Md3WavyProgressRing size={20} lobes={8} />;
  }

  if (activity === "querying") {
    return (
      <div className="relative flex h-5 w-6 items-center justify-center">
        <motion.span
          animate={{ x: [-5, 5, -5], scale: [1, 0.75, 1] }}
          transition={{ duration: 1.05, repeat: Infinity, ease: "easeInOut" }}
          className="absolute h-2 w-2 rounded-full bg-md-primary"
        />
        <motion.span
          animate={{ x: [5, -5, 5], scale: [0.75, 1, 0.75] }}
          transition={{ duration: 1.05, repeat: Infinity, ease: "easeInOut" }}
          className="absolute h-2 w-2 rounded-full bg-md-tertiary"
        />
      </div>
    );
  }

  if ((activity === "orchestrating" || activity === "planning")) {
    return (
      <div className="flex h-5 items-center gap-1 px-0.5">
        <motion.span
          animate={{ x: [0, 8, 0], scale: [0.85, 1.15, 0.85], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          className="h-1.5 w-1.5 rounded-full bg-md-primary"
        />
        <motion.span
          animate={{ rotate: [0, 90, 180], borderRadius: ["5px", "9px", "5px"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          className="h-3 w-3 bg-md-primary/85"
        />
      </div>
    );
  }

  if (activity === "replying") {
    return (
      <div className="flex h-5 items-center gap-[2.5px] px-0.5">
        {[0, 0.16, 0.32].map((delay, i) => (
          <motion.span
            key={i}
            animate={{ height: ["6px", "14px", "6px"] }}
            transition={{
              duration: 0.85,
              repeat: Infinity,
              delay,
              ease: "easeInOut",
            }}
            className="w-[3px] rounded-full bg-md-primary"
          />
        ))}
      </div>
    );
  }

  if (activity === "compacting") {
    return (
      <div className="flex h-5 items-center gap-0.5">
        <motion.span
          animate={{ x: [-2, 1.5, -2], scaleY: [1, 0.7, 1] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          className="h-3 w-1 rounded-full bg-md-primary"
        />
        <span className="h-1.5 w-1.5 rounded-full bg-md-tertiary" />
        <motion.span
          animate={{ x: [2, -1.5, 2], scaleY: [1, 0.7, 1] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          className="h-3 w-1 rounded-full bg-md-primary"
        />
      </div>
    );
  }

  return null;
}

export function PresenceCapsule({
  personaName,
  activity,
  tasks,
  rightOpen,
  onOpenWorkstation,
}: {
  personaName: string;
  activity: RallyChatActivity;
  tasks: Task[];
  rightOpen: boolean;
  onOpenWorkstation: () => void;
}) {
  const unarchived = tasks.filter((t) => t.archivedAt === undefined);
  const runningTasks = unarchived.filter((t) => t.status === "running");
  const attentionTasks = unarchived.filter(
    (t) =>
      t.status === "blocked" ||
      t.status === "pending_approval" ||
      t.status === "needs_gate" ||
      t.status === "needs_answer" ||
      t.status === "interrupted" ||
      t.status === "failed",
  );

  const isMainActive = activity !== "idle";
  const hasBackgroundWork = runningTasks.length > 0;
  const medallionMode = isMainActive
    ? "active"
    : hasBackgroundWork
      ? "background"
      : "idle";

  const subtitle = isMainActive
    ? ACTIVITY_LABELS[activity]
    : hasBackgroundWork
      ? `工位 ${runningTasks.length} 项执行中`
      : attentionTasks.length > 0
        ? `${attentionTasks.length} 项待你确认`
        : "待命";

  return (
    <motion.button
      type="button"
      layout
      onClick={onOpenWorkstation}
      whileHover={{ scale: 1.035, y: -0.5 }}
      whileTap={{ scale: 0.93 }}
      transition={SPRING_JELLY}
      title="打开工位"
      className="no-drag group relative flex min-w-0 h-[48px] max-w-[220px] items-center gap-2 justify-self-center pr-3.5 select-none"
    >
      {/* Inner Pill Track */}
      <motion.span
        layout
        transition={SPRING_JELLY}
        className={clsx(
          "pointer-events-none absolute inset-y-[5px] left-[10px] right-0 rounded-full transition-colors duration-200",
          isMainActive
            ? "bg-md-primary-container/90 shadow-xs"
            : "bg-md-surface-high/95 group-hover:bg-md-surface-highest",
        )}
      />

      {/* Prominent Unclipped MD3 12-Wave Halo Medallion */}
      <div className="relative z-10 flex items-center">
        <LivingWavyMedallion
          personaName={personaName}
          mode={medallionMode}
          hasAttention={attentionTasks.length > 0}
        />
      </div>

      {/* Name + Context-Aware Live Subtitle */}
      <motion.div
        layout
        className={clsx(
          "relative z-10 min-w-0 text-left leading-[1.16]",
          isMainActive ? "text-md-on-primary-container" : "text-md-on-surface",
        )}
      >
        <div className="truncate text-[13px] font-bold">{personaName}</div>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={subtitle}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={SPRING_FAST}
            className={clsx(
              "truncate whitespace-nowrap text-[10.5px] font-medium",
              isMainActive
                ? "text-md-on-primary-container/85"
                : "text-md-on-surface-variant",
            )}
          >
            {subtitle}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Right Wing: Active Morphing Glyph OR Background Critter Stack */}
      <AnimatePresence mode="popLayout" initial={false}>
        {isMainActive ? (
          <motion.div
            key={`glyph-${activity}`}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={SPRING_JELLY}
            className="relative z-10 ml-0.5 flex items-center"
          >
            <ExpressiveActivityGlyph activity={activity} />
          </motion.div>
        ) : (
          (hasBackgroundWork || attentionTasks.length > 0) && (
            <motion.div
              key="bg-cluster"
              layout
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={SPRING_JELLY}
              className="relative z-10 ml-0.5 flex items-center gap-1.5"
            >
              {hasBackgroundWork && (
                <div className="flex items-center -space-x-1.5">
                  {runningTasks.slice(0, 2).map((t) => (
                    <div
                      key={t.id}
                      className="rounded-full ring-2 ring-md-surface-high"
                    >
                      <CritterAvatar seed={t.id} size={20} expressive />
                    </div>
                  ))}
                </div>
              )}

              {attentionTasks.length > 0 && !rightOpen && (
                <span className="inline-flex h-5 items-center gap-1 rounded-full bg-rally-warn-container px-2 text-[10.5px] font-bold text-rally-on-warn-container">
                  <AlertCircle size={10.5} />
                  {attentionTasks.length}
                </span>
              )}
            </motion.div>
          )
        )}
      </AnimatePresence>
    </motion.button>
  );
}
