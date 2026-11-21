import { createContext, useContext } from "react";
import { DEFAULT_IDENTITY } from "../../shared/identity";

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
	avatar: string | null;
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
}

export const ACCENTS = [
  { name: "轨道靛", value: "#5b6cf0" },
  { name: "晨雾紫", value: "#8b5cf6" },
  { name: "海盐青", value: "#0ea5a4" },
  { name: "琥珀", value: "#e08a1e" },
  { name: "珊瑚", value: "#ee5a67" },
  { name: "石墨", value: "#4b4b5c" },
];

export const DEFAULT_CONFIG: Config = {
  ...DEFAULT_IDENTITY,
  memoryPath: "C:\\Users\\you\\.rally\\memory",
  providers: [],
  rallyModel: "",
  taskModel: "",
  theme: "light",
  accent: "#5b6cf0",
  fontSize: "md",
  density: "cozy",
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

export const modelLabel = (v: string, fallback = "未设置模型") => (v ? v.split("/").slice(1).join("/") || v : fallback);

/* ------------------------------------------------------------------ */

export type TabKind = "workstation" | "browser" | "terminal" | "connections" | "task";
export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  taskId?: string;
  url?: string;
}

export interface AppCtx {
	identityReady: boolean;
	identityError: string;
	reloadIdentity: () => void;
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  openTab: (kind: Exclude<TabKind, "task">, opts?: { url?: string; taskId?: string }) => void;
  openTask: (taskId: string) => void;
  openSettings: (section?: string) => void;
  rerunOnboarding: () => void;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
