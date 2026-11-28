import { motion } from "motion/react";
import { CheckIcon, Reveal, SPRING_JELLY, SectionHead } from "./ui";
import { SEED_PRESETS, useTheme } from "../theme";
import { cn } from "../utils/cn";

const TOKENS = [
  { name: "surface", v: "--md-sys-color-surface", on: "--md-sys-color-on-surface" },
  { name: "surface-container", v: "--md-sys-color-surface-container", on: "--md-sys-color-on-surface" },
  { name: "primary", v: "--md-sys-color-primary", on: "--md-sys-color-on-primary" },
  { name: "primary-container", v: "--md-sys-color-primary-container", on: "--md-sys-color-on-primary-container" },
  { name: "secondary-container", v: "--md-sys-color-secondary-container", on: "--md-sys-color-on-secondary-container" },
  { name: "tertiary-container", v: "--md-sys-color-tertiary-container", on: "--md-sys-color-on-tertiary-container" },
  { name: "ok-container", v: "--rally-color-ok-container", on: "--rally-color-on-ok-container" },
  { name: "warn-container", v: "--rally-color-warn-container", on: "--rally-color-on-warn-container" },
];

const RADII = [8, 12, 16, 20, 28, 32];

const FACTS = [
  { k: "种子色", v: "#33658E 雾霭蓝，由 SchemeFidelity 生成整套配色" },
  { k: "圆角", v: "8 · 12 · 16 · 20 · 28 · 32，和客户端同一套刻度" },
  { k: "弹簧", v: "stiffness 520 · damping 16：按下有回弹，松开会 Q 一下" },
  { k: "主题", v: "深浅两套由同一个种子色推导，切换不跳色" },
];

export function Design() {
  const { seed, setSeed, seedName } = useTheme();

  return (
    <section id="design" className="relative py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid items-start gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div>
            <SectionHead
              kicker="所见即所得"
              title={
                <>
                  这个官网，<span className="text-md-primary">和你即将安装的软件</span>是同一套设计
                </>
              }
              desc="颜色、圆角、弹簧动画都来自 Rally 客户端的 MD3 token。你在这里看到的按钮、卡片与门禁，装上之后就是这个手感。"
            />
            <div className="space-y-3">
              {FACTS.map((fact, i) => (
                <Reveal key={fact.k} delay={i * 0.06}>
                  <div className="flex items-start gap-3 rounded-[22px] bg-md-surface-lowest/80 px-4 py-3.5 shadow-card">
                    <span className="font-display mt-0.5 shrink-0 rounded-full bg-md-tertiary-container px-2.5 py-0.5 text-xs font-extrabold text-md-on-tertiary-container">{fact.k}</span>
                    <span className="text-[13.5px] leading-relaxed font-medium text-md-on-surface-variant">{fact.v}</span>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>

          <Reveal delay={0.1}>
            <div className="space-y-5 rounded-[32px] border border-md-outline-variant/50 bg-md-surface-lowest p-6 shadow-card md:p-7">
              {/* 种子色：实时换整站配色 */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-display text-sm font-extrabold text-md-on-surface">种子色</span>
                  <span className="rounded-full bg-md-surface-high px-3 py-1 text-xs font-bold text-md-on-surface-variant">当前：{seedName}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {SEED_PRESETS.map((preset) => (
                    <motion.button
                      key={preset.id}
                      type="button"
                      onClick={() => setSeed(preset.hex)}
                      whileHover={{ scale: 1.14 }}
                      whileTap={{ scale: 0.86 }}
                      transition={SPRING_JELLY}
                      aria-label={`主题色 ${preset.name}`}
                      title={preset.name}
                      className={cn("relative h-10 w-10 cursor-pointer rounded-full border-4", seed === preset.hex ? "border-md-on-surface/20 shadow-float" : "border-md-surface-lowest shadow-card")}
                      style={{ background: preset.hex }}
                    >
                      {seed === preset.hex && (
                        <span className="absolute inset-0 flex items-center justify-center text-white">
                          <CheckIcon className="h-4 w-4" />
                        </span>
                      )}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* token 色块 */}
              <div>
                <span className="font-display text-sm font-extrabold text-md-on-surface">色彩 token</span>
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {TOKENS.map((token) => (
                    <div key={token.name} className="overflow-hidden rounded-[18px] shadow-card" style={{ background: `var(${token.v})` }}>
                      <div className="px-3 py-3.5 font-mono text-[11px] font-bold" style={{ color: `var(${token.on})` }}>
                        {token.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 圆角刻度 */}
              <div>
                <span className="font-display text-sm font-extrabold text-md-on-surface">圆角刻度</span>
                <div className="mt-3 flex items-end gap-3">
                  {RADII.map((r) => (
                    <div key={r} className="flex flex-col items-center gap-1.5">
                      <div className="h-12 w-12 bg-md-primary-container" style={{ borderRadius: r }} />
                      <span className="font-mono text-[10.5px] font-bold text-md-on-surface-variant">{r}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 弹簧：可以拖 */}
              <div className="rounded-[24px] bg-md-surface-low p-5">
                <span className="font-display text-sm font-extrabold text-md-on-surface">Q 弹手感</span>
                <p className="mt-1 text-xs font-semibold text-md-on-surface-variant">拖动或按住下面的胶囊，松手时它会弹回来。</p>
                <div className="relative mt-4 flex h-20 items-center justify-center overflow-hidden rounded-[18px] bg-md-surface-lowest">
                  <motion.div
                    drag
                    dragConstraints={{ left: -140, right: 140, top: -20, bottom: 20 }}
                    dragElastic={0.35}
                    whileDrag={{ scale: 1.08 }}
                    whileTap={{ scale: 0.92 }}
                    transition={SPRING_JELLY}
                    className="font-display cursor-grab rounded-full bg-md-primary px-6 py-2.5 text-sm font-extrabold text-md-on-primary shadow-jelly active:cursor-grabbing"
                  >
                    拖我试试 ✦
                  </motion.div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 font-mono text-[10.5px] font-bold text-md-on-surface-variant">
                  <span className="rounded-full bg-md-surface-lowest px-2.5 py-1">stiffness 520</span>
                  <span className="rounded-full bg-md-surface-lowest px-2.5 py-1">damping 16</span>
                  <span className="rounded-full bg-md-surface-lowest px-2.5 py-1">mass 0.68</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
