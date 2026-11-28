import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "../utils/cn";
import { ARCH_LAYERS } from "../data";
import { MochiMascotSvg } from "../rally/mascot/MochiMascotSvg";
import { DEFAULT_PHYSICS, type AgentStateId } from "../rally/mascot/types";
import { Reveal, SectionHead, SPRING_JELLY, Petal } from "./ui";

const LAYER_TONE: Record<string, { dot: string; pill: string; name: string }> = {
  devices: { dot: "bg-mochi-coral", pill: "bg-mochi-coral/15 text-mochi-coral-deep dark:text-mochi-coral", name: "coral" },
  supervisor: { dot: "bg-mochi-violet", pill: "bg-mochi-violet/15 text-mochi-violet-deep dark:text-mochi-lilac", name: "violet" },
  runtime: { dot: "bg-md-primary", pill: "bg-md-primary/12 text-md-primary dark:text-md-inverse-primary", name: "primary" },
  capabilities: { dot: "bg-mochi-gold", pill: "bg-mochi-gold/20 text-[#8a6116] dark:text-mochi-gold", name: "gold" },
};

function FlowConnector() {
  return (
    <div className="flex h-9 items-center justify-center" aria-hidden>
      <svg width="120" height="36" className="overflow-visible" style={{ stroke: "var(--md-sys-color-outline-variant)" }}>
        <path d="M60 0 V36" strokeWidth="2.4" fill="none" className="flowline" strokeLinecap="round" />
        <path d="M20 6 Q60 20 100 6" strokeWidth="1.6" fill="none" className="flowline" opacity="0.55" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function Architecture() {
  const [selected, setSelected] = useState("scheduler");
  const [mascotState, setMascotState] = useState<AgentStateId>("idle");

  const node = ARCH_LAYERS.flatMap((l) => l.nodes.map((n) => ({ ...n, layer: l }))).find((n) => n.id === selected)!;

  useEffect(() => {
    setMascotState("thinking");
    const t = window.setTimeout(() => setMascotState("idle"), 1100);
    return () => window.clearTimeout(t);
  }, [selected]);

  return (
    <section id="architecture" className="relative overflow-hidden bg-md-surface py-20 md:py-28">
      <div className="dotgrid absolute inset-0 opacity-40 [mask-image:radial-gradient(70%_60%_at_50%_20%,black,transparent)]" aria-hidden />
      <Petal className="absolute top-14 left-[4%] h-9 w-9 opacity-50" delay={0.4} />

      <div className="relative mx-auto max-w-6xl px-5">
        <SectionHead
          kicker="架构一览"
          title={
            <>
              Rally 是<span className="text-md-primary">怎么长出来</span>的
            </>
          }
          desc="客户端负责陪伴，服务器负责待命；主进程当大管家，Agent 运行时源自开源项目 Pi。点一点每一块，看看它们各自忙什么。"
        />

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-10">
          {/* ── 左：分层图 ── */}
          <div>
            {ARCH_LAYERS.map((layer, li) => (
              <Reveal key={layer.id} delay={li * 0.06}>
                {li > 0 && <FlowConnector />}
                <div className="rounded-[28px] border border-md-outline-variant/55 bg-md-surface-lowest/70 p-5 shadow-card backdrop-blur-sm">
                  <div className="mb-4 flex flex-wrap items-center gap-2.5">
                    <span className={cn("h-2.5 w-2.5 rounded-full", LAYER_TONE[layer.id].dot)} />
                    <h3 className="font-display text-base font-extrabold text-md-on-surface">{layer.name}</h3>
                    <span className="text-xs font-semibold text-md-on-surface-variant/80">{layer.blurb}</span>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {layer.nodes.map((n) => {
                      const active = selected === n.id;
                      return (
                        <motion.button
                          key={n.id}
                          type="button"
                          onClick={() => setSelected(n.id)}
                          initial={false}
                          whileHover={{ scale: 1.025 }}
                          whileTap={{ scale: 0.96 }}
                          transition={SPRING_JELLY}
                          className={cn(
                            "state-layer cursor-pointer rounded-[20px] border px-4 py-3 text-left transition-colors duration-200",
                            active
                              ? "border-md-primary/45 bg-md-primary-fixed/45 shadow-float dark:border-md-inverse-primary/50 dark:bg-md-primary-container/35"
                              : "border-md-outline-variant/60 bg-md-surface-low hover:border-md-outline/60",
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-display text-[14.5px] font-extrabold text-md-on-surface">{n.name}</span>
                            <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-bold", LAYER_TONE[layer.id].pill)}>
                              {n.tag}
                            </span>
                          </span>
                          <span className="mt-1 block text-xs leading-snug font-semibold text-md-on-surface-variant line-clamp-1">{n.desc}</span>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* ── 右：详情面板 ── */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <Reveal delay={0.15}>
              <div className="overflow-hidden rounded-[32px] border border-md-outline-variant/55 bg-md-surface-lowest shadow-pop">
                <div className="tint-hero relative flex items-end justify-between bg-md-primary-container/25 px-6 pt-5 dark:bg-md-primary-container/30">
                  <div className="pb-4">
                    <span className={cn("font-mono rounded-full px-3 py-1 text-[11px] font-bold", LAYER_TONE[node.layer.id].pill)}>
                      {node.layer.name} · {node.tag}
                    </span>
                  </div>
                  <div className="h-28 w-28 shrink-0 translate-y-2">
                    <MochiMascotSvg state={mascotState} physics={{ ...DEFAULT_PHYSICS, followCursor: false }} showSquircleBg={false} interactive={false} perfMode="auto" compactMode />
                  </div>
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.35, ease: [0.05, 0.7, 0.1, 1] }}
                    className="p-6 md:p-7"
                  >
                    <h3 className="font-display text-2xl font-extrabold text-md-on-surface">{node.name}</h3>
                    <p className="mt-2.5 text-sm leading-relaxed font-medium text-md-on-surface-variant">{node.desc}</p>
                    <div className="mt-5">
                      <p className="text-[11px] font-extrabold tracking-wider text-md-on-surface-variant/70 uppercase">源码线索</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {node.paths.map((p) => (
                          <span key={p} className="rounded-xl bg-md-surface-high px-3 py-1.5 font-mono text-[11.5px] font-medium text-md-on-surface-variant">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
                <div className="border-t border-md-outline-variant/50 bg-md-surface-low px-6 py-3.5">
                  <p className="text-xs font-bold text-md-on-surface-variant">👈 点左侧任意模块看详情 · 完整实现都在仓库里</p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
