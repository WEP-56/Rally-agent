import { createContext, useContext } from "react";

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  enabled: boolean;
  tools: number;
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  source: "内置" | "本地" | "社区";
  enabled: boolean;
}

export type ThemeMode = "light" | "dark" | "system";

export interface Config {
  name: string;
  personality: string;
  workstyle: string;
  memoryPath: string;
  providers: Provider[];
  rallyModel: string;
  taskModel: string;
  theme: ThemeMode;
  accent: string;
  fontSize: "sm" | "md" | "lg";
  density: "compact" | "cozy";
  mcp: McpServer[];
  skills: Skill[];
  autoApprove: boolean;
}

export const ACCENTS = [
  { name: "翡翠", value: "#10a37f" },
  { name: "靛蓝", value: "#4f6bed" },
  { name: "紫晶", value: "#8b5cf6" },
  { name: "琥珀", value: "#d97706" },
  { name: "珊瑚", value: "#e5484d" },
  { name: "石墨", value: "#52525b" },
];

export const DEFAULT_CONFIG: Config = {
  name: "Rally",
  personality: "冷静、可靠、直截了当，偶尔带一点幽默感",
  workstyle: "先规划后执行；把大目标拆成小任务交给工位并行处理；涉及删除或外部写入前先征求确认",
  memoryPath: "C:\\Users\\you\\.rally\\memory",
  providers: [],
  rallyModel: "",
  taskModel: "",
  theme: "light",
  accent: "#10a37f",
  fontSize: "md",
  density: "cozy",
  autoApprove: false,
  mcp: [
    { id: "m1", name: "filesystem", transport: "stdio", command: "npx -y @modelcontextprotocol/server-filesystem ~/projects", enabled: true, tools: 11 },
    { id: "m2", name: "github", transport: "stdio", command: "npx -y @modelcontextprotocol/server-github", enabled: true, tools: 26 },
    { id: "m3", name: "playwright", transport: "stdio", command: "npx @playwright/mcp@latest", enabled: false, tools: 21 },
    { id: "m4", name: "context7", transport: "http", command: "https://mcp.context7.com/mcp", enabled: true, tools: 2 },
  ],
  skills: [
    { id: "s1", name: "code-review", desc: "按团队规范审查改动，给出分级建议", source: "内置", enabled: true },
    { id: "s2", name: "repo-analyst", desc: "克隆并阅读仓库，输出架构分析文档", source: "内置", enabled: true },
    { id: "s3", name: "weekly-report", desc: "汇总 issue / PR / 提交记录生成周报", source: "本地", enabled: true },
    { id: "s4", name: "pdf-reader", desc: "提取 PDF 文本、表格与图片", source: "社区", enabled: false },
    { id: "s5", name: "frontend-design", desc: "生成具有设计感的前端界面与组件", source: "社区", enabled: true },
  ],
};

const KEY = "rally.config.v1";
const OB_KEY = "rally.onboarded.v1";

export function loadConfig(): Config {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_CONFIG;
}
export function saveConfig(c: Config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}
export function loadOnboarded() {
  try {
    return localStorage.getItem(OB_KEY) === "1";
  } catch {
    return false;
  }
}
export function saveOnboarded(v: boolean) {
  try {
    if (v) localStorage.setItem(OB_KEY, "1");
    else localStorage.removeItem(OB_KEY);
  } catch {
    /* ignore */
  }
}

export const uid = () => Math.random().toString(36).slice(2, 9);

/** Known provider presets & sample models (used when live fetch is unavailable) */
export const PROVIDER_PRESETS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "o4-mini"] },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", models: ["claude-opus-4-1", "claude-sonnet-4-5", "claude-haiku-4-5"] },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", models: ["openai/gpt-5", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro", "qwen/qwen3-coder"] },
  { name: "Ollama", baseUrl: "http://localhost:11434/v1", models: ["qwen3:14b", "llama3.1:8b", "gpt-oss:20b"] },
];

export async function fetchModels(baseUrl: string, apiKey: string): Promise<{ models: string[]; live: boolean }> {
  const url = baseUrl.replace(/\/+$/, "") + "/models";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const j = await res.json();
      const list: string[] = (j.data || j.models || []).map((m: { id?: string; name?: string }) => m.id || m.name).filter(Boolean);
      if (list.length) return { models: list.slice(0, 40), live: true };
    }
  } catch {
    /* fall through to preset */
  }
  await new Promise((r) => setTimeout(r, 700));
  const preset = PROVIDER_PRESETS.find((p) => baseUrl.includes(new URL(p.baseUrl).hostname));
  return { models: preset ? preset.models : ["default-chat", "default-reasoner", "default-mini"], live: false };
}

export function allModels(c: Config) {
  const out: { value: string; label: string; group: string }[] = [];
  c.providers.forEach((p) => p.models.forEach((m) => out.push({ value: `${p.name}/${m}`, label: m, group: p.name })));
  if (!out.length) {
    out.push(
      { value: "OpenAI/gpt-5", label: "gpt-5", group: "示例" },
      { value: "Anthropic/claude-sonnet-4-5", label: "claude-sonnet-4-5", group: "示例" },
      { value: "DeepSeek/deepseek-chat", label: "deepseek-chat", group: "示例" },
    );
  }
  return out;
}

export const modelLabel = (v: string, fallback = "未设置模型") => (v ? v.split("/").slice(1).join("/") || v : fallback);

/* ------------------------------------------------------------------ */

export type TabKind = "workstation" | "browser" | "terminal" | "task";
export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  taskId?: string;
  url?: string;
}

export interface AppCtx {
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  openTab: (kind: Exclude<TabKind, "task">, opts?: { url?: string }) => void;
  openTask: (taskId: string) => void;
  openSettings: (section?: string) => void;
  rerunOnboarding: () => void;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
