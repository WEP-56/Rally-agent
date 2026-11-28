import { motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { CONNECTORS, type Connector } from "../data";
import { cn } from "../utils/cn";
import { Reveal, SectionHead, SPRING_JELLY, Sparkle } from "./ui";

/* 画布坐标系：1000 × 625（16:10），节点在画布里用百分比定位，两者必须同比例。 */
const VIEW_W = 1000;
const VIEW_H = 625;
const HUB = { x: VIEW_W / 2, y: VIEW_H / 2 };

/** 八个插头沿椭圆均匀分布，从正上方开始顺时针排列 */
function nodePosition(index: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / CONNECTORS.length;
  return { x: 50 + 39 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) };
}

/** 电缆：从中心弯向插头，控制点略微偏移，看起来更像真的线 */
function cablePath(x: number, y: number) {
  const nx = (x / 100) * VIEW_W;
  const ny = (y / 100) * VIEW_H;
  const midX = (HUB.x + nx) / 2;
  const midY = (HUB.y + ny) / 2;
  const cx = midX - (ny - HUB.y) * 0.18;
  const cy = midY + (nx - HUB.x) * 0.18;
  return `M ${HUB.x} ${HUB.y} Q ${cx} ${cy} ${nx} ${ny}`;
}

/** 一个插头：顶部的插销会在插入（进入插座）与拔出之间弹跳 */
function PlugNode({
  connector,
  plugged,
  onToggle,
  className,
  style,
}: {
  connector: Connector;
  plugged: boolean;
  onToggle: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-pressed={plugged}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.93 }}
      transition={SPRING_JELLY}
      className={cn(
        "group relative flex cursor-pointer flex-col items-center rounded-[24px] border px-3 pt-5 pb-3.5 text-center transition-colors duration-300",
        plugged ? "border-md-primary/30 bg-md-surface-lowest shadow-float" : "border-dashed border-md-outline-variant bg-md-surface-low/85",
        className,
      )}
      style={style}
    >
      {/* 插销：插上时落进插座，拔掉时抬起来 */}
      <motion.span
        initial={false}
        animate={{ y: plugged ? 0 : -16, rotate: plugged ? 0 : -14 }}
        transition={SPRING_JELLY}
        className="absolute -top-3.5 left-1/2 flex -translate-x-1/2 flex-col items-center"
        aria-hidden
      >
        <span className="flex h-1.5 gap-1.5">
          <span className="h-full w-[3px] rounded-full bg-md-on-surface-variant" />
          <span className="h-full w-[3px] rounded-full bg-md-on-surface-variant" />
        </span>
        <span className="h-[9px] w-7 rounded-[4px] bg-md-on-surface-variant" />
      </motion.span>

      <span
        className="flex h-11 w-11 items-center justify-center rounded-[14px] text-[14px] font-extrabold transition-colors duration-300"
        style={{
          color: plugged ? connector.color : "var(--md-sys-color-outline)",
          background: plugged ? `color-mix(in srgb, ${connector.color} 14%, var(--md-sys-color-surface-container-lowest))` : "var(--md-sys-color-surface-container)",
        }}
      >
        {connector.mark}
      </span>
      <span className="font-display mt-2 text-[13.5px] font-extrabold text-md-on-surface">{connector.name}</span>
      <span className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug font-semibold text-md-on-surface-variant">{connector.desc}</span>
      <span
        className={cn(
          "mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold transition-colors duration-300",
          plugged ? "bg-rally-ok-container text-rally-on-ok-container" : "bg-md-surface-high text-md-on-surface-variant",
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", plugged ? "bg-rally-ok" : "bg-md-outline")} />
        {plugged ? "已插上" : "未连接"}
      </span>
    </motion.button>
  );
}

export function Connections() {
  const [plugs, setPlugs] = useState<Record<string, boolean>>(() => Object.fromEntries(CONNECTORS.map((c) => [c.id, c.plugged])));
  const count = CONNECTORS.filter((c) => plugs[c.id]).length;
  const toggle = (id: string) => setPlugs((current) => ({ ...current, [id]: !current[id] }));

  return (
    <section id="connect" className="relative overflow-hidden py-20 md:py-28">
      <Sparkle className="absolute top-20 left-[6%] h-6 w-6" delay={0.2} />
      <div className="relative mx-auto max-w-6xl px-5">
        <SectionHead
          kicker="连接无处不在"
          title={
            <>
              插上就能用，<span className="text-md-primary">拔掉就停</span>
            </>
          }
          desc="飞书、QQ、邮箱、SSH、GitHub，以及你自己接入的 MCP 服务，都是 Rally 的插头。点一下任何一个试试插拔。"
        />

        {/* 宽屏：中心插座 + 电缆 */}
        <Reveal>
          <div className="relative mx-auto hidden aspect-[16/10] w-full max-w-[880px] md:block">
            <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="absolute inset-0 h-full w-full" aria-hidden>
              {CONNECTORS.map((connector, i) => {
                const { x, y } = nodePosition(i);
                const plugged = plugs[connector.id];
                return (
                  <g key={connector.id}>
                    <path d={cablePath(x, y)} fill="none" strokeWidth="2" strokeDasharray="6 8" className="stroke-md-outline-variant" />
                    <motion.path
                      d={cablePath(x, y)}
                      fill="none"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      className="stroke-md-primary"
                      initial={false}
                      animate={{ pathLength: plugged ? 1 : 0, opacity: plugged ? 1 : 0 }}
                      transition={{ duration: 0.6, ease: [0.2, 0.9, 0.3, 1.15] }}
                    />
                  </g>
                );
              })}
            </svg>

            <div className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
              <div className="relative">
                <span className="animate-breathe absolute inset-[-16px] rounded-[44px] bg-md-primary/10" aria-hidden />
                <div className="flex h-[96px] w-[96px] items-center justify-center rounded-[32px] bg-md-primary-container shadow-jelly">
                  <img src={`${import.meta.env.BASE_URL}images/rally-mark.png`} alt="Rally" className="h-[68px] w-[68px] object-contain" draggable={false} />
                </div>
              </div>
              <span className="font-display mt-3 text-sm font-extrabold text-md-on-surface">Rally</span>
              <span className="text-[11px] font-bold text-md-on-surface-variant">已连接 {count} / {CONNECTORS.length}</span>
            </div>

            {CONNECTORS.map((connector, i) => {
              const { x, y } = nodePosition(i);
              return (
                <PlugNode
                  key={connector.id}
                  connector={connector}
                  plugged={plugs[connector.id]}
                  onToggle={() => toggle(connector.id)}
                  className="absolute z-20 w-[150px] -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x}%`, top: `${y}%` }}
                />
              );
            })}
          </div>
        </Reveal>

        {/* 窄屏：同样的插头，网格排列，没有电缆 */}
        <div className="grid grid-cols-2 gap-3 md:hidden">
          {CONNECTORS.map((connector) => (
            <PlugNode key={connector.id} connector={connector} plugged={plugs[connector.id]} onToggle={() => toggle(connector.id)} />
          ))}
        </div>

        <Reveal delay={0.1}>
          <p className="mt-8 text-center text-xs font-semibold text-md-on-surface-variant/75">
            每个插头的工具权限都统一在客户端「连接」页里设置：可逆直接执行，对外留审计，不可逆先问你。MCP 服务由你自己配置。
          </p>
        </Reveal>
      </div>
    </section>
  );
}
