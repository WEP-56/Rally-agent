import { AgentAvatar } from "./AgentAvatar";
import { useRef, useState } from "react";
import { Cpu, Brain } from "lucide-react";
import { useModels } from "../models";
import { useApp } from "../store";
import { Spark } from "./brand";
export function IdentityCard() {
  const { config } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, mx: 50, my: 50, on: false });
  const { state: models } = useModels();
  const main = models?.available.find(m => m.id === models.active?.model && m.provider === models.active?.provider);
  return (
    <div className="mb-7 flex justify-center py-2" style={{ perspective: 900 }}>
      <div
        ref={ref}
        onMouseMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          const px = (e.clientX - r.left) / r.width;
          const py = (e.clientY - r.top) / r.height;
          setT({ x: (0.5 - py) * 9, y: (px - 0.5) * 12, mx: px * 100, my: py * 100, on: true });
        }}
        onMouseLeave={() => setT({ x: 0, y: 0, mx: 50, my: 50, on: false })}
        className="relative aspect-[1.72] w-full max-w-[460px] overflow-hidden rounded-[26px] text-white"
        style={{
          background: "radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--c-accent) 42%, #14141f) 0%, transparent 60%), linear-gradient(150deg, #23233a 0%, #12121c 70%)",
          transform: `rotateX(${t.x}deg) rotateY(${t.y}deg)`,
          transition: t.on ? "transform 0.05s" : "transform 0.5s cubic-bezier(.2,.8,.2,1)",
          boxShadow: "0 1px 1px rgba(0,0,0,.2), 0 18px 30px -12px rgba(20,20,60,.45), 0 40px 60px -28px rgba(20,20,60,.5)",
        }}
      >
        <div className="pointer-events-none absolute inset-0 transition-opacity duration-300" style={{ opacity: t.on ? 1 : 0, background: `radial-gradient(circle at ${t.mx}% ${t.my}%, rgba(255,255,255,.22), transparent 45%)`, mixBlendMode: "soft-light" }} />
        <svg className="pointer-events-none absolute -right-16 -top-10 opacity-60" width="320" height="200" viewBox="-100 -60 200 120" aria-hidden>
          <g transform="rotate(-22)"><ellipse rx="88" ry="30" fill="none" stroke="var(--c-accent)" strokeWidth="1.6" strokeDasharray="420 140" strokeLinecap="round" /></g>
        </svg>
        <div className="pointer-events-none absolute -bottom-12 -right-4 select-none font-display text-[170px] font-extrabold leading-none text-white/[0.04]">R</div>
        <div className="relative flex h-full flex-col p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <AgentAvatar size={26} className="rounded-[8px]" />
              <span className="text-[10px] font-semibold tracking-[0.3em] text-white/60">RALLY · AGENT</span>
            </div>
            <span className="font-mono text-[10px] tracking-wider text-white/35">RALLY · LOCAL</span>
          </div>
          <div className="mt-auto">
            <div className="font-display text-[34px] font-semibold leading-none tracking-tight">{config.name || "Rally"}</div>
            <div className="mt-2 text-[12px] text-white/55">个人助手 · Personal Agent</div>
            <div className="mt-2.5 line-clamp-1 text-[11.5px] italic text-white/40">“{config.personality}”</div>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <div className="space-y-1 text-[10.5px] text-white/50">
              <div className="flex items-center gap-1.5"><Cpu size={11} />{main?.name ?? "未选择模型"}</div>
              <div title={config.memoryPath} className="flex max-w-[300px] items-center gap-1.5 font-mono"><Brain size={11} className="shrink-0" /><span className="truncate">{config.memoryPath}</span></div>
            </div>
            <Spark size={22} className="text-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── sections ───────────── */
