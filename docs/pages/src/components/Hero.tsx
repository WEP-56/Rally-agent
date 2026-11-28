import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Clock, Shield, Sparkles } from "lucide-react";
import { MochiMascotSvg } from "../rally/mascot/MochiMascotSvg";
import { DEFAULT_PHYSICS } from "../rally/mascot/types";
import { Critter } from "../rally/critter";
import { RELEASES } from "../data";
import { JellyButton, SPRING_JELLY, GitHubIcon, DownloadIcon } from "./ui";

/* 背景色块：位置是场景宽高的比例，depth 决定被鼠标牵引的强度 */
const BLOBS = [
  { x: 0.52, y: 0.08, w: 150, h: 150, r: 46, color: "var(--md-sys-color-primary-container)", depth: 0.6 },
  { x: 0.86, y: 0.16, w: 112, h: 112, r: 36, color: "#fa9e8e", depth: 0.9 },
  { x: 0.66, y: 0.56, w: 200, h: 200, r: 60, color: "var(--md-sys-color-tertiary-container)", depth: 0.4 },
  { x: 0.93, y: 0.66, w: 96, h: 96, r: 30, color: "#fdcb58", depth: 1.1 },
  { x: 0.44, y: 0.82, w: 124, h: 124, r: 40, color: "#dacafd", depth: 0.7 },
  { x: 0.36, y: 0.04, w: 72, h: 72, r: 24, color: "var(--md-sys-color-secondary-container)", depth: 1.0 },
];

/** 单个 rAF 循环：色块飘动并被指针吸引（靠近时融合），卡片做视差 */
function useScene(sceneRef: RefObject<HTMLDivElement | null>, blobRefs: RefObject<(HTMLDivElement | null)[]>, cardRefs: RefObject<(HTMLDivElement | null)[]>) {
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const pointer = { x: 0, y: 0, active: false };
    const current = BLOBS.map(() => ({ x: 0, y: 0 }));
    const cardCurrent = [0, 0, 0, 0].map(() => ({ x: 0, y: 0 }));
    let raf = 0;
    const start = performance.now();

    const onMove = (event: PointerEvent) => {
      const box = scene.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    const hero = scene.parentElement ?? scene;
    hero.addEventListener("pointermove", onMove);
    hero.addEventListener("pointerleave", onLeave);

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const box = scene.getBoundingClientRect();
      const W = box.width;
      const H = box.height;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      BLOBS.forEach((blob, i) => {
        const el = blobRefs.current[i];
        if (!el) return;
        const homeX = blob.x * W - blob.w / 2;
        const homeY = blob.y * H - blob.h / 2;
        const drift = reduce ? { x: 0, y: 0 } : { x: Math.sin(t * 0.6 + i * 1.7) * 14, y: Math.cos(t * 0.5 + i * 2.3) * 12 };
        // 指针靠近时，色块被吸过去；离得远则回到原位
        const cx = homeX + drift.x + blob.w / 2;
        const cy = homeY + drift.y + blob.h / 2;
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        const influence = pointer.active ? Math.max(0, 1 - Math.hypot(dx, dy) / 380) : 0;
        const target = { x: homeX + drift.x + dx * influence * 0.42 * blob.depth, y: homeY + drift.y + dy * influence * 0.42 * blob.depth };
        const state = current[i];
        state.x += (target.x - state.x) * 0.085;
        state.y += (target.y - state.y) * 0.085;
        el.style.transform = `translate3d(${state.x.toFixed(2)}px, ${state.y.toFixed(2)}px, 0)`;
      });

      const nx = pointer.active ? (pointer.x / W - 0.5) * 2 : 0;
      const ny = pointer.active ? (pointer.y / H - 0.5) * 2 : 0;
      cardRefs.current.forEach((el, i) => {
        if (!el) return;
        const depth = [0.9, 1.4, 0.7, 1.1][i];
        const target = { x: nx * depth * 16, y: ny * depth * 12 };
        const state = cardCurrent[i];
        state.x += (target.x - state.x) * 0.08;
        state.y += (target.y - state.y) * 0.08;
        el.style.translate = `${state.x.toFixed(2)}px ${state.y.toFixed(2)}px`;
      });

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
    };
  }, [sceneRef, blobRefs, cardRefs]);
}

/* ───────────────────────── 前景卡片 ───────────────────────── */

/** 外层 div 接收鼠标视差（translate），内层做上下漂浮（animate-floaty） */
function FloatCard({ children, cardRef }: { children: ReactNode; cardRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div ref={cardRef}>
      <div className="animate-floaty">{children}</div>
    </div>
  );
}

function MascotCard() {
  const [pokes, setPokes] = useState(0);
  return (
    <div className="w-[190px] rounded-[30px] border border-md-outline-variant/50 bg-md-surface-lowest p-3 shadow-float">
      <div className="flex justify-center" onClick={() => setPokes((n) => n + 1)} title="戳戳它">
        <div className="h-[150px] w-[150px] cursor-pointer select-none">
          <MochiMascotSvg state={pokes % 2 ? "completed" : "idle"} physics={DEFAULT_PHYSICS} size="100%" perfMode="auto" />
        </div>
      </div>
      <div className="font-display mt-1 rounded-2xl bg-md-primary-container px-3 py-1.5 text-center text-xs font-bold text-md-on-primary-container">
        {pokes === 0 ? "我在呢～戳戳我 ♡" : `被戳了 ${pokes} 次啦`}
      </div>
    </div>
  );
}

function TaskCard() {
  return (
    <div className="w-[230px] rounded-[24px] border border-md-outline-variant/50 bg-md-surface-lowest p-3.5 shadow-float">
      <div className="flex items-center gap-2.5">
        <Critter seed="d2q7" size={40} />
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold text-md-on-surface">整理下载文件夹</div>
          <div className="text-[11px] text-md-on-surface-variant">47/47 已归类 · 0 冲突</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <span className="inline-flex h-[21px] items-center gap-1.5 rounded-full bg-rally-ok-container px-2.5 text-[11px] font-semibold text-rally-on-ok-container">
          <span className="h-1.5 w-1.5 rounded-full bg-rally-ok" />
          已完成
        </span>
        <span className="font-mono text-[10.5px] text-md-on-surface-variant/70">D2Q7 · 18s</span>
      </div>
    </div>
  );
}

function GateCardMini() {
  const [allowed, setAllowed] = useState(false);
  return (
    <div className="w-[248px] rounded-[26px] bg-md-surface-high p-2 shadow-float">
      <div className="flex items-center gap-1.5 rounded-[20px] bg-rally-warn-container px-3 py-1.5 text-[11px] font-semibold text-rally-on-warn-container">
        <Shield size={12} />
        请求不可逆操作
      </div>
      <div className="px-2.5 pt-2 pb-1.5">
        <div className="text-[13px] font-semibold text-md-on-surface">发送周报邮件到 you@qq.com</div>
        <div className="mt-0.5 text-[11px] text-md-on-surface-variant">发送后无法撤回</div>
        <div className="mt-2.5 flex justify-end gap-1.5">
          {allowed ? (
            <span className="inline-flex h-8 items-center rounded-full bg-rally-ok-container px-3.5 text-xs font-bold text-rally-on-ok-container">✓ 已允许</span>
          ) : (
            <>
              <button type="button" onClick={() => setAllowed(false)} className="h-8 cursor-pointer rounded-full bg-md-surface-lowest/85 px-3.5 text-xs font-bold text-md-on-surface">
                拒绝
              </button>
              <motion.button
                type="button"
                onClick={() => setAllowed(true)}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.9 }}
                transition={SPRING_JELLY}
                className="h-8 cursor-pointer rounded-full bg-md-primary px-3.5 text-xs font-bold text-md-on-primary"
              >
                确认发送
              </motion.button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleChip() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-md-outline-variant/50 bg-md-surface-lowest px-4 py-2.5 text-[12.5px] font-semibold text-md-on-surface shadow-float">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-md-secondary-container text-md-on-secondary-container">
        <Clock size={14} />
      </span>
      每 2 小时盯价 · 下次 14:00
    </div>
  );
}

/* ───────────────────────── 首屏 ───────────────────────── */

export function Hero() {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const blobRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  useScene(sceneRef, blobRefs, cardRefs);

  const cardRef = (index: number) => (el: HTMLDivElement | null) => {
    cardRefs.current[index] = el;
  };

  return (
    <section id="top" className="relative flex min-h-[100svh] items-center overflow-hidden pt-24 pb-16 md:pt-28">
      <div className="pointer-events-none absolute inset-0 bg-md-surface-container" aria-hidden />
      {/* 点阵底纹 */}
      <div className="dotgrid absolute inset-0 opacity-60 [mask-image:radial-gradient(80%_70%_at_50%_40%,black,transparent)]" aria-hidden />

      {/* 场景：goo 滤镜让相邻色块融合成一团 */}
      <div ref={sceneRef} className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0" style={{ filter: "url(#rally-goo)" }}>
          {BLOBS.map((blob, i) => (
            <div
              key={i}
              ref={(el) => {
                blobRefs.current[i] = el;
              }}
              className="absolute top-0 left-0 opacity-[0.78]"
              style={{ width: blob.w, height: blob.h, borderRadius: blob.r, background: blob.color }}
            />
          ))}
        </div>
      </div>

      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id="rally-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="11" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>

      {/* 前景卡片：只在宽屏显示，避免压住文字 */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="pointer-events-auto absolute top-[12%] left-[60%]">
          <FloatCard cardRef={cardRef(0)}>
            <MascotCard />
          </FloatCard>
        </div>
        <div className="pointer-events-auto absolute top-[46%] left-[79%]">
          <FloatCard cardRef={cardRef(1)}>
            <TaskCard />
          </FloatCard>
        </div>
        <div className="pointer-events-auto absolute top-[64%] left-[58%]">
          <FloatCard cardRef={cardRef(2)}>
            <GateCardMini />
          </FloatCard>
        </div>
        <div className="pointer-events-auto absolute top-[84%] left-[74%]">
          <FloatCard cardRef={cardRef(3)}>
            <ScheduleChip />
          </FloatCard>
        </div>
      </div>

      {/* 文字 */}
      <div className="relative z-10 mx-auto w-full max-w-6xl px-5">
        <div className="max-w-[640px]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.05, 0.7, 0.1, 1] }}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-md-outline-variant/70 bg-md-surface-lowest/70 px-3.5 py-1.5 text-xs font-bold text-md-on-surface-variant backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-breathe rounded-full bg-rally-ok" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rally-ok" />
              </span>
              开源 · MIT 协议
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-md-secondary-container px-3.5 py-1.5 text-xs font-bold text-md-on-secondary-container">
              <Sparkles size={13} />
              你的 AI 开发合伙人
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08, ease: [0.05, 0.7, 0.1, 1] }}
            className="font-display mt-6 text-[clamp(2.4rem,6vw,4.2rem)] leading-[1.08] font-extrabold text-md-on-surface"
          >
            你自己的全能
            <br />
            <span className="relative inline-block">
              <span className="relative z-10 text-md-primary">24/7</span>
              <motion.span
                aria-hidden
                className="absolute inset-x-[-6px] inset-y-[12%] -z-0 rounded-[14px] bg-mochi-gold/45"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.75, duration: 0.5, ease: [0.2, 0, 0, 1] }}
                style={{ originX: 0, rotate: -1.2 }}
              />
            </span>{" "}
            <span className="relative inline-block">
              personal agent
              <svg viewBox="0 0 220 26" className="absolute -bottom-2 left-0 h-[0.28em] w-full" fill="none" aria-hidden preserveAspectRatio="none">
                <path d="M6 17C40 7 62 21 96 14c34-7 46-9 72-4 18 3 34 4 46 1" stroke="#FA9E8E" strokeWidth="7" strokeLinecap="round" />
              </svg>
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.2, ease: [0.05, 0.7, 0.1, 1] }}
            className="font-display mt-7 text-lg font-bold text-md-primary md:text-xl"
          >
            有点记性，有点本领，还想多帮你一点。✨
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.28, ease: [0.05, 0.7, 0.1, 1] }}
            className="mt-3 max-w-xl text-[15px] leading-relaxed font-medium text-md-on-surface-variant md:text-base"
          >
            它不只是写代码的工具：陪你聊想法，打开浏览器、整理文件、写代码，帮你打理琐事、连接飞书和 GitHub 这些服务。任务多了，就叫上几位 Worker 一起搭把手。
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.36, ease: [0.05, 0.7, 0.1, 1] }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <JellyButton href="#workstation" variant="filled">
              <Sparkles size={18} />
              坐到数字工位上
            </JellyButton>
            <JellyButton href="#deploy" variant="tonal">
              <DownloadIcon className="h-5 w-5" />
              把 Rally 带回家
            </JellyButton>
            <JellyButton href="https://github.com/WEP-56/Rally-agent" external variant="outline" className="hidden sm:inline-flex">
              <GitHubIcon className="h-5 w-5" />
              GitHub
            </JellyButton>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.55 }}
            className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-bold text-md-on-surface-variant"
          >
            {["Windows 桌面", "Android 8+", "Linux 服务器"].map((p, i) => (
              <span key={p} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${["bg-mochi-coral", "bg-rally-ok", "bg-mochi-violet"][i]}`} />
                {p}
              </span>
            ))}
            <a href={RELEASES} target="_blank" rel="noreferrer" className="underline decoration-2 underline-offset-4 hover:text-md-on-surface">
              去 Releases 下载
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
