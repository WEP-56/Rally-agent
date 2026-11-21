import { IdentityCard } from "./IdentityCard";
import { useEffect, useState } from "react";
import { Archive, Bell, ArrowLeft, UserRound, Brain, Server, Plug, Wand2, Palette, Info, FolderInput, Sun, Moon, Monitor, RotateCcw, ExternalLink, Check } from "lucide-react";
import type { Task } from "../data";
import { ArchivedTasksSection } from "./ArchivedTasksSection";
import type { AppInfo } from "../../../shared/ipc";
import { OrbitRing } from "./brand";
import { ACCENTS, useApp } from "../store";
import { cn } from "../utils/cn";
import { Button, RallyLogo, RoundButton, Segmented, Toggle } from "./ui";
import { IdentityForm, MemoryForm, ProvidersForm } from "./forms";
import { WorkspaceForm } from "./WorkspaceForm";
import { SkillsSection } from "./SkillsSection";
import { ProjectTrustSection } from "./ProjectTrustSection";
import { McpSection } from "./McpSection";

function Github({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export const SECTIONS = [
  { id: "general", label: "身份", icon: UserRound, desc: "名称、性格与工作方式" },
  { id: "workspace", label: "项目与工作区", icon: FolderInput, desc: "默认工作区、最近项目与项目信任" },
  { id: "archive", label: "归档", icon: Archive, desc: "查看、撤销归档或彻底删除任务" },
  { id: "memory", label: "记忆", icon: Brain, desc: "长期记忆的存储位置与管理" },
  { id: "providers", label: "供应商", icon: Server, desc: "供应商、协议、模型与元数据（明文存于 ~/.rally）" },
  { id: "mcp", label: "MCP 服务器", icon: Plug, desc: "通过 Model Context Protocol 扩展工具" },
  { id: "skills", label: "Skills", icon: Wand2, desc: "可复用的能力包，按需加载" },
  { id: "appearance", label: "外观", icon: Palette, desc: "主题、强调色与字号" },
  { id: "notifications", label: "通知", icon: Bell, desc: "窗口在后台时的任务提醒" },
  { id: "about", label: "关于", icon: Info, desc: "版本信息与更新" },
];

function Group({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-6">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between px-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-fg/45">{title}</h3>
          {action}
        </div>
      )}
      <div className="glass-strong divide-y divide-line overflow-hidden rounded-[24px]">{children}</div>
    </section>
  );
}

function Row({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[64px] items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function NotificationsSection() {
 const [completed, setCompleted] = useState<boolean | null>(null);
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState("");
 useEffect(() => { let alive = true; void window.rally.notifications.getState().then(state => { if (alive) setCompleted(state.completed); }).catch(reason => { if (alive) setError(String(reason)); }); return () => { alive = false; }; }, []);
 const update = async (value: boolean) => {
  setSaving(true); setError("");
  try { const state = await window.rally.notifications.update({ completed: value }); setCompleted(state.completed); }
  catch (reason) { setError(String(reason)); } finally { setSaving(false); }
 };
 return <Group title="系统通知">
  <Row title="需要处理" desc="问题或不可逆操作上升给你，以及任务失败或受阻时提醒。"><span className="text-xs text-muted">默认开启</span></Row>
  <Row title="任务完成" desc="仅在 Rally 窗口不在前台时通知。">
   <Toggle label="任务完成通知" checked={completed ?? true} disabled={completed === null || saving} onChange={value => void update(value)} />
  </Row>
  {error && <p role="alert" className="px-3 py-2 text-xs text-red-500">{error}</p>}
 </Group>;
}

function AppearanceSection() {
  const { config, setConfig } = useApp();
  const themes = [
    { v: "light" as const, l: "浅色", icon: Sun, bg: "#f4f3f1", panel: "linear-gradient(160deg,#e6e5fb,#fbe9db)", fg: "#d4d4dc" },
    { v: "dark" as const, l: "深色", icon: Moon, bg: "#0e0e15", panel: "linear-gradient(160deg,#1b1a38,#261d2b)", fg: "#3a3a4a" },
    { v: "system" as const, l: "跟随系统", icon: Monitor, bg: "linear-gradient(90deg,#f4f3f1 50%,#0e0e15 50%)", panel: "linear-gradient(90deg,#e6e5fb 50%,#1b1a38 50%)", fg: "#9a9aa8" },
  ];
  return (
    <>
      <h3 className="mb-2 px-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-fg/45">主题</h3>
      <div className="mb-6 grid grid-cols-3 gap-3">
        {themes.map((t) => (
          <button key={t.v} onClick={() => setConfig({ theme: t.v })} className="group text-left">
            <div className={cn("aspect-[1.55] rounded-[20px] p-2 transition-all", config.theme === t.v ? "shadow-[0_0_0_2.5px_var(--c-accent)]" : "shadow-soft group-hover:shadow-card")} style={{ background: t.bg }}>
              <div className="flex h-full gap-1.5">
                <div className="flex w-[38%] flex-col gap-1 rounded-xl p-2" style={{ background: "rgba(128,128,150,.12)" }}>
                  <div className="h-1.5 w-3/4 rounded-full" style={{ background: t.fg }} />
                  <div className="h-1.5 w-1/2 rounded-full" style={{ background: t.fg }} />
                  <div className="ml-auto mt-auto h-3 w-2/3 rounded-full" style={{ background: config.accent }} />
                </div>
                <div className="flex-1 rounded-xl" style={{ background: t.panel }} />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 px-1 text-[13px] font-medium"><t.icon size={13} className="text-faint" />{t.l}{config.theme === t.v && <Check size={13} className="ml-auto text-accent" />}</div>
          </button>
        ))}
      </div>
      <Group title="个性化">
        <Row title="强调色" desc="按钮、状态与高亮，右侧面板的光晕也会跟着变">
          <div className="flex gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                title={a.name}
                onClick={() => setConfig({ accent: a.value })}
                className={cn("h-7 w-7 rounded-full transition-transform hover:scale-110", config.accent === a.value && "shadow-[0_0_0_2px_var(--c-panel),0_0_0_4px_var(--c-accent)]")}
                style={{ background: a.value }}
              />
            ))}
          </div>
        </Row>
        <Row title="界面字号" desc="缩放整个界面的文字与控件">
          <Segmented value={config.fontSize} onChange={(v) => setConfig({ fontSize: v })} options={[{ value: "sm", label: "小" }, { value: "md", label: "标准" }, { value: "lg", label: "大" }]} />
        </Row>
      </Group>
    </>
  );
}

function AboutSection() {
  const { rerunOnboarding } = useApp();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let alive = true; void window.rally.getAppInfo().then(value => { if (alive) setInfo(value); }).catch(reason => { if (alive) setError(String(reason)); }); return () => { alive = false; }; }, []);
  return (
    <>
      <div className="relative mb-7 flex flex-col items-center overflow-hidden rounded-[28px] bg-ink px-6 pb-8 pt-10 text-center text-white">
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(70% 80% at 50% 0%, color-mix(in srgb, var(--c-accent) 40%, transparent), transparent 70%)" }} />
        <div className="relative flex h-[120px] w-full items-center justify-center"><OrbitRing size={300} /><RallyLogo size={88} glow className="relative rounded-[24px]" /></div>
        <div className="font-display relative mt-2 text-[30px] font-semibold">Rally</div>
        <div className="relative mt-1 text-[13px] text-white/60">桌面个人助手{info ? ` · 版本 ${info.version}` : ""}</div>
        {info && <div className="relative mt-3 font-mono text-[11px] text-white/35">Electron {info.versions.electron} · 基于 Pi 构建 · {info.platform}</div>}
      </div>
      {error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
      <Group>
        <Row title="源代码" desc="github.com/WEP-56/Rally-agent">
          <Button size="sm" onClick={() => window.open("https://github.com/WEP-56/Rally-agent", "_blank")}><Github size={13} />在 GitHub 上查看<ExternalLink size={11} className="text-faint" /></Button>
        </Row>
        <Row title="版本更新" desc="当前通过项目发布页手动下载更新">
          <Button size="sm" onClick={() => window.open("https://github.com/WEP-56/Rally-agent/releases", "_blank")}>查看发布页<ExternalLink size={11} /></Button>
        </Row>
        <Row title="首次启动引导" desc="重新走一遍欢迎与初始化设置">
          <Button size="sm" onClick={rerunOnboarding}><RotateCcw size={13} />重新运行</Button>
        </Row>
      </Group>
      <div className="px-1 text-[11px] text-faint">© 2026 Rally contributors · MIT License</div>
    </>
  );
}

export function Settings({ section, setSection, onBack, tasks }: { section: string; setSection: (s: string) => void; onBack: () => void; tasks: Task[] }) {
  const { config } = useApp();
  const cur = SECTIONS.find((s) => s.id === (section === "trust" ? "workspace" : section)) || SECTIONS[0];
  return (
    <div className="animate-fade flex h-full w-full flex-col gap-2.5 p-2.5 pl-0 md:flex-row md:gap-0 md:pl-2.5">
      <aside className="flex min-h-0 shrink-0 flex-col md:w-[290px] md:pr-2.5">
        <div className="flex items-center gap-3 px-2 pb-3 pt-1 md:px-3 md:pb-4 md:pt-2">
          <RoundButton title="返回 (Esc)" aria-label="返回应用" onClick={onBack}><ArrowLeft size={17} strokeWidth={1.9} /></RoundButton>
          <div className="min-w-0"><div className="font-display text-[22px] font-semibold leading-none">设置</div><div className="mt-1 truncate text-xs text-faint">{config.name}</div></div>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-2 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-visible md:px-0">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              aria-label={s.label}
              aria-current={cur.id === s.id ? "page" : undefined}
              onClick={() => setSection(s.id)}
              className={cn(
                "group relative flex shrink-0 items-center gap-3 rounded-2xl py-2.5 pl-4 pr-3 text-left transition-all",
                cur.id === s.id ? "bg-panel shadow-card ring-1 ring-line" : "hover:bg-fg/[0.045]",
              )}
            >
              {cur.id === s.id && <span className="absolute -left-px top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />}
              <s.icon size={17} strokeWidth={1.7} className={cn("shrink-0 transition-colors", cur.id === s.id ? "text-accent" : "text-faint group-hover:text-muted")} />
              <span className="min-w-0 flex-1 pr-1"><span className="block whitespace-nowrap text-[14px] font-medium md:truncate">{s.label}</span><span className="hidden truncate text-[11.5px] text-faint md:block">{s.desc}</span></span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="stage relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-[28px] shadow-card ring-1 ring-black/[0.06] dark:ring-white/[0.1]">
        <div key={cur.id} className="relative z-10 h-full overflow-y-auto"><div className="mx-auto max-w-[680px] px-5 pb-20 pt-8 md:px-8">
          <div className="animate-rise mb-7 border-b border-line px-1 pb-5"><h1 className="font-display text-[28px] font-semibold leading-tight">{cur.label}</h1><p className="mt-1 text-[13px] text-fg/55">{cur.desc}</p></div>
          <div className="animate-rise" style={{ animationDelay: "40ms" }}>
          {cur.id === "archive" && <ArchivedTasksSection tasks={tasks} />}
          {cur.id === "general" && <><IdentityCard /><IdentityForm /></>}
          {cur.id === "workspace" && <><div className="glass-strong rounded-[24px] p-5"><WorkspaceForm /></div><section className="mt-7"><h2 className="mb-3 px-1 text-[16px] font-semibold">项目信任</h2><ProjectTrustSection /></section></>}
          {cur.id === "memory" && <div className="glass-strong rounded-[24px] p-5"><MemoryForm /></div>}
          {cur.id === "providers" && <ProvidersForm />}
          {cur.id === "mcp" && <McpSection />}
          {cur.id === "skills" && <SkillsSection />}
          {cur.id === "appearance" && <AppearanceSection />}
          {cur.id === "notifications" && <NotificationsSection />}
          {cur.id === "about" && <AboutSection />}
          </div>
        </div></div>
      </main>
    </div>
  );
}
