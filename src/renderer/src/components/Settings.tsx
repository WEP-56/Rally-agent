import { useEffect, useState } from "react";
import { Bell, ArrowLeft, UserRound, Brain, Server, Plug, Wand2, Palette, Info, RefreshCw, CheckCircle2, FolderInput, Sun, Moon, Monitor, Loader2, RotateCcw, ExternalLink } from "lucide-react";
import { ACCENTS, useApp } from "../store";
import { cn } from "../utils/cn";
import { Button, RallyLogo, Segmented, Toggle } from "./ui";
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
  { id: "workspace", label: "项目与工作区", icon: FolderInput, desc: "主对话默认工作区与最近任务项目" },
  { id: "memory", label: "记忆", icon: Brain, desc: "长期记忆的存储位置与管理" },
  { id: "providers", label: "供应商", icon: Server, desc: "供应商、协议、模型与元数据（明文存于 ~/.rally）" },
  { id: "mcp", label: "MCP 服务器", icon: Plug, desc: "通过 Model Context Protocol 扩展工具" },
  { id: "skills", label: "Skills", icon: Wand2, desc: "可复用的能力包，按需加载" },
  { id: "trust", label: "项目信任", icon: FolderInput, desc: "管理项目资源的加载权限" },
  { id: "appearance", label: "外观", icon: Palette, desc: "主题、强调色与字号" },
  { id: "notifications", label: "通知", icon: Bell, desc: "窗口在后台时的任务提醒" },
  { id: "about", label: "关于", icon: Info, desc: "版本信息与更新" },
];

function Group({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-7">
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-medium text-faint">{title}</span>
          {action}
        </div>
      )}
      <div className="flex flex-col gap-1 rounded-2xl bg-sunken p-1">{children}</div>
    </div>
  );
}

function Row({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-[56px] items-center gap-4 rounded-xl bg-panel px-4 py-3 dark:bg-raised/60">
      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-faint">{desc}</div>}
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
    { v: "light" as const, l: "浅色", icon: Sun, bg: "#f3f3f3", panel: "#ffffff", fg: "#d4d4d8" },
    { v: "dark" as const, l: "深色", icon: Moon, bg: "#1c1c1e", panel: "#2a2a2d", fg: "#45454a" },
    { v: "system" as const, l: "跟随系统", icon: Monitor, bg: "linear-gradient(90deg,#f3f3f3 50%,#1c1c1e 50%)", panel: "linear-gradient(90deg,#fff 50%,#2a2a2d 50%)", fg: "#9ca3af" },
  ];
  return (
    <>
      <div className="mb-2 px-1 text-xs font-medium text-faint">主题</div>
      <div className="mb-7 grid grid-cols-3 gap-3">
        {themes.map((t) => (
          <button key={t.v} onClick={() => setConfig({ theme: t.v })} className="group text-left">
            <div className={cn("aspect-[1.6] rounded-xl p-2 transition-all", config.theme === t.v ? "shadow-[0_0_0_2px_var(--c-accent)]" : "shadow-soft group-hover:shadow-card")} style={{ background: t.bg }}>
              <div className="flex h-full gap-1.5">
                <div className="flex-1 rounded-md p-1.5" style={{ background: t.panel }}>
                  <div className="h-1.5 w-2/3 rounded-full" style={{ background: t.fg }} />
                  <div className="mt-1 h-1.5 w-1/2 rounded-full" style={{ background: t.fg }} />
                  <div className="ml-auto mt-2 h-3 w-1/2 rounded" style={{ background: config.accent, opacity: 0.35 }} />
                </div>
                <div className="flex-1 rounded-md" style={{ background: t.panel }} />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 px-0.5 text-[13px]"><t.icon size={13} className="text-faint" />{t.l}</div>
          </button>
        ))}
      </div>
      <Group title="个性化">
        <Row title="强调色" desc="用于按钮、状态与高亮">
          <div className="flex gap-1.5">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                title={a.name}
                onClick={() => setConfig({ accent: a.value })}
                className={cn("h-6 w-6 rounded-full transition-transform hover:scale-110", config.accent === a.value && "shadow-[0_0_0_2px_var(--c-panel),0_0_0_4px_var(--c-accent)]")}
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
  const [st, setSt] = useState<"idle" | "checking" | "latest">("idle");
  return (
    <>
      <div className="mb-7 flex items-center gap-5 rounded-3xl bg-sunken p-6">
        <RallyLogo size={64} className="rounded-[20px]" />
        <div className="flex-1">
          <div className="text-xl font-semibold">Rally</div>
          <div className="mt-0.5 text-sm text-muted">桌面 AI Agent · 版本 0.4.2-preview</div>
          <div className="mt-1 font-mono text-[11px] text-faint">build 2026.11.02 · electron 38 · win32-x64</div>
        </div>
      </div>
      <Group>
        <Row title="源代码" desc="github.com/rally-agent/rally">
          <Button size="sm" onClick={() => window.open("https://github.com", "_blank")}><Github size={13} />在 GitHub 上查看<ExternalLink size={11} className="text-faint" /></Button>
        </Row>
        <Row title="检查更新" desc={st === "latest" ? "已是最新版本 · 上次检查：刚刚" : "自动在后台检查，也可以手动检查"}>
          <Button
            size="sm"
            onClick={() => {
              setSt("checking");
              setTimeout(() => setSt("latest"), 1400);
            }}
          >
            {st === "checking" ? <Loader2 size={13} className="animate-spin" /> : st === "latest" ? <CheckCircle2 size={13} className="text-accent" /> : <RefreshCw size={13} />}
            {st === "checking" ? "检查中…" : st === "latest" ? "已是最新" : "检查更新"}
          </Button>
        </Row>
        <Row title="首次启动引导" desc="重新走一遍欢迎与初始化设置">
          <Button size="sm" onClick={rerunOnboarding}><RotateCcw size={13} />重新运行</Button>
        </Row>
      </Group>
      <div className="px-1 text-[11px] text-faint">© 2026 Rally contributors · MIT License</div>
    </>
  );
}

export function Settings({ section, setSection, onBack }: { section: string; setSection: (s: string) => void; onBack: () => void }) {
  const cur = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
  return (
    <div className="animate-fade flex h-full gap-1.5 px-1.5 pb-1.5">
      <nav className="flex w-56 shrink-0 flex-col px-2 pt-2">
        <button onClick={onBack} className="mb-4 flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] text-muted transition-colors hover:bg-hover hover:text-fg">
          <ArrowLeft size={15} />返回应用
        </button>
        <div className="mb-2 px-2.5 text-lg font-semibold">设置</div>
        <div className="flex flex-col gap-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-all",
                section === s.id ? "bg-panel font-medium text-fg shadow-soft" : "text-muted hover:bg-hover hover:text-fg",
              )}
            >
              <s.icon size={15} strokeWidth={1.8} className={section === s.id ? "text-accent" : ""} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="mt-auto px-2.5 pb-3 text-[11px] text-faint">供应商配置需手动保存</div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto rounded-xl bg-panel shadow-card">
        <div key={cur.id} className="animate-rise mx-auto max-w-[720px] px-10 pb-12 pt-9">
          <h1 className="text-2xl font-semibold tracking-tight">{cur.label}</h1>
          <p className="mb-8 mt-1 text-sm text-muted">{cur.desc}</p>
          {cur.id === "general" && <IdentityForm />}
          {cur.id === "workspace" && <WorkspaceForm />}
          {cur.id === "memory" && <MemoryForm />}
          {cur.id === "providers" && <ProvidersForm />}
          {cur.id === "mcp" && <McpSection />}
          {cur.id === "skills" && <SkillsSection />}
          {cur.id === "trust" && <ProjectTrustSection />}
          {cur.id === "appearance" && <AppearanceSection />}
          {cur.id === "notifications" && <NotificationsSection />}
          {cur.id === "about" && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
