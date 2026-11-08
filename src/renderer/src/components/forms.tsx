import { useState } from "react";
import { Eye, EyeOff, Loader2, Plus, Trash2, Download, FolderOpen, Bot, Boxes, CheckCircle2, Info } from "lucide-react";
import { PROVIDER_PRESETS, allModels, fetchModels, uid, useApp, type Provider } from "../store";
import { Button, Input, Select, Textarea } from "./ui";
import { cn } from "../utils/cn";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function IdentityForm() {
  const { config, setConfig } = useApp();
  return (
    <div className="flex flex-col gap-4">
      <Field label="名称" hint="会显示在名片与对话中">
        <Input value={config.name} onChange={(e) => setConfig({ name: e.target.value })} placeholder="Rally" />
      </Field>
      <Field label="性格" hint="影响语气与表达方式">
        <Textarea rows={2} value={config.personality} onChange={(e) => setConfig({ personality: e.target.value })} />
      </Field>
      <Field label="工作方式" hint="规划、派发与确认的偏好">
        <Textarea rows={3} value={config.workstyle} onChange={(e) => setConfig({ workstyle: e.target.value })} />
      </Field>
    </div>
  );
}

export function MemoryForm() {
  const { config, setConfig } = useApp();
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Field label="记忆存储路径">
        <div className="flex gap-2">
          <Input className="font-mono text-[13px]" value={config.memoryPath} onChange={(e) => setConfig({ memoryPath: e.target.value })} />
          <Button
            onClick={() => {
              setPicking(true);
              setTimeout(() => {
                setPicking(false);
                setConfig({ memoryPath: "D:\\Rally\\memory" });
              }, 700);
            }}
          >
            {picking ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}浏览…
          </Button>
        </div>
      </Field>
      <div className="flex gap-2.5 rounded-xl bg-sunken px-3.5 py-3 text-xs leading-relaxed text-muted">
        <Info size={14} className="mt-0.5 shrink-0 text-faint" />
        <div>
          Rally 会在此目录下保存长期记忆（偏好、项目事实、任务摘要），以 Markdown 与向量索引两种形式存储。你可以随时用任何编辑器查看或删除。
          <div className="mt-1.5 font-mono text-[11px] text-faint">{config.memoryPath}\facts.md · \tasks\ · \index.sqlite</div>
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ p, onChange, onRemove }: { p: Provider; onChange: (p: Partial<Provider>) => void; onRemove: () => void }) {
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const get = async () => {
    if (!p.baseUrl) {
      setNote("请先填写 Base URL");
      return;
    }
    setLoading(true);
    setNote(null);
    const r = await fetchModels(p.baseUrl, p.apiKey);
    setLoading(false);
    onChange({ models: r.models });
    setNote(r.live ? `已从接口获取 ${r.models.length} 个模型` : `预览环境无法直连，已载入 ${r.models.length} 个常用模型`);
  };

  return (
    <div className="animate-rise rounded-2xl bg-sunken p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-raised text-sm font-semibold text-muted shadow-soft">{(p.name || "?")[0]}</div>
        <input
          value={p.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="供应商名称"
          className="h-8 flex-1 rounded-md bg-transparent px-1.5 text-sm font-medium hover:bg-hover focus:bg-panel"
        />
        <button onClick={onRemove} className="rounded-md p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {PROVIDER_PRESETS.map((pr) => (
          <button
            key={pr.name}
            onClick={() => onChange({ name: pr.name, baseUrl: pr.baseUrl, models: [] })}
            className={cn("h-6 rounded-full px-2.5 text-[11px] transition-colors", p.baseUrl === pr.baseUrl ? "bg-accent-soft text-accent" : "bg-panel text-muted hover:text-fg dark:bg-raised")}
          >
            {pr.name}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2">
        <Input className="bg-panel font-mono text-[12.5px] dark:bg-raised" placeholder="Base URL，例如 https://api.openai.com/v1" value={p.baseUrl} onChange={(e) => onChange({ baseUrl: e.target.value })} />
        <div className="relative">
          <Input
            className="bg-panel pr-9 font-mono text-[12.5px] dark:bg-raised"
            type={show ? "text" : "password"}
            placeholder="API Key（sk-…）"
            value={p.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
          />
          <button onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-fg">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={get} className="bg-panel shadow-soft dark:bg-raised">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}获取模型
        </Button>
        {note && <span className="text-[11px] text-faint">{note}</span>}
      </div>
      {p.models.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.models.map((m) => (
            <span key={m} className="inline-flex items-center gap-1 rounded-md bg-panel px-2 py-1 font-mono text-[11px] text-muted shadow-soft dark:bg-raised">
              <CheckCircle2 size={11} className="text-accent" />
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProvidersForm() {
  const { config, setConfig } = useApp();
  const update = (id: string, patch: Partial<Provider>) => setConfig({ providers: config.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  return (
    <div className="flex flex-col gap-3">
      {config.providers.map((p) => (
        <ProviderCard key={p.id} p={p} onChange={(patch) => update(p.id, patch)} onRemove={() => setConfig({ providers: config.providers.filter((x) => x.id !== p.id) })} />
      ))}
      <button
        onClick={() => setConfig({ providers: [...config.providers, { id: uid(), name: config.providers.length ? "" : "OpenAI", baseUrl: config.providers.length ? "" : "https://api.openai.com/v1", apiKey: "", models: [] }] })}
        className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-sunken text-sm text-muted transition-all hover:bg-deep hover:text-fg dark:hover:bg-raised"
      >
        <Plus size={15} />
        添加供应商
      </button>
    </div>
  );
}

export function ModelUsageForm() {
  const { config, setConfig } = useApp();
  const opts = allModels(config);
  const noProviders = config.providers.every((p) => !p.models.length);
  return (
    <div className="flex flex-col gap-3">
      {[
        { key: "rallyModel" as const, icon: Bot, title: `${config.name || "Rally"} 使用的模型`, desc: "主对话：理解需求、规划、派发与汇总，建议选择能力最强的模型" },
        { key: "taskModel" as const, icon: Boxes, title: "任务使用的模型", desc: "工位执行：读写文件、执行命令、调用工具，可选更快更经济的模型" },
      ].map((r) => (
        <div key={r.key} className="rounded-2xl bg-sunken p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <r.icon size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{r.title}</div>
              <div className="mt-0.5 text-xs text-faint">{r.desc}</div>
              <Select className="mt-3 [&>button]:bg-panel dark:[&>button]:bg-raised" value={config[r.key]} options={opts} onChange={(v) => setConfig({ [r.key]: v })} placeholder="选择模型" />
            </div>
          </div>
        </div>
      ))}
      {noProviders && <div className="px-1 text-[11px] text-faint">尚未获取任何供应商模型，当前显示示例模型。</div>}
    </div>
  );
}
