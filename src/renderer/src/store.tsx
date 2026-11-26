import { DEFAULT_SEED_HEX, SEED_PRESETS } from "./md3/theme";
import { createContext, useContext } from "react";
import type { ResourceRef } from "../../shared/resources";
import { DEFAULT_IDENTITY } from "../../shared/identity";
import type { IdentityState } from "../../shared/identity";
import type { MemoryState } from "../../shared/memory";
import { IpcChannel } from "../../shared/ipc";
import { cloudRead } from "./cloud-cache";

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
  reduceMotion: boolean;
  mcp: McpServer[];
  skills: Skill[];
}

export const ACCENTS = SEED_PRESETS.map(seed => ({ name: seed.name, value: seed.hex }));

export const DEFAULT_CONFIG: Config = {
  ...DEFAULT_IDENTITY,
  memoryPath: "C:\\Users\\you\\.rally\\memory",
  providers: [],
  rallyModel: "",
  taskModel: "",
  theme: "light",
  accent: DEFAULT_SEED_HEX,
  fontSize: "md",
  density: "cozy",
  reduceMotion: false,
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
  const remote = window.runtime?.mode === "cloud" ? { ...cloudRead<IdentityState>(IpcChannel.identityState), memoryPath: cloudRead<MemoryState>(IpcChannel.memoryState)?.dir ?? "正在同步…" } : {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw), ...remote, density: "cozy" };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG, ...remote };
}
export function saveConfig(c: Config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(window.runtime?.mode==="cloud"?{theme:c.theme,accent:c.accent,fontSize:c.fontSize,density:c.density,reduceMotion:c.reduceMotion}:c));
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

export type TabKind = "workstation" | "browser" | "terminal" | "connections" | "task" | "resource" | "agent-browser";
export interface Tab {
	resource?: ResourceRef;
  id: string;
  kind: TabKind;
  title: string;
  taskId?: string;
  browserId?: string;
  url?: string;
}

export interface AppCtx {
	identityReady: boolean;
	identityError: string;
	reloadIdentity: () => void;
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  openTab: (kind: Exclude<TabKind, "task" | "resource" | "agent-browser">, opts?: { url?: string; taskId?: string }) => void;
  openAgentBrowser: (id: string, taskId: string) => void;
  openResource: (resource: ResourceRef) => void;
  openTask: (taskId: string) => void;
  openSettings: (section?: string) => void;
  rerunOnboarding: () => void;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);
