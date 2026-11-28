import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "../utils/cn";
import { DEPLOY_PLATFORMS, ONBOARDING, RELEASES } from "../data";
import { JellyButton, Reveal, SectionHead, SPRING_JELLY, WarnIcon, DownloadIcon, CheckIcon, Sparkle } from "./ui";

function PlatformIcon({ icon, className }: { icon: "windows" | "android" | "server"; className?: string }) {
  if (icon === "windows")
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
        <path d="M3.5 5.4 10.8 4.3v7.2H3.5V5.4zm0 13.2 7.3 1.1v-7.1H3.5v6zm8.1 1.2 9.1 1.4V12.6h-9.1v7.2zm0-15.6v7.3h9.1V2.8l-9.1 1.4z" />
      </svg>
    );
  if (icon === "android")
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M4.5 16.5a7.5 7.5 0 0 1 15 0v1h-15v-1z" fill="currentColor" stroke="none" />
        <path d="m6.8 7.2-1.6-2.6M17.2 7.2l1.6-2.6" />
        <circle cx="9.3" cy="13" r="0.9" fill="currentColor" stroke="none" />
        <circle cx="14.7" cy="13" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="3.5" y="4" width="17" height="6.5" rx="2.2" />
      <rect x="3.5" y="13.5" width="17" height="6.5" rx="2.2" />
      <circle cx="7.3" cy="7.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="7.3" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
      <path d="M13.5 7.2h4M13.5 16.8h4" />
    </svg>
  );
}

export function Deploy() {
  const [active, setActive] = useState("server");
  const platform = DEPLOY_PLATFORMS.find((p) => p.id === active)!;

  return (
    <section id="deploy" className="relative overflow-hidden bg-md-surface py-20 md:py-28">
      <div className="dotgrid absolute inset-0 opacity-40 [mask-image:radial-gradient(60%_50%_at_80%_20%,black,transparent)]" aria-hidden />
      <Sparkle className="absolute top-16 right-[6%] h-6 w-6" delay={0.9} />

      <div className="relative mx-auto max-w-6xl px-5">
        <SectionHead
          kicker="把 Rally 带回家"
          title={
            <>
              三种住法，<span className="text-md-primary">同一个 Rally</span>
            </>
          }
          desc="桌面端开箱即用；服务器端让它真正 24/7 在线，电脑和手机共享同一份记忆与任务。全部从 Releases 免费下载。"
        />

        <div className="grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
          {/* 平台选择 */}
          <div className="space-y-3">
            {DEPLOY_PLATFORMS.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.06}>
                <motion.button
                  type="button"
                  onClick={() => setActive(p.id)}
                  initial={false}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING_JELLY}
                  className={cn(
                    "state-layer flex w-full cursor-pointer items-center gap-4 rounded-[24px] border-2 p-4.5 text-left transition-colors",
                    active === p.id
                      ? "border-md-primary/50 bg-md-primary-fixed/40 shadow-float dark:bg-md-primary-container/30"
                      : "border-md-outline-variant/60 bg-md-surface-lowest hover:border-md-outline/50",
                  )}
                >
                  <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", active === p.id ? "bg-md-primary text-md-on-primary" : "bg-md-surface-high text-md-on-surface-variant")}>
                    <PlatformIcon icon={p.icon} className="h-6 w-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="font-display block text-[15.5px] font-extrabold text-md-on-surface">{p.name}</span>
                    <span className="block text-xs leading-snug font-semibold text-md-on-surface-variant">{p.headline}</span>
                  </span>
                  <span className={cn("ml-auto h-2.5 w-2.5 shrink-0 rounded-full transition-colors", active === p.id ? "bg-md-primary" : "bg-md-outline-variant")} />
                </motion.button>
              </Reveal>
            ))}

            {/* 小提醒 */}
            <Reveal delay={0.2}>
              <div className="flex gap-3 rounded-[24px] border border-rally-warn/30 bg-rally-warn-container/70 p-4.5">
                <WarnIcon className="h-5.5 w-5.5 shrink-0 text-rally-warn" />
                <div>
                  <p className="font-display text-[13.5px] font-extrabold text-rally-on-warn-container">小提醒</p>
                  <p className="mt-1 text-xs leading-relaxed font-semibold text-rally-on-warn-container/90">
                    Rally 会实际执行命令、修改文件，目前没有命令级沙箱。记得备份重要资料；模型请求会发往你配置的服务。
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          {/* 步骤详情 */}
          <Reveal delay={0.1}>
            <div className="h-full rounded-[30px] border border-md-outline-variant/55 bg-md-surface-lowest p-6 shadow-card md:p-8">
              <AnimatePresence mode="wait">
                <motion.div
                  key={platform.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.35, ease: [0.05, 0.7, 0.1, 1] }}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-md-primary-container text-md-on-primary-container">
                      <PlatformIcon icon={platform.icon} className="h-5.5 w-5.5" />
                    </span>
                    <h3 className="font-display text-xl font-extrabold text-md-on-surface md:text-2xl">{platform.headline}</h3>
                  </div>

                  <ol className="mt-6 space-y-4">
                    {platform.steps.map((s, i) => (
                      <motion.li
                        key={s.title}
                        initial={{ opacity: 0, x: -14 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ ...SPRING_JELLY, delay: 0.1 + i * 0.08 }}
                        className="flex items-start gap-3.5"
                      >
                        <span className="font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-md-secondary-container text-sm font-extrabold text-md-on-secondary-container">
                          {i + 1}
                        </span>
                        <div>
                          <p className="font-display text-[15px] font-extrabold text-md-on-surface">{s.title}</p>
                          <p className="mt-0.5 text-[13px] leading-relaxed font-medium text-md-on-surface-variant">{s.desc}</p>
                        </div>
                      </motion.li>
                    ))}
                  </ol>

                  {platform.code && (
                    <div className="codeblock mt-6 overflow-x-auto rounded-[20px] p-5 text-[12.5px] leading-relaxed">
                      {platform.code.map((line, i) => (
                        <p key={i} className="whitespace-pre">
                          {line.startsWith("#") ? (
                            <span className="cmt">{line}</span>
                          ) : line.trim() === "" ? (
                            "\u00A0"
                          ) : (
                            <>
                              <span className="mr-2 select-none opacity-40">$</span>
                              <span className="cmd">{line}</span>
                            </>
                          )}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="mt-6 flex flex-wrap gap-3">
                    <JellyButton href={RELEASES} external variant="filled" className="px-5 py-2.5 text-sm">
                      <DownloadIcon className="h-4.5 w-4.5" />
                      前往 Releases
                    </JellyButton>
                    {platform.id === "server" && (
                      <JellyButton href="https://github.com/WEP-56/Rally-agent/tree/master/deploy/linux" external variant="tonal" className="px-5 py-2.5 text-sm">
                        部署指南
                      </JellyButton>
                    )}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </Reveal>
        </div>

        {/* 第一次见面时间线 */}
        <Reveal delay={0.1}>
          <div className="mt-14 rounded-[30px] border border-md-outline-variant/55 bg-md-surface-lowest/70 p-6 shadow-card backdrop-blur-sm md:p-8">
            <h3 className="font-display text-lg font-extrabold text-md-on-surface">第一次见面 👋</h3>
            <div className="relative mt-7 grid gap-6 sm:grid-cols-3 lg:grid-cols-5">
              <svg className="absolute top-5 right-[10%] left-[10%] hidden h-2.5 lg:block" preserveAspectRatio="none" viewBox="0 0 100 10" aria-hidden>
                <path d="M0 5 Q 25 0, 50 5 T 100 5" fill="none" strokeWidth="1.6" className="flowline" style={{ stroke: "var(--md-sys-color-outline-variant)" }} />
              </svg>
              {ONBOARDING.map((o, i) => (
                <motion.div
                  key={o.step}
                  initial={{ opacity: 0, y: 18 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ ...SPRING_JELLY, delay: i * 0.09 }}
                  className="relative text-center"
                >
                  <span
                    className={cn(
                      "font-display relative z-10 mx-auto flex h-10 w-10 items-center justify-center rounded-full border-4 border-md-surface-lowest text-sm font-extrabold shadow-card",
                      ["bg-mochi-coral text-[#4a1f16]", "bg-mochi-gold text-[#5c400e]", "bg-mochi-violet text-white", "bg-md-primary text-md-on-primary", "bg-rally-ok text-white"][i],
                    )}
                  >
                    {i + 1}
                  </span>
                  <p className="font-display mt-3 text-sm font-extrabold text-md-on-surface">{o.step}</p>
                  <p className="mt-1 text-xs leading-snug font-semibold text-md-on-surface-variant">{o.desc}</p>
                </motion.div>
              ))}
            </div>
            <p className="mt-7 flex items-center justify-center gap-1.5 text-center text-xs font-bold text-md-on-surface-variant">
              <CheckIcon className="h-3.5 w-3.5 text-rally-ok" />
              云端连接需要在服务器控制台为每台设备生成接入密钥——一台设备一把钥匙。
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
