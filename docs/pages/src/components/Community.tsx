import { motion } from "motion/react";
import { useState } from "react";
import { ISSUES, LINUXDO, RELEASES, REPO } from "../data";
import { MochiMascotSvg } from "../rally/mascot/MochiMascotSvg";
import { DEFAULT_PHYSICS } from "../rally/mascot/types";
import { Reveal, Sparkle, SPRING_JELLY, GitHubIcon, HeartIcon, Petal } from "./ui";

const LINKS = [
  { href: REPO, label: "GitHub 仓库", desc: "源码 · Star 一下", icon: "⭐" },
  { href: RELEASES, label: "Releases", desc: "三个平台的安装包", icon: "📦" },
  { href: ISSUES, label: "Issues", desc: "小毛病与好点子", icon: "💬" },
  { href: LINUXDO, label: "LinuxDo 社区", desc: "和佬友们一起养大它", icon: "🌱" },
];

export function Community() {
  const [poked, setPoked] = useState(0);

  return (
    <section id="github" className="relative overflow-hidden py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <Reveal>
          <div className="relative overflow-hidden rounded-[40px] bg-[#212936] px-6 py-12 text-[#e8edf4] shadow-pop md:px-14 md:py-16">
            {/* 深色卡片内的氛围 */}
            <div
              className="absolute inset-0 opacity-60"
              aria-hidden
              style={{
                background:
                  "radial-gradient(520px 320px at 15% 10%, rgba(140,113,227,0.28), transparent 70%), radial-gradient(460px 300px at 85% 85%, rgba(250,158,142,0.22), transparent 70%), radial-gradient(380px 260px at 70% 10%, rgba(253,203,88,0.14), transparent 70%)",
              }}
            />
            <Sparkle className="absolute top-10 left-[45%] h-5 w-5 opacity-80" delay={0.5} />
            <Sparkle className="absolute right-[30%] bottom-12 h-7 w-7 opacity-70" delay={1.5} />
            <Petal className="absolute top-12 left-[8%] h-8 w-8 opacity-40" delay={0.9} />

            <div className="relative grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <span className="font-display inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-bold tracking-wide text-white/85 backdrop-blur">
                  <HeartIcon className="h-3.5 w-3.5 text-mochi-coral" />
                  开源 · MIT 协议 · 社区共建
                </span>
                <h2 className="font-display mt-5 text-[clamp(1.9rem,4.4vw,3rem)] leading-[1.12] font-extrabold text-white">
                  一起来，
                  <br />
                  把 Rally <span className="text-mochi-gold">养大</span>
                </h2>
                <p className="mt-4 max-w-lg text-[15px] leading-relaxed font-medium text-white/75">
                  Rally 站在 <a href="https://github.com/earendil-works/pi" target="_blank" rel="noreferrer" className="font-bold text-md-primary-fixed-dim underline decoration-2 underline-offset-4 hover:text-white">Pi</a> 和它的贡献者肩膀上出发。
                  遇到小毛病、冒出好点子，都欢迎来 Issues 留言；日常的碎碎念和开发交流，我们在 LinuxDo 社区等你。
                </p>

                <div className="mt-8 grid max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {LINKS.map((l) => (
                    <motion.a
                      key={l.label}
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      initial={false}
                      whileHover={{ scale: 1.03, y: -2 }}
                      whileTap={{ scale: 0.95 }}
                      transition={SPRING_JELLY}
                      className="state-layer flex cursor-pointer items-center gap-3 rounded-[20px] border border-white/12 bg-white/8 px-4 py-3.5 backdrop-blur"
                    >
                      <span className="text-xl">{l.icon}</span>
                      <span>
                        <span className="font-display block text-sm font-extrabold text-white">{l.label}</span>
                        <span className="block text-[11.5px] font-semibold text-white/60">{l.desc}</span>
                      </span>
                    </motion.a>
                  ))}
                </div>

                <motion.a
                  href={REPO}
                  target="_blank"
                  rel="noreferrer"
                  initial={false}
                  whileHover={{ scale: 1.035 }}
                  whileTap={{ scale: 0.94 }}
                  transition={SPRING_JELLY}
                  className="state-layer font-display mt-6 inline-flex cursor-pointer items-center gap-2.5 rounded-full bg-md-primary-fixed-dim px-7 py-3.5 text-[15px] font-extrabold text-md-on-primary-fixed shadow-[0_14px_40px_-10px_rgba(156,203,249,0.55)]"
                >
                  <GitHubIcon className="h-5 w-5" />
                  前往 GitHub · WEP-56/Rally-agent
                </motion.a>
              </div>

              <div className="relative mx-auto w-full max-w-sm">
                <div className="cursor-pointer select-none" onClick={() => setPoked((n) => n + 1)} title="戳戳它">
                  <MochiMascotSvg state={poked > 0 ? "completed" : "idle"} physics={DEFAULT_PHYSICS} size="100%" perfMode="auto" />
                </div>
                <p className="font-display mt-2 text-center text-xs font-bold text-white/55">
                  它已经准备好了 · 戳一下算打过招呼 {poked > 0 && `· 被戳 ×${poked}`}
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-md-outline-variant/50 bg-md-surface-low">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-10 text-center md:flex-row md:justify-between md:text-left">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}images/rally-favicon.png`} alt="Rally" className="h-10 w-10 rounded-[13px]" />
          <div>
            <p className="font-display text-base leading-tight font-extrabold text-md-on-surface">Rally</p>
            <p className="text-xs font-semibold text-md-on-surface-variant">有点记性，有点本领，还想多帮你一点。✨</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px] font-bold text-md-on-surface-variant">
          <a href={REPO} target="_blank" rel="noreferrer" className="state-layer rounded-md hover:text-md-on-surface">GitHub</a>
          <a href="https://github.com/WEP-56/Rally-agent/tree/master/docs" target="_blank" rel="noreferrer" className="state-layer rounded-md hover:text-md-on-surface">使用与开发文档</a>
          <a href="https://github.com/WEP-56/Rally-agent/blob/master/LICENSE" target="_blank" rel="noreferrer" className="state-layer rounded-md hover:text-md-on-surface">MIT License</a>
          <a href={LINUXDO} target="_blank" rel="noreferrer" className="state-layer rounded-md hover:text-md-on-surface">LinuxDo</a>
        </div>
        <p className="flex items-center gap-1.5 text-xs font-semibold text-md-on-surface-variant/80">
          基于 Pi 构建 · 用 <HeartIcon className="h-3.5 w-3.5 text-mochi-coral" /> 和 ☕ 养大
        </p>
      </div>
    </footer>
  );
}
