export type StepKind = "cmd" | "read" | "write" | "edit" | "delete" | "search" | "web" | "memory" | "think";
import type { ToolCall } from "../../shared/tools";
import type { AssistantBlock, AssistantMessageView } from "../../shared/conversation";
import type { TaskGate } from "../../shared/gate";

export interface ToolStep {
	status?: ToolCall["status"];
  kind: StepKind;
  title: string; // e.g. "Check if remote repo exists"
  target: string; // command / file path / query
  output?: string;
  diff?: { add?: string[]; del?: string[]; ctx?: string[] };
  duration?: string;
  exit?: number;
}

export interface ChatMsg {
	blocks?: AssistantBlock[];
	toolCalls?: ToolCall[];
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  steps?: ToolStep[];
  taskRef?: string;
  streaming?: boolean;
  at?: number;
}

export type TaskStatus = "running" | "done" | "failed" | "queued" | "cancelled" | "dropped" | "needs_gate" | "needs_answer" | "interrupted" | "blocked" | "pending_approval";

export type TaskMsg =
	| { role: "assistant"; message: AssistantMessageView }
  | { role: "rally"; text: string }
  | { role: "agent"; text: string }
  | { role: "tools"; steps: ToolStep[] };

export interface Task {
	gates?: TaskGate[];
	lastExternalAction?: { tool: string; at: number };
	toolCalls?: ToolCall[];
  id: string;
  title: string;
  summary: string;
  status: TaskStatus;
  createdAt: number;
  duration: string;
  progress: number;
  tags: string[];
  messages: TaskMsg[];
  /** Present when the card came from the supervisor (not mock data). */
  approval?: "pending" | "approved" | "cancelled";
  mode?: "write" | "readonly";
  scope?: string[];
  cwd?: string;
  quotes?: { messageId: string; text: string }[];
  note?: string;
  dependsOn?: string[];
}

const now = Date.now();
const min = 60_000;

const repoSteps: ToolStep[] = [
  { kind: "cmd", title: "Check if remote repo exists", target: "git ls-remote https://github.com/deepseek-ai/dsh-superagent-prototype HEAD", output: "8c32a9d4f1e07b2c99a1d3e5f6a7b8c9d0e1f2a3\tHEAD", duration: "1.2s", exit: 0 },
  { kind: "cmd", title: "Clone the repo", target: "git clone --depth 1 https://github.com/deepseek-ai/dsh-superagent-prototype repo", output: "Cloning into 'repo'...\nremote: Enumerating objects: 214, done.\nremote: Counting objects: 100% (214/214), done.\nremote: Compressing objects: 100% (176/176), done.\nReceiving objects: 100% (214/214), 391.27 KiB | 2.10 MiB/s, done.\nResolving deltas: 100% (18/18), done.", duration: "3.8s", exit: 0 },
  { kind: "cmd", title: "List workspace and repo contents", target: "Get-ChildItem -Recurse -Depth 1 repo", output: "    Directory: C:\\work\\repo\n\nMode   LastWriteTime      Length Name\n----   -------------      ------ ----\nd----  2026/10/31 10:02          docs\nd----  2026/10/31 10:02          src\nd----  2026/10/31 10:02          tests\n-a---  2026/10/31 10:02    6211 README.md\n-a---  2026/10/31 10:02    1180 package.json", duration: "0.3s", exit: 0 },
  { kind: "read", title: "已读取", target: "README.md", output: "# dsh-superagent (prototype)\n\n> ⚠️ Experimental. Interfaces may change without notice.\n\nA single orchestrator agent that plans, delegates to\nsub-agents, and merges their results into a shared memory..." },
  { kind: "read", title: "已读取", target: "package.json", output: '{\n  "name": "dsh-superagent",\n  "version": "0.0.3",\n  "type": "module",\n  "scripts": { "test": "vitest run" }\n}' },
  { kind: "cmd", title: "List all source files", target: "Get-ChildItem -Recurse src -Include *.ts | Select Name", output: "orchestrator.ts\nplanner.ts\nmemory.ts\nsubagent.ts\ntools/registry.ts\ntools/shell.ts\ntools/browser.ts", duration: "0.4s", exit: 0 },
  { kind: "read", title: "已读取", target: "docs/001-domain.md", output: "## Domain\n\n- Orchestrator: owns the plan & memory\n- SubAgent: stateless worker, receives a scoped brief\n- Tool: side-effecting capability, registered at boot" },
  { kind: "search", title: "已搜索", target: "\"TODO|FIXME|experimental\" in src/", output: "src/planner.ts:42   // TODO: re-plan on tool failure\nsrc/memory.ts:17    // experimental: vector recall\nsrc/subagent.ts:88  // FIXME: no timeout on long tools" },
  { kind: "write", title: "已创建", target: "dsh-superagent 架构分析.md", diff: { add: ["# dsh-superagent 架构分析", "", "## 1. 整体形态", "单 orchestrator + 多个无状态 sub-agent 的编排结构……", "", "## 2. 实验性 / 未完成部分", "- 失败重规划（planner.ts:42）", "- 向量记忆召回（memory.ts:17）"] } },
  { kind: "edit", title: "已编辑", target: "notes/index.md", diff: { ctx: ["## 阅读记录"], del: ["- (空)"], add: ["- [dsh-superagent 架构分析](./dsh-superagent 架构分析.md)"] } },
];

export const INITIAL_TASKS: Task[] = [
  {
    id: "t-1042",
    title: "分析 dsh-superagent-prototype 架构",
    summary: "克隆仓库、阅读源码与文档，输出中文架构分析",
    status: "done",
    createdAt: now - 95 * min,
    duration: "6 分 12 秒",
    progress: 100,
    tags: ["repo-analyst", "GitHub"],
    messages: [
      { role: "rally", text: "请阅读并分析开源仓库 https://github.com/deepseek-ai/dsh-superagent-prototype（deepseek-ai 组织下的实验性 superagent 原型），用中文产出一份架构分析。\n\n需要讲清楚：\n1. 它整体是什么形态：单体 agent、多 agent 编排、还是 agent 框架/脚手架？仓库里明确标注了哪些是实验性、未完成或已知限制。\n2. 核心模块之间的调用关系与数据流。\n3. 与常见 agent 框架的异同。\n\n结果写入工作区 Markdown 文件，源码保留在 repo/。" },
      { role: "agent", text: "先确认远端可访问，再浅克隆到工作区。" },
      { role: "tools", steps: repoSteps.slice(0, 3) },
      { role: "agent", text: "仓库结构清晰：`src/` 是运行时，`docs/` 有领域设计记录。接下来读入口文档与源码。" },
      { role: "tools", steps: repoSteps.slice(3, 8) },
      { role: "agent", text: "已经收集到足够信息，开始写报告并更新索引。" },
      { role: "tools", steps: repoSteps.slice(8) },
      { role: "agent", text: "仓库可访问，已实际克隆并阅读源码、文档与测试（提交 `8c32a9d`，2026-10-31）。完整分析已写入 [dsh-superagent 架构分析]，源码保留在 `repo/`。\n\n结论：这是 **单 orchestrator + 无状态 sub-agent** 的编排原型，失败重规划与向量记忆仍为实验性。" },
    ],
  },
  {
    id: "t-1043",
    title: "为 landing 页面编写响应式样式",
    summary: "基于设计稿适配 375 / 768 / 1440 三个断点",
    status: "running",
    createdAt: now - 18 * min,
    duration: "进行中 · 4 分",
    progress: 62,
    tags: ["frontend-design"],
    messages: [
      { role: "rally", text: "为 `web/landing` 编写响应式样式，适配 375 / 768 / 1440 三个断点，保持现有组件结构不变。完成后启动本地服务 http://localhost:5173 以便用户预览。" },
      { role: "agent", text: "先看现有样式与组件结构。" },
      {
        role: "tools",
        steps: [
          { kind: "read", title: "已读取", target: "web/landing/src/App.tsx", output: "export default function App() {\n  return (<main className=\"hero\">…</main>)\n}" },
          { kind: "read", title: "已读取", target: "web/landing/src/styles.css" },
          { kind: "edit", title: "已编辑", target: "web/landing/src/styles.css", diff: { ctx: [".hero {"], del: ["  padding: 120px 0;", "  font-size: 64px;"], add: ["  padding: clamp(48px, 10vw, 120px) 0;", "  font-size: clamp(36px, 6vw, 64px);"] } },
          { kind: "cmd", title: "Start dev server", target: "npm run dev -- --port 5173", output: "  VITE v7.3.2  ready in 412 ms\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: use --host to expose", duration: "运行中", exit: 0 },
        ],
      },
      { role: "agent", text: "开发服务已启动，正在处理 768 断点下导航栏的折叠逻辑……" },
    ],
  },
  {
    id: "t-1040",
    title: "运行单元测试并修复失败用例",
    summary: "3 个用例失败，其中 1 个需要确认预期行为",
    status: "failed",
    createdAt: now - 160 * min,
    duration: "2 分 47 秒",
    progress: 80,
    tags: ["vitest"],
    messages: [
      { role: "rally", text: "运行 `packages/core` 的单元测试，修复失败用例。若涉及业务预期变化，停止并汇报。" },
      {
        role: "tools",
        steps: [
          { kind: "cmd", title: "Run tests", target: "npx vitest run packages/core", output: " ✓ parser.test.ts (24)\n ✓ scheduler.test.ts (12)\n ✗ money.test.ts (6)\n   → rounds half to even  expected 2.5 → 2, received 3\n\n Test Files  1 failed | 2 passed (3)\n      Tests  3 failed | 39 passed (42)", duration: "8.1s", exit: 1 },
          { kind: "read", title: "已读取", target: "packages/core/src/money.ts" },
          { kind: "edit", title: "已编辑", target: "packages/core/src/money.ts", diff: { del: ["  return Math.round(v * 100) / 100;"], add: ["  return roundHalfEven(v, 2);"] } },
          { kind: "cmd", title: "Re-run tests", target: "npx vitest run packages/core/money", output: " ✗ money.test.ts (6)\n   → formats negative zero  expected '-0.00' → '0.00'", duration: "2.3s", exit: 1 },
        ],
      },
      { role: "agent", text: "已修复 2 个舍入相关用例。剩余 1 个用例涉及 **负零的显示规则**，属于业务预期变化，按要求停止，等待确认。" },
    ],
  },
  {
    id: "t-1041",
    title: "整理本周 issue 并生成周报",
    summary: "汇总 27 个 issue、14 个 PR，输出周报草稿",
    status: "done",
    createdAt: now - 130 * min,
    duration: "3 分 05 秒",
    progress: 100,
    tags: ["weekly-report", "GitHub"],
    messages: [
      { role: "rally", text: "汇总 rally-app 仓库本周（10/27 – 11/02）的 issue 与 PR，按「新功能 / 修复 / 讨论中」分类，生成周报草稿。" },
      {
        role: "tools",
        steps: [
          { kind: "web", title: "已调用 MCP", target: "github.search_issues · repo:rally/rally-app updated:>=2026-10-27", output: "27 issues · 14 pull requests" },
          { kind: "think", title: "已归类", target: "按标签与标题语义归类 41 项" },
          { kind: "write", title: "已创建", target: "reports/2026-W44.md", diff: { add: ["# 周报 2026-W44", "", "## 新功能（6）", "- 终端标签页支持多会话 #312", "## 修复（11）", "- 修复窗口还原后尺寸异常 #298"] } },
        ],
      },
      { role: "agent", text: "周报草稿已生成：`reports/2026-W44.md`。本周合并 PR 14 个，新开 issue 9 个，关闭 18 个。" },
    ],
  },
  {
    id: "t-1044",
    title: "抓取竞品定价页面并对比",
    summary: "等待 landing 任务完成后开始",
    status: "queued",
    createdAt: now - 6 * min,
    duration: "排队中",
    progress: 0,
    tags: ["browser"],
    messages: [{ role: "rally", text: "打开三家竞品的定价页面，提取套餐、价格与限额，整理为对比表格。" }],
  },
];

export const INITIAL_CHAT: ChatMsg[] = [
  {
    id: "c1",
    role: "user",
    text: "请阅读并分析这个开源仓库：https://github.com/deepseek-ai/dsh-superagent-prototype （deepseek-ai 组织下的实验性 superagent 原型）。用中文产出一份架构分析。\n\n需要讲清楚：\n1. 它整体是什么形态：单体 agent、多 agent 编排、还是 agent 框架/脚手架？仓库里明确标注了哪些是实验性、未完成或已知限制。\n2. 核心模块之间的调用关系与数据流。\n3. 与常见 agent 框架的异同，以及值得借鉴的设计。",
  },
  {
    id: "c2",
    role: "assistant",
    steps: [
      ...repoSteps.slice(0, 3),
      { kind: "write", title: "已创建", target: "notes/brief.md" },
      ...repoSteps.slice(3),
    ],
    taskRef: "t-1042",
    text: "仓库可访问，已实际克隆并阅读源码、文档与测试（提交 `8c32a9d`，2026-10-31）。完整分析已写入 [dsh-superagent 架构分析]，源码保留在 `repo/`。",
  },
  { id: "c3", role: "user", text: "很好。顺便把 landing 页面的响应式也做一下，完成后我想直接预览。" },
  {
    id: "c4",
    role: "assistant",
    taskRef: "t-1043",
    text: "已派发到工位：**为 landing 页面编写响应式样式**。完成后会在 `http://localhost:5173` 启动预览，你可以在右侧浏览器标签页中打开。",
  },
];
