import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, Rocket, Brain, Server, Cpu, UserRound } from "lucide-react";
import { modelLabel, useApp } from "../store";
import { cn } from "../utils/cn";
import { Button, RallyLogo } from "./ui";
import { IdentityForm, MemoryForm, ModelUsageForm, ProvidersForm } from "./forms";
import { WindowControls } from "./TitleBar";

const STEPS = [
  { key: "welcome" },
  { key: "identity", title: "认识一下你的 Agent", desc: "给它起个名字，设定性格和工作方式。这些都可以稍后在设置中修改。", skippable: true },
  { key: "memory", title: "记忆存放在哪里", desc: "Rally 会把长期记忆保存在本地目录，完全由你掌控。", skippable: true },
  { key: "providers", title: "添加模型供应商", desc: "填写 Base URL 与 API Key，获取可用模型。支持添加多个供应商。", skippable: true },
  { key: "models", title: "设置模型用途", desc: "主代理与工位任务可以使用不同的模型，兼顾能力与成本。", skippable: false },
  { key: "done" },
];

export function Onboarding({ onDone, maximized, onMin, onMax, onClose }: { onDone: () => void; maximized: boolean; onMin: () => void; onMax: () => void; onClose: () => void }) {
  const { config } = useApp();
  const [step, setStep] = useState(0);
  const last = STEPS.length - 1;
  const next = () => setStep((s) => Math.min(last, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowRight" && step > 0 && step < last) next();
      if (e.key === "ArrowLeft" && step > 1) prev();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const s = STEPS[step];

  return (
    <div className="absolute inset-0 z-[100] flex flex-col overflow-hidden bg-app">
      {/* ambient */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-60 blur-3xl transition-all duration-700" style={{ background: "radial-gradient(circle, var(--c-accent-soft), transparent 70%)", transform: `translate(${step * 60}px, ${step * 20}px)` }} />
      <div className="pointer-events-none absolute -bottom-52 -right-40 h-[560px] w-[560px] rounded-full opacity-70 blur-3xl transition-all duration-700" style={{ background: "radial-gradient(circle, var(--c-accent-soft), transparent 70%)", transform: `translate(${-step * 40}px, 0)` }} />

      <div className="drag relative flex h-10 shrink-0 items-center justify-between pl-4">
        <div className="flex items-center gap-2 text-xs text-faint">
          <RallyLogo size={16} />
          Rally · 首次启动设置
        </div>
        <div className="no-drag h-full"><WindowControls maximized={maximized} onMin={onMin} onMax={onMax} onClose={onClose} /></div>
      </div>

      {/* slides */}
      <div className="relative min-h-0 flex-1">
        <div className="flex h-full transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]" style={{ transform: `translateX(-${step * 100}%)` }}>
          {STEPS.map((st, i) => (
            <div key={st.key} className={cn("h-full w-full shrink-0 overflow-y-auto transition-opacity duration-500", i === step ? "opacity-100" : "pointer-events-none opacity-0")}>
              <div className="mx-auto flex min-h-full max-w-[560px] flex-col justify-center px-8 py-10">
                {st.key === "welcome" && (
                  <div className="flex flex-col items-center text-center">
                    <div className="relative">
                      <div className="absolute inset-0 scale-150 rounded-full blur-2xl" style={{ background: "var(--c-accent-soft)" }} />
                      <RallyLogo size={88} className="relative rounded-[26px] shadow-pop" />
                    </div>
                    <div className="mt-9 text-[13px] font-medium tracking-[0.3em] text-faint">WELCOME</div>
                    <h1 className="mt-3 text-[34px] font-semibold tracking-tight">欢迎使用 Rally agent</h1>
                    <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">一个会规划、会派发、会汇报的桌面 AI 伙伴。花一分钟完成设置，让它按你的方式工作。</p>
                    <div className="mt-10 flex flex-col items-center gap-2">
                      <Button variant="primary" size="lg" className="w-56" onClick={next}>
                        <Sparkles size={15} />开始引导
                      </Button>
                      <Button variant="ghost" size="lg" className="w-56" onClick={onDone}>
                        跳过引导
                      </Button>
                    </div>
                  </div>
                )}

                {st.key !== "welcome" && st.key !== "done" && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-accent">步骤 {i} / {last - 1}</div>
                    <h2 className="text-2xl font-semibold tracking-tight">{st.title}</h2>
                    <p className="mb-7 mt-2 text-sm text-muted">{st.desc}</p>
                    <div className="rounded-3xl bg-panel p-5 shadow-card">
                      {st.key === "identity" && <IdentityForm />}
                      {st.key === "memory" && <MemoryForm />}
                      {st.key === "providers" && <ProvidersForm />}
                      {st.key === "models" && <ModelUsageForm />}
                    </div>
                  </div>
                )}

                {st.key === "done" && (
                  <div className="flex flex-col items-center text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                      <Rocket size={28} />
                    </div>
                    <h2 className="mt-6 text-[28px] font-semibold tracking-tight">一切就绪</h2>
                    <p className="mt-2 text-sm text-muted">{config.name || "Rally"} 已经到岗，随时可以开始工作。</p>
                    <div className="mt-8 grid w-full grid-cols-2 gap-2 text-left">
                      {[
                        { icon: UserRound, k: "名称", v: config.name || "Rally" },
                        { icon: Brain, k: "记忆", v: config.memoryPath },
                        { icon: Server, k: "供应商", v: config.providers.length ? config.providers.map((p) => p.name || "未命名").join("、") : "未添加" },
                        { icon: Cpu, k: "模型", v: `${modelLabel(config.rallyModel, "默认")} / ${modelLabel(config.taskModel, "默认")}` },
                      ].map((r) => (
                        <div key={r.k} className="rounded-2xl bg-panel px-4 py-3 shadow-soft">
                          <div className="flex items-center gap-1.5 text-[11px] text-faint"><r.icon size={12} />{r.k}</div>
                          <div className="mt-1 truncate text-[13px] font-medium">{r.v}</div>
                        </div>
                      ))}
                    </div>
                    <Button variant="primary" size="lg" className="mt-10 w-56" onClick={onDone}>
                      开始使用<ArrowRight size={15} />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* footer nav */}
      <div className={cn("relative flex h-20 shrink-0 items-center justify-between px-8 transition-opacity duration-300", step === 0 && "pointer-events-none opacity-0")}>
        <div className="w-40">
          {step > 1 && (
            <Button variant="ghost" onClick={prev}>
              <ArrowLeft size={14} />上一步
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {STEPS.map((_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full transition-all duration-300", i === step ? "w-6 bg-accent" : i < step ? "w-1.5 bg-accent/50" : "w-1.5 bg-press")} />
          ))}
        </div>
        <div className="flex w-40 justify-end gap-1">
          {step > 0 && step < last && (
            <>
              {s.skippable && (
                <Button variant="ghost" onClick={next}>
                  跳过
                </Button>
              )}
              <Button variant="primary" onClick={next}>
                下一步<ArrowRight size={14} />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
