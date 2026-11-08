import { useState } from "react";
import { ArrowLeft, UserRound, Brain, Server, Cpu, Plug, Wand2, Palette, Info, Plus, Trash2, RefreshCw, CheckCircle2, Search, FolderInput, Sun, Moon, Monitor, Loader2, RotateCcw, ExternalLink } from "lucide-react";
import { ACCENTS, uid, useApp, type McpServer } from "../store";
import { cn } from "../utils/cn";
import { Button, Input, RallyLogo, Segmented, Toggle } from "./ui";
import { IdentityForm, MemoryForm, ModelUsageForm, ProvidersForm } from "./forms";

function Github({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export const SECTIONS = [
  { id: "general", label: "身份", icon: UserRound, desc: "名称、性格与工作方式" },
  { id: "memory", label: "记忆", icon: Brain, desc: "长期记忆的存储位置与管理" },
  { id: "providers", label: "供应商", icon: Server, desc: "模型供应商与 API 密钥" },
  { id: "models", label: "模型", icon: Cpu, desc: "主代理与工位任务的模型分配" },
  { id: "mcp", label: "MCP 服务器", icon: Plug, desc: "通过 Model Context Protocol 扩展工具" },
  { id: "skills", label: "Skills", icon: Wand2, desc: "可复用的能力包，按需加载" },
  { id: "appearance", label: "外观", icon: Palette, desc: "主题、强调色与字号" },
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

function McpSection() {
  const { config, setConfig } = useApp();
  const [view, setView] = useState<"list" | "json">("list");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Omit<McpServer, "id" | "tools" | "enabled">>({ name: "", transport: "stdio", command: "" });
  const upd = (id: string, p: Partial<McpServer>) => setConfig({ mcp: config.mcp.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const json = JSON.stringify(
    { mcpServers: Object.fromEntries(config.mcp.map((m) => [m.name, m.transport === "http" ? { url: m.command, disabled: !m.enabled } : { command: m.command.split(" ")[0], args: m.command.split(" ").slice(1), disabled: !m.enabled }])) },
    null,
    2,
  );
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <Segmented value={view} onChange={setView} options={[{ value: "list", label: "列表" }, { value: "json", label: "JSON" }]} />
        <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Plus size={13} />添加服务器</Button>
      </div>
      {adding && (
        <div className="animate-pop mb-5 rounded-2xl bg-sunken p-4">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Input className="bg-panel dark:bg-raised" placeholder="名称，例如 postgres" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <Segmented value={draft.transport} onChange={(v) => setDraft({ ...draft, transport: v })} options={[{ value: "stdio", label: "stdio" }, { value: "http", label: "HTTP" }]} />
          </div>
          <Input className="mt-2 bg-panel font-mono text-[12.5px] dark:bg-raised" placeholder={draft.transport === "stdio" ? "npx -y @modelcontextprotocol/server-postgres postgresql://…" : "https://example.com/mcp"} value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} />
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>取消</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!draft.name || !draft.command}
              onClick={() => {
                setConfig({ mcp: [...config.mcp, { ...draft, id: uid(), enabled: true, tools: Math.floor(Math.random() * 12) + 2 }] });
                setDraft({ name: "", transport: "stdio", command: "" });
                setAdding(false);
              }}
            >
              添加并连接
            </Button>
          </div>
        </div>
      )}
      {view === "list" ? (
        <Group title={`已配置 ${config.mcp.length} 个服务器`}>
          {config.mcp.map((m) => (
            <Row
              key={m.id}
              title={
                <span className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", m.enabled ? "bg-accent" : "bg-press")} />
                  <span className="font-medium">{m.name}</span>
                  <span className="rounded bg-sunken px-1.5 text-[10px] uppercase text-faint">{m.transport}</span>
                  {m.enabled && <span className="text-[11px] text-faint">{m.tools} 个工具</span>}
                </span>
              }
              desc={<span className="block truncate font-mono">{m.command}</span>}
            >
              <button onClick={() => setConfig({ mcp: config.mcp.filter((x) => x.id !== m.id) })} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"><Trash2 size={14} /></button>
              <Toggle checked={m.enabled} onChange={(v) => upd(m.id, { enabled: v })} />
            </Row>
          ))}
        </Group>
      ) : (
        <pre className="selectable overflow-auto rounded-2xl bg-term p-4 font-mono text-[12px] leading-relaxed text-fg/85 shadow-soft">{json}</pre>
      )}
    </>
  );
}

function SkillsSection() {
  const { config, setConfig } = useApp();
  const [q, setQ] = useState("");
  const list = config.skills.filter((s) => (s.name + s.desc).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <Input className="pl-8" placeholder="搜索 skills" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button
          onClick={() => setConfig({ skills: [...config.skills, { id: uid(), name: "my-skill-" + (config.skills.length + 1), desc: "从本地文件夹导入的 SKILL.md", source: "本地", enabled: true }] })}
        >
          <FolderInput size={14} />从文件夹导入
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {list.map((s) => (
          <div key={s.id} className="flex items-start gap-3 rounded-2xl bg-sunken p-4 transition-shadow hover:shadow-soft">
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", s.enabled ? "bg-accent-soft text-accent" : "bg-panel text-faint dark:bg-raised")}>
              <Wand2 size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-[13px] font-medium">{s.name}</span>
                <span className="rounded bg-panel px-1.5 text-[10px] text-faint dark:bg-raised">{s.source}</span>
              </div>
              <div className="mt-1 text-xs text-muted">{s.desc}</div>
            </div>
            <Toggle checked={s.enabled} onChange={(v) => setConfig({ skills: config.skills.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)) })} />
          </div>
        ))}
      </div>
    </>
  );
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
        <div className="mt-auto px-2.5 pb-3 text-[11px] text-faint">更改会自动保存</div>
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto rounded-xl bg-panel shadow-card">
        <div key={cur.id} className="animate-rise mx-auto max-w-[720px] px-10 pb-12 pt-9">
          <h1 className="text-2xl font-semibold tracking-tight">{cur.label}</h1>
          <p className="mb-8 mt-1 text-sm text-muted">{cur.desc}</p>
          {cur.id === "general" && <IdentityForm />}
          {cur.id === "memory" && (
            <>
              <MemoryForm />
              <div className="mt-7">
                <Group title="记忆管理">
                  <Row title="已存储的记忆" desc="128 条事实 · 42 份任务摘要 · 3.2 MB"><Button size="sm">在资源管理器中打开</Button></Row>
                  <Row title="自动整理" desc="每天空闲时合并重复记忆并清理过期内容"><Toggle checked onChange={() => {}} /></Row>
                  <Row title="清空所有记忆" desc="此操作不可撤销"><Button size="sm" variant="danger">清空</Button></Row>
                </Group>
              </div>
            </>
          )}
          {cur.id === "providers" && <ProvidersForm />}
          {cur.id === "models" && <ModelUsageForm />}
          {cur.id === "mcp" && <McpSection />}
          {cur.id === "skills" && <SkillsSection />}
          {cur.id === "appearance" && <AppearanceSection />}
          {cur.id === "about" && <AboutSection />}
        </div>
      </main>
    </div>
  );
}
