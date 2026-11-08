# 原型盘点与 Pi / dsh 映射

- 盘点日期：2026-11-07
- 盘点范围：`example/rally-ai-agent-ui-design`（React 原型）、`example/pi`（重点 `packages/coding-agent`、`packages/agent`）、`example/dsh-superagent`
- 本文件只做现状盘点与缺口识别，不含设计定稿。
- 方法论原则：**`example/rally-ai-agent-ui-design` 只作风格、交互与组件的参考，不代表功能范围；任何"原型里有"都不构成需求。**
- 标注约定：**【事实】**＝直接读代码/文件确认；**【推断】**＝由命名、结构或行为推断，未经运行验证；**【建议】**＝我的判断。找不到的写"未找到"，不用常识补。

## 已定约束（用户已拍板，不再列为待决策）

| 编号 | 约束 |
| --- | --- |
| C1 | 形态 **rebuild**：在 Pi 上改造，不是简单包一层；工具层参照"主助理那套"扩充领域工具 |
| C2 | 交互 **默认可见、双栏**：左栏主 agent 唯一对话上下文，右栏"工位"展示所有 worker 任务；事件流按 worker 多路复用并带状态；中途插话（steer）是主路径 |
| C3 | 交付 **自用 + 开源，仅 Windows**；美观、易用、可靠；存储不加密，明文本地配置，沿用 Pi |
| C4 | 命名与路径不与 Pi 冲突：配置/数据/缓存/日志/环境变量前缀/包作用域均改为 Rally，保证同机共存 |
| C5 | 门控按**可逆性**分级（修正原"不做权限层"口径）：可逆动作（改文件、装依赖、跑测试、网络请求、建分支、commit）不设门；可逆但有对外代价（push、PR/邮件、部署、付费 API）提示不阻断；不可逆（删数据、drop、强推、覆盖未提交改动、批量清目录）停一次等明确确认。门数量极少；删除收敛为受控工具（dry-run＋确认）；内门触发条件收敛为不可逆清单；审计保留一行可复盘 |
| C6 | 并发上限**默认 2**，设置项可调；超限任务进入"排队中"（等待名额），与依赖排队共用状态、UI 区分原因 |

---

# 一、原型现状（纯事实）

## 1.1 技术栈与构建

**【事实】** 依据 `example/rally-ai-agent-ui-design/package.json`：

| 项 | 现状 |
| --- | --- |
| 框架 | React 19.2.6 + ReactDOM 19.2.6 |
| 语言 | TypeScript 5.9.3（`.tsx`） |
| 构建 | Vite 7.3.2 + `@vitejs/plugin-react` 5.1.1，`vite-plugin-singlefile` 2.3.0（产出单文件 HTML） |
| 样式 | Tailwind CSS 4.1.17（`@tailwindcss/vite`），`clsx` + `tailwind-merge` |
| 图标 | `lucide-react` ^1.70.0 |
| Electron 层 | **不存在**：无 `electron`/`main`/`preload` 依赖或文件，窗口边框由 React 模拟（`src/components/TitleBar.tsx`） |
| 状态管理 | 无 Redux/Zustand；`React.createContext` + 组件本地 state（`src/store.tsx:185-186`） |
| 持久化 | `localStorage`，键 `rally.config.v1`、`rally.onboarded.v1`（`src/store.tsx:84-117`） |
| 数据来源 | 全部为 mock：`src/data.ts` 的 `INITIAL_CHAT`/`INITIAL_TASKS`；`src/App.tsx:126-140` 用定时器模拟发送与任务生成 |

**【事实】** 目录结构（`src/`）：

```
src/
├── App.tsx                  # 主壳：窗口状态、双栏、标签页、mock 对话/任务
├── main.tsx
├── store.tsx                # Context + Config/Provider/McpServer/Skill/Tab 类型 + localStorage
├── data.ts                  # mock 实体：ToolStep / ChatMsg / Task / TaskMsg
├── index.css
├── utils/cn.ts
└── components/
    ├── TitleBar.tsx         # 模拟窗口标题栏与原生菜单
    ├── ChatPanel.tsx        # 左栏主对话（消息流 + 输入框 + 停止/自动批准）
    ├── RightPanel.tsx       # 右栏标签栏（工位/浏览器/终端/任务）
    ├── Workstation.tsx      # 工位名片 + 任务列表 + 过滤/统计
    ├── TaskView.tsx         # 单个任务只读详情（时间线 + 进度条）
    ├── ToolSteps.tsx        # 工具步骤卡片（折叠/展开/diff/输出）
    ├── status.tsx           # TaskStatus → 图标/徽章/文案
    ├── BrowserView.tsx      # 模拟浏览器（地址栏、本地服务入口）
    ├── TerminalView.tsx     # 模拟 PowerShell 终端
    ├── Settings.tsx         # 8 个设置分区
    ├── Onboarding.tsx       # 首次引导
    ├── CommandPalette.tsx   # 命令面板
    ├── ui.tsx / forms.tsx / RichText.tsx
```

## 1.2 页面与组件清单

**【事实】** 视图/组件与职责：

| 视图/组件 | 位置 | 职责与关键交互 |
| --- | --- | --- |
| 主对话 `ChatPanel` | `components/ChatPanel.tsx` | 唯一对话流；用户气泡、助手富文本、内嵌 `ToolSteps`、任务卡片；输入框支持 Enter 发送、附件、`@` 引用任务；模型下拉；`自动批准/需要批准` 切换；忙碌时显示停止按钮（`:207-210`）；顶栏显示在线/思考中与"N 个任务进行中"（`:112-128`） |
| 右栏 `RightPanel` | `components/RightPanel.tsx` | 标签页容器，kind = `workstation` / `browser` / `terminal` / `task`；有启动器（新建标签）与最近任务 |
| 工位 `Workstation` | `components/Workstation.tsx` | 3D 名片（名称、性格、记忆路径、主/工位模型、工作方式、任务数）；统计四项（今日任务/进行中/需处理/已完成）；按状态过滤与时间排序 |
| 任务详情 `TaskView` | `components/TaskView.tsx` | 头部（标题、状态、ID、派发者、任务模型、时长）＋进度条＋时间线（`rally` 简报 / `agent` 文本 / `tools` 步骤）；运行中显示"工位正在执行…"；排队中提示；底部只读说明＋"在主对话中提及" |
| 工具步骤 `ToolSteps` | `components/ToolSteps.tsx` | 按 `StepKind` 渲染图标与动词；一行摘要（`summarize`）；展开后显示输出/diff/退出码/耗时 |
| 状态 `status.tsx` | `components/status.tsx` | `running`=进行中、`done`=已完成、`failed`=需处理（琥珀色）、`queued`=排队中；提供相对时间 |
| 浏览器 `BrowserView` | `components/BrowserView.tsx` | `rally://start` 起始页；地址规范化；本地服务列表（标注由哪个任务启动）；书签 |
| 终端 `TerminalView` | `components/TerminalView.tsx` | 模拟 PowerShell 7.5；cwd 切换、有限命令集（含 `rally status`、`rally tasks`） |
| 设置 `Settings` | `components/Settings.tsx:16-24` | 分区：身份/记忆/供应商/模型/MCP/Skills/外观/关于 |
| 引导 `Onboarding` | `components/Onboarding.tsx` | 首次配置流程（由 `App.tsx` 挂载） |
| 命令面板 `CommandPalette` | `components/CommandPalette.tsx` | 快捷键命令入口 |
| 标题栏 `TitleBar` | `components/TitleBar.tsx` | 模拟最大化/还原/最小化/关闭及菜单 |

## 1.3 核心数据结构（最值钱的部分）

**【事实】** `src/data.ts` 原文结构：

```ts
// data.ts:1-11
type StepKind = "cmd" | "read" | "write" | "edit" | "search" | "web" | "think";
interface ToolStep {
  kind: StepKind;
  title: string;        // 步骤标题，如 "Check if remote repo exists"
  target: string;       // 命令 / 文件路径 / 查询
  output?: string;      // 原始输出（可折叠展示）
  diff?: { add?: string[]; del?: string[]; ctx?: string[] };
  duration?: string;    // 人类可读耗时，如 "1.2s"
  exit?: number;        // 退出码
}
// data.ts:13-15
type ChatMsg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; steps?: ToolStep[]; taskRef?: string; streaming?: boolean };
// data.ts:17-34
type TaskStatus = "running" | "done" | "failed" | "queued";
type TaskMsg =
  | { role: "rally"; text: string }          // 主代理给工位的任务简报
  | { role: "agent"; text: string }          // 工位 agent 的叙述
  | { role: "tools"; steps: ToolStep[] };    // 一组工具步骤
interface Task {
  id: string; title: string; summary: string; status: TaskStatus;
  createdAt: number; duration: string; progress: number; tags: string[];
  messages: TaskMsg[];
}
```

**【事实】** `src/store.tsx` 配置与容器类型：

```ts
// store.tsx:3-45
interface Provider { id; name; baseUrl; apiKey; models: string[] }
interface McpServer { id; name; transport: "stdio" | "http"; command; enabled; tools: number }
interface Skill { id; name; desc; source: "内置" | "本地" | "社区"; enabled }
interface Config {
  name; personality; workstyle; memoryPath;
  providers: Provider[]; rallyModel; taskModel;
  theme: "light"|"dark"|"system"; accent; fontSize: "sm"|"md"|"lg";
  density: "compact"|"cozy"; mcp: McpServer[]; skills: Skill[]; autoApprove: boolean;
}
// store.tsx:167-174
type TabKind = "workstation" | "browser" | "terminal" | "task";
interface Tab { id; kind: TabKind; title; taskId?; url? }
```

**【事实】** mock 数据规模与状态分布（`src/data.ts:52-153`）：5 个任务，状态分别为 `done`/`running`/`failed`/`done`/`queued`；任务字段含 `progress`(100/62/80/100/0)、`duration`（中文可读时长）、`tags`（技能名或来源，如 `repo-analyst`、`browser`）。`INITIAL_CHAT` 为 4 条消息（2 用户、2 助手），助手消息用 `taskRef` 指向任务 `t-1042`/`t-1043`。

## 1.4 原型默认假设（逐条标注）

| 假设 | 证据 | 性质 |
| --- | --- | --- |
| 单会话：只有一个 `messages` 数组，没有会话列表/历史侧栏 | `App.tsx:39`；`ChatPanel` 无会话切换 UI | 【事实】 |
| 每次发送都会派发一个新任务 | `App.tsx:132-140` 为每条发送创建 `Task` | 【事实】 |
| 任务由主代理派发，不能直接与工位对话 | `TaskView.tsx:80-95` 只读底栏 | 【事实】 |
| 双栏常驻、可拖拽调宽、可收起 | `App.tsx:28-31`（`rightOpen`、`ratio=0.5`） | 【事实】 |
| 有主对话级"停止"按钮 | `ChatPanel.tsx:207-210`；mock 由定时器实现 | 【事实】 |
| 有"自动批准/需要批准"切换 | `ChatPanel.tsx:199-205`、`Config.autoApprove` | 【事实】 |
| 没有审批弹窗/审批队列组件 | 全 `src/components` 未找到 approval/confirm 组件 | 【事实：未找到】 |
| 没有分支/回退/checkpoint UI | 未找到对应组件或字段 | 【事实：未找到】 |
| 任务状态机只有 4 态，无 waiting/blocked | `data.ts:17`、`status.tsx:5-10` | 【事实】 |
| 任务进度是 0-100 数字，来源未定义 | `data.ts:31`，mock 手写 | 【事实】 |
| "并行"只体现在多任务同时存在与"N 个任务进行中" | `ChatPanel.tsx:80`；`queued` 文案"等待前序任务完成"（`TaskView.tsx:75`） | 【推断：是串行队列语义＋并行展示，未实现调度】 |
| 工位 = 一个固定 agent 的"名片"＋任务列表，不是多工位实例 | `Workstation.tsx` 只有一张名片 | 【事实】 |
| 浏览器/终端是占位实现，不是真实 WebView/PTY | `BrowserView.tsx:6-45`、`TerminalView.tsx:8-22` | 【事实】 |
| 记忆只是一个路径字符串，无读写 UI | `Config.memoryPath`（`store.tsx:34,60`），Settings 仅展示 | 【事实】 |
| 任务模型与主模型是两个独立配置 | `Config.rallyModel` / `taskModel`（`store.tsx:36-37`） | 【事实】 |
| "新对话"按钮存在，但语义为清空/重开（mock） | `ChatPanel.tsx:122`、`App.tsx` `onNewChat` | 【事实按钮】／【推断语义】 |

---

# 二、映射表（UI/状态 → Pi / dsh）

## 2.1 Pi 侧现状（映射依据）

**【事实】** 关键对应物与位置：

| 能力 | Pi 位置 | 说明 |
| --- | --- | --- |
| 会话对象 | `packages/coding-agent/src/core/agent-session.ts`（`AgentSession`） | 单会话运行时；`subscribe()` 暴露事件流 |
| 核心事件 | `packages/agent/src/types.ts:530-542` | `agent_start` / `turn_start` / `message_start` / `message_update` / `message_end` / `turn_end` / `agent_end` / `tool_execution_start|update|end` |
| 会话附加事件 | `packages/coding-agent/src/core/agent-session.ts:210-251` | `agent_settled{aborted}`、`queue_update{steering,followUp}`、`compaction_*`、`entry_appended`、`auto_retry_*` 等 |
| 消息落盘 | 同上 `:1211-1231` | `message_end` 按角色写入 `SessionMessageEntry` / `CustomMessageEntry` |
| 会话存储 | `core/session-manager.ts:978-1084` | append-only JSONL 树、leaf 指针、`parentSession`；文件 `${timestamp}_${sessionId}.jsonl` |
| 多会话/恢复/分叉 | `core/session-manager.ts:1760-1881`；`core/agent-session-runtime.ts:226-350` | `create/open/continueRecent/inMemory/forkFrom`、`fork()` |
| 流式与中断 | `agent-session.ts:2524-2609` | `sendUserMessage(steer/followUp)`、`clearQueue()`、`abort()` → `agent_settled{aborted}` |
| 工具事件 | `agent-loop.ts:495-958` | `tool_execution_start/update/end` 带 `toolCallId`、`toolName`、`args`、`partialResult` |
| 嵌套/子调用 | `core/extensions/types.ts:389-415` | 工具可嵌套调用，事件带 `parentToolCallId`，失败 `isError:true` |
| 工具暴露/注解 | `core/extensions/types.ts:523-552` | `ToolExposure`（direct/model-only/codemode/deferred/hidden）、`ToolAnnotations`（readOnly/destructive/...） |
| 内置工具 | `core/tools/{bash,powershell,read,write,edit,find,grep,ls}.ts` | 共 8 个基础工具（无 browser/http/pdf/memory 等） |
| diff 数据 | `core/tools/edit.ts:65-72`；`edit-diff.ts:395-434` | `EditToolDetails{ diff, patch, firstChangedLine }`，可生成 unified patch |
| 系统提示词 | `core/system-prompt.ts:9-77` | 分节构建（`sections`）、自定义/追加、工具清单；默认工具 `[read,bash,edit,write]`（`:14,64`） |
| 配置目录 | `src/config.ts:602-680` | `APP_NAME`/`CONFIG_DIR_NAME` 由 `package.json` 的 `piConfig` 决定（`packages/coding-agent/package.json:6-7`，`configDir=".pi"`）；`~/.pi/agent/` 下有 themes/models.json/auth.json/settings.json/tools/bin/prompts/sessions/`pi-debug.log` |
| 环境变量 | `src/config.ts:609-611`、`:621` | `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_SHARE_VIEWER_URL` |
| 项目级资源 | `src/extensions/mcp/config.ts:5`、`core/package-manager.ts:2686-2747`、`core/trust-manager.ts:188` | `<project>/.pi/mcp.json`、`.pi/` 扩展与 skills、`.agents/skills` |
| RPC/结构化输出模式 | `src/modes/rpc/`、`src/modes/json-event.ts` | 已存在，可作为 Electron 主进程桥接基础 |
| 工具调用前钩子 | `core/extensions/types.ts:1214-1284, 1707, 1475-1484` | `tool_call` 事件在工具执行前触发，可原地修改 `input`，返回 `{block,reason,terminate}` 阻断；是内门拦截的现成挂点 |
| 长期记忆 | — | **未找到**：`config.ts` 无 memory 路径，工具集无 memory 工具 |
| 工具执行审批 | — | **未找到**工具级 approval（`--approve` 仅用于信任项目本地资源） |
| Windows 进程树终止 | `src/utils/shell.ts:225-236` | 使用 `taskkill.exe`；另有 `utils/windows-self-update.ts:6` 的隔离目录、3 处 `MAX_PATH` 注释 |

**【事实】** Windows 相关现状：单实例逻辑**未找到**（属 Electron 层新增）；长路径处理仅在 3 处注释中提及（`external-editor.ts:29`、`clipboard-command.ts:15`、`open-browser.ts:22`），无统一封装。

## 2.2 dsh 侧现状（映射依据）

**【事实】** `example/dsh-superagent` 是 **DSH（DeepSeek Harness）bundle**，依赖 `@deepseek-ai/dsh-*` 与 `cordis`，**不依赖 Pi**（`package.json:58-86`，`peerDependencies` 中无 `@earendil-works/*`）。

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 工单聚合 | `src/core/model.ts:277-308` | `Ticket{ id,title,decisionId,mandate,channels,ended?,attention?,assignments,inputs,undelivered,follows?,answers?,origin,execution?,delivery? }` |
| 派发单元 | `model.ts:218-233` | `Assignment{ id,state,createdAt,startedAt,endedAt,endedReason,report?,deliveredAt?,idleAt? }` |
| 任务状态 | `model.ts:211,216` | `AssignmentState: pending|running|ended`；`ReportState: progress|waiting|ready|blocked|failed|dropped` |
| 结果 | `model.ts:271-273` | `TicketOutcome: completed|merged|closed|dropped|stopped`；`Attention` 表示"需要人回答的问题" |
| 输入/跟进 | `model.ts:235-257` | `TicketInput`（trigger/policy-changed/reopen/resumed/text/note），含 `readAt`/`deliveredAt`/`deliveredTo` |
| 工单生命周期 | `core/tickets.ts:32-56` | `create()` 建 Ticket + Mandate + 首个 Assignment 并启动 executor；`bind()`、`threadClosed()` 等 |
| 持久化 | `src/app/store.ts:58-96` | SQLite WAL；表 `kv/trigger/disposition/thread/ticket/decision/outbox/effect/trigger_thread`；schema v11、迁移保护 |
| 工具 | `src/app/tools/{tool,main,executor}.ts` | 主 agent 工具，含 `orchestrator_report` 一类上报入口（文件存在，细节未逐行验证） |
| 中继（relay） | `docs/003-execution.md:155-157`、`docs/007-architecture.md:177,237`、`src/kv.ts:37`、`src/executor/dsh.ts:72-73` | worker 报告/提问/人的 follow-up 通过 outbox/effect 异步 relay 进主会话；失败重试 2s 起、翻倍至 60s |
| 授权策略 | `src/policy.ts`、`docs/002-authorization.md` | 有 Policy/Mandate 门控（属"权限系统"，与 C5 的可逆性门控口径不同，只作概念参考） |

**【推断】** dsh 的 `Ticket/Assignment/ReportState/Attention` 是比原型 `Task` 更完整的工单模型；但它绑定 DSH 运行时与 SQLite，直接移植到 Pi 需要重写适配层，且其授权模型应被剥离。

## 2.3 映射表

图例：**已有**＝Pi 现成可直接用；**部分**＝有底层数据/机制但需适配；**缺失**＝Pi 无对应物，需新增。

| # | 原型元素（文件:行） | 背后的状态 | Pi 对应物 | dsh 对应物 | 判定 |
| --- | --- | --- | --- | --- | --- |
| M1 | 主对话消息流 `ChatPanel.tsx:147-170` | `ChatMsg{role,text,steps,streaming}` | `AgentSession` 消息 + `message_start/update/end`；RPC 模式 | DSH Session（peer 依赖） | 已有（除 `taskRef`） |
| M2 | 流式打字 `ChatPanel.tsx:155-163` | `streaming` | `message_update` + `AssistantMessageEvent` | DSH session stream | 已有 |
| M3 | 停止按钮 `ChatPanel.tsx:207-210` | 忙碌/空闲 | `abort()` → `agent_settled{aborted}` | `Tickets.end/stop`（人停止工单） | 部分：主对话可中断，worker 级停止需新增路由 |
| M4 | 中途插话/排队消息 | 未显式建模 | `queue_update{steering,followUp}`；`sendUserMessage(steer/followUp)`；`clearQueue()` | `delivery`/`relay`（`docs/003:155`） | 已有语义；UI 展示与 worker 路由缺失 |
| M5 | 派发任务卡片 `ChatPanel.tsx:33-52` | `taskRef` | **无** | `Ticket` + `Assignment` | 缺失：Pi 消息无任务引用 |
| M6 | 任务实体 `data.ts:24-34` | `Task{status,progress,tags,messages,duration}` | **无** | `Ticket`/`Assignment`（字段更细） | 缺失：需在 Pi 上新建任务层 |
| M7 | 任务状态 `status.tsx:5-10` | `running/done/failed/queued` | 无（仅 agent busy/aborted） | `AssignmentState`+`ReportState` | 部分：dsh 有更细状态，原型缺 `waiting/blocked` |
| M8 | 进度条 `TaskView.tsx:32-36` | `progress 0-100` | **无** | **无**（只有 `report.summary` 文本） | 缺失：进度语义待定义 |
| M9 | 需处理/等待人工 `status.tsx:8` | `failed` | 无 | `blocked`/`waiting` + `Attention` | 部分：dsh 有数据结构，原型无对应 UI |
| M10 | 工位名片 `Workstation.tsx:9-80` | 名称/性格/记忆路径/双模型/工作方式 | 无（散落在 config/system prompt） | `Execution{name,dir,assignment}` | 缺失（展示层，成本低） |
| M11 | 任务列表与过滤 `Workstation.tsx:82-120` | 状态统计/排序 | 无 | `tickets.list/open/active`（`app/store.ts:233-241`） | 部分 |
| M12 | 工具步骤卡片 `ToolSteps.tsx:40-82` | `ToolStep{kind,title,target,output,diff,duration,exit}` | `tool_execution_*` 原始事件 + `EditToolDetails` | 无统一卡片模型 | 部分：需统一投影层 |
| M13 | 工具执行中状态 | 运行中/完成/失败 | `tool_execution_start/update/end` | DSH 工具事件（peer） | 已有原始事件 |
| M14 | `think` 步骤（`data.ts:1`） | 思考计数 | **无**（thinking 属模型输出，无独立事件） | 无 | 缺失/需映射策略 |
| M15 | 命令退出码/耗时 `ToolSteps.tsx:65-76` | `exit`/`duration` | bash/powershell 有结果，退出码/耗时表现**未逐行确认** | 无 | 部分 |
| M16 | diff 展示 `ToolSteps.tsx:70-75` | `diff{add,del,ctx}` | `edit.ts:65-72` 的 `diff/patch/firstChangedLine` | 无 | 已有数据，缺 UI 映射 |
| M17 | 右栏标签栏 `RightPanel.tsx` | `Tab{kind,title,taskId,url}` | **无** | DSH client slots/UI（peer） | 缺失：Electron 层新增 |
| M18 | 浏览器预览 `BrowserView.tsx` | `rally://start`、本地服务列表 | **无** | 无 | 缺失：需 WebView 层 |
| M19 | 终端标签 `TerminalView.tsx` | cwd/历史/命令 | bash/powershell 为非交互执行 | 无 | 缺失：需 PTY（Windows ConPTY） |
| M20 | 设置-供应商/模型 `Settings.tsx` | `Provider[]`、`rallyModel`/`taskModel` | `models.json` + `auth.json` + `ModelRuntime` | DSH `llm`/settings | 部分：双模型策略需新增 |
| M21 | 设置-MCP | `McpServer{transport,command,enabled,tools}` | `<agent>/mcp.json` 与 `.pi/mcp.json`，`mcpServers` 形状 | 无 | 已有 |
| M22 | 设置-Skills | `Skill{source,enabled}` | `package-manager` 加载 `skills/`；`skills.ts` 注入提示词 | DSH `skill`（peer） | 已有 |
| M23 | 设置-记忆 | `memoryPath` | **未找到** | 无 | 缺失 |
| M24 | 设置-外观 | theme/accent/fontSize/density | 仅 TUI 主题（`themes/`） | DSH client 主题 | 部分：Electron CSS 需另建 |
| M25 | 身份/性格/工作方式 | `Config.name/personality/workstyle` | `system-prompt.ts` 的 `customPrompt`/`appendSystemPrompt`/`sections` | DSH `system-prompt`（peer） | 已有机制，缺配置落库与界面 |
| M26 | 自动批准 `ChatPanel.tsx:199-205` | `autoApprove`（当前为全局开关） | `tool_call` 钩子可 `block`；无门控/审计 | 无审批系统 | 部分：需改为按任务的外门＋不可逆动作内门，并新增审计 |
| M27 | 新对话按钮 | `onNewChat` | `newSession()`/`fork()`（`agent-session-runtime.ts:226-350`） | DSH 新 Session | 部分：语义待定 |
| M28 | 会话持久化 | `localStorage`（仅配置） | JSONL append-only 树 | SQLite ticket/outbox/effect | 已有（Pi 会话），任务级缺 |
| M29 | 崩溃恢复 | 无 | 会话可重开；**任务/事件级重放未找到** | `outbox`/`effect` 重试 | 缺失 |
| M30 | 改动回滚 | 无 | 仅 diff，无快照/undo | 无 | 缺失 |

## 2.4 缺口清单（17 条）

**【事实/推断混合，逐条标注】** 统计：**明确缺失 11 条**、**部分已有 6 条**。按来源：**需求必然 11 条**、**架构必然 1 条**、**原型独有 5 条**。

来源定义：**需求必然**＝由 C1–C6 必然推出，必须做；**架构必然**＝由 rebuild 后的架构形态推出，必须做；**原型独有**＝只是原型画了、用户没要求，开工默认不做，等用户确认。

| 编号 | 缺口 | 判定 | 来源 | 说明 |
| --- | --- | --- | --- | --- |
| G1 | 任务/工单实体与状态机（含 `waiting/blocked/attention`、时长、标签、简报） | 缺失 | 需求必然（C1/C2） | Pi 只有 session/turn；原型 4 态不足以表达"需打扰人"的状态 |
| G2 | worker 事件多路复用（每条事件带 `workerId`/任务 ID/父子调用） | 缺失 | 需求必然（C2） | Pi 事件仅有 `parentToolCallId`，无 worker 维度 |
| G3 | 任务↔消息关联（`taskRef`、`@`提及、派发回执） | 缺失 | 需求必然（C2） | Pi 消息无任务字段；dsh relay 可作语义参考 |
| G4 | 工具结果统一投影（`StepKind`/`title`/`target`/`diff`/`exit`/`duration`） | 部分 | 需求必然（C1/C2） | 原始事件与 diff 数据已有，缺统一 schema 与归一化 |
| G5 | 领域工具集（浏览器/HTTP/GitHub/PDF/记忆/MCP 管理等） | 缺失 | 需求必然（C1） | Pi 仅 8 个基础工具（`core/tools/`） |
| G6 | 长期记忆（读写、检索、注入） | 缺失 | 原型独有 | 全仓库未找到 memory 实现；原型只有 `memoryPath` 字段 |
| G7 | 主模型/工位模型双模型分配 | 部分 | 原型独有 | Pi 有 `ModelRuntime`，无按 worker/任务分配策略；用户未要求双模型 |
| G8 | 任务进度语义（`progress 0-100` 来源） | 缺失 | 原型独有（D8 已定不做） | 已定不显示百分比，改为"阶段名＋实时耗时" |
| G9 | worker 级中断与 steer 路由/插入点 | 部分 | 需求必然（C2） | Pi 有 `steer/followUp/abort`，缺到具体 worker 的路由 |
| G10 | 浏览器预览层（标签、地址栏、本地服务发现） | 缺失 | 原型独有 | 需 Electron WebContentsView；用户未要求右栏浏览器 |
| G11 | 终端 PTY 层（真实 PowerShell、Windows ConPTY） | 缺失 | 原型独有 | Pi 工具是非交互执行；用户未要求右栏终端 |
| G12 | 任务级崩溃恢复与事件重放 | 缺失 | 架构必然（D3 事件流） | Pi 会话可恢复，任务/事件流无重放语义 |
| G13 | 改动可回滚（快照/undo） | 缺失 | 需求必然（C5） | Pi 只有 diff；C5 的兜底依赖此项 |
| G14 | 命名/路径隔离（`.pi`→`.rally`、`PI_*`→`RALLY_*`、包作用域） | 部分 | 需求必然（C4） | Pi 由 `piConfig` 驱动，改名机制现成，但需全面替换与迁移策略 |
| G15 | Windows 特化（单实例、长路径、编码、进程树终止） | 部分 | 需求必然（C3） | 进程树终止已有（`shell.ts:225-236`）；单实例/长路径/编码需新增 |
| G16 | 可逆性门控（外门派发确认＋内门不可逆确认＋审计） | 部分 | 需求必然（C5） | Pi 有 `tool_call` 钩子可 block，但无门控编排、无审计、无受控删除工具 |
| G17 | 访问痕迹可见（每任务读了哪些文件、访问了哪些域、改了哪些文件） | 缺失 | 需求必然（C5 可见性） | Pi 工具事件有原始参数，但无按任务的访问清单与聚合 |

---

# 三、决策清单（含已定，按"不定就动不了工"排序）

说明：C1–C6 已定，不在下表。每条只给选项与代价，**不替用户拍板**；"建议默认"仅为我的推荐。D1/D2/D3/D8 已于第二版转为【已定】，其余为**待定**。

## D1【已定】任务层归属与落库

- **问题**：工单/任务实体放在哪、存什么、谁是唯一真相？
- **选项**：
  - A. 自建 Rally 任务层（新包，JSONL/JSON 任务文件 + 内存态），Pi 只作执行内核。代价：需自写状态机/恢复/查询，但与 Pi 解耦、可控。
  - B. 借用 dsh 的 Ticket/Assignment/ReportState 概念与 SQLite 表结构自建（不引 DSH 运行时）。代价：需移植 schema 与仓储层，SQLite 依赖进包；字段较全。
  - C. 直接嵌 dsh 代码。代价：引入 DSH peer 依赖与 cordis 运行时，与"rebuild on Pi"冲突，不建议。
- **已定**：A＋吸收 dsh 的 `ReportState`/`Attention` 字段命名；任务层独立于 Pi 会话。
- **硬约束**：**单写者 + 单调递增 seq**；多写者会让 JSONL 烂掉，所有任务写入必须经同一写者串行化。

## D2【已定】worker 的运行时拓扑

- **问题**：每个工位任务是"独立 Pi `AgentSession`"还是"主 session 内的子代理工具调用"？
- **选项**：
  - A. 每个任务一个 `AgentSession`（独立 cwd/模型/上下文），主进程持有 session 池并订阅事件。代价：会话数多、内存与文件句柄上升；隔离好、可并行。
  - B. 主 session 内用 subagent 工具（嵌套 `parentToolCallId`）。代价：上下文易膨胀、中断粒度粗、难做独立工位视图。
  - C. 混合：默认 A，小微任务允许 B。代价：两套路径，测试成本高。
- **已定**：A——一任务一个 `AgentSession`；任务完成即归档 session；暂不做 C。

## D3【已定】事件总线、持久化与重放

- **问题**：双栏消费的同一事件流由谁产生、存哪、崩溃后如何重放？
- **选项**：
  - A. 内存 EventBus + 每任务 append-only 事件文件（JSONL），启动时重放到 UI。代价：自建序列号/去重/截断策略。
  - B. 只依赖 Pi 会话 JSONL，UI 从会话重建。代价：任务/工位状态不在会话里，需额外映射；重放粒度粗。
  - C. SQLite 事件表（借鉴 dsh `outbox/effect`）。代价：引入 SQLite、写放大；查询与恢复强。
- **已定**：A——独立 JSONL 事件流 + 全局单调递增 `seq`；顺序必须**先落盘再广播**；事件信封带 `taskId`；保留后续换 SQLite 的接口。
- **硬约束**：`seq` 为全局值（不是每任务独立），崩溃重放以 `seq` 为唯一序。

## D4（阻塞）工具卡片投影契约

- **问题**：UI 卡片直接消费 Pi 原始事件，还是中间层归一化为 `ToolStep`？
- **选项**：
  - A. 新增投影层（`toolName + args + result` → `{kind,title,target,output,diff,exit,duration}`），UI 只认投影结构。代价：需为每个领域工具写映射与测试。
  - B. UI 直接渲染原始事件。代价：卡片与工具实现强耦合，新增工具即改 UI。
- **建议默认**：A；投影层同时供主对话与工位复用（对齐 M12）。

## D5（阻塞）改动回滚机制

- **问题**：C5 的"改动可回滚"如何实现？
- **选项**：
  - A. 任务级文件快照（改动前备份到 `.rally/snapshots/<taskId>/`，完成/失败后可一键还原）。代价：磁盘占用、大文件需排除规则。
  - B. 依赖工作区 git（每任务检查点 commit/ stash）。代价：污染用户仓库历史，不适合非 git 目录。
  - C. 仅保留 diff 供人工回退。代价：不满足"可回滚"。
- **建议默认**：A＋排除 `node_modules/.git` 等；仅对写/编辑工具生效。

## D6（阻塞）双模型的配置与路由

- **问题**：`rallyModel`/`taskModel` 如何映射到 Pi 的 provider/model，并按任务生效？
- **选项**：
  - A. 两个模型 ID 存 Rally 配置，创建 worker session 时传入 `ModelRuntime` 选择。代价：需确认 Pi 是否支持 per-session 模型切换（**待验证**）。
  - B. 所有任务用主模型。代价：省钱/省事，但违背原型假设。
- **建议默认**：A；若 Pi 不支持 per-session 覆盖，则退化为"进程级双 runtime"。

## D7（阻塞）"新对话"的语义

- **问题**：按钮是清空上下文、创建新 session，还是 fork 当前会话？
- **选项**：
  - A. 新建空 session（旧对话进历史）。代价：需要历史列表（原型没有）。
  - B. 清空当前会话（不可恢复）。代价：误操作风险。
  - C. fork 当前会话（保留上下文）。代价：与"唯一对话上下文"表述冲突。
- **建议默认**：A，最小化历史 UI（仅在标题栏提供最近会话）。

## D8【已定】进度语义

- **问题**：`progress 0-100` 从哪来？
- **已定**：**不显示百分比**。agent 任务无法可靠估算进度，百分比是假精确；卡在某个数字不动比没有进度条更伤信任。
- **替代展示**：当前阶段名＋实时耗时（原型进度条只作风格参考，不实现）。
- 保留原选项供追溯：A 步骤计数、B 阶段权重、C 不显示百分比。

## D9（高）记忆是否进 v1

- **问题**：`memoryPath` 只是配置，是否实现读写与注入？
- **选项**：
  - A. v1 不做，仅保留配置项并在 UI 标注"未启用"。代价：原型有一处空洞。
  - B. 实现简版（Markdown 记忆文件 + 每轮注入摘要）。代价：需定义写入时机、去重、上下文预算。
- **建议默认**：A；v1 结束后单独立项。

## D10（中）浏览器/终端的实现深度

- **问题**：右栏浏览器与终端是"真 WebView + 真 PTY"还是"外部打开"？
- **选项**：
  - A. Electron `WebContentsView` + `node-pty`（ConPTY）。代价：包体与安全面增大（门控不替代进程/站点隔离，仍需基本隔离）。
  - B. 浏览器用系统默认浏览器，终端用独立窗口。代价：与原型的"右栏标签"体验不符。
- **建议默认**：A，但排在任务层与事件流之后；v1 可先只做浏览器（终端延后）。

## D11（中）Windows 交付形态

- **问题**：安装/更新与单实例如何做？
- **选项**：
  - A. electron-builder（NSIS）+ 自更新。代价：签名/更新通道需配置。
  - B. 免安装 zip＋手动更新。代价：无自动更新，体验差。
- **建议默认**：A；单实例用 `requestSingleInstanceLock`，启动参数转发到已存在实例（**Pi 无此逻辑**，需新增）。

## D12（低，但机械量大）命名与迁移

- **问题**：`.rally` 目录名、`RALLY_*` 环境变量、包作用域（建议 `@rally/*`）如何落地？是否兼容读取旧 `.pi` 配置？
- **选项**：
  - A. 只读新目录，不迁移。代价：用户需重新配置（自用可接受）。
  - B. 首次启动检测 `~/.pi/agent` 并复制可迁移项（settings/models/auth）。代价：需字段映射与冲突处理。
- **建议默认**：A＋首次启动提示；开源版再加 B。

---

## 附：Pi 现有路径与环境变量清单（供改造计划直接引用）

| 类别 | 现值 | 来源 |
| --- | --- | --- |
| 应用名/标题 | `pi` / `π` | `src/config.ts:602-605`（来自 `package.json` `piConfig.name`） |
| 配置目录名 | `.pi` | `src/config.ts:606`；`packages/coding-agent/package.json:6-7` |
| Agent 目录 | `~/.pi/agent`（可被 `PI_CODING_AGENT_DIR` 覆盖） | `src/config.ts:629-636` |
| 会话目录 | `~/.pi/agent/sessions/<encoded-cwd>/`（可被 `PI_CODING_AGENT_SESSION_DIR` 覆盖） | `src/config.ts:673-676`、`ENV_SESSION_DIR` `:611` |
| 主题/模型/凭证/设置 | `~/.pi/agent/{themes,models.json,auth.json,settings.json}` | `src/config.ts:638-656` |
| 工具/二进制/提示词 | `~/.pi/agent/{tools,bin,prompts}` | `src/config.ts:658-671` |
| 调试日志 | `~/.pi/agent/pi-debug.log` | `src/config.ts:678-680` |
| 项目级配置 | `<project>/.pi/mcp.json`、`.pi/` 扩展与 skills、`.agents/skills` | `src/extensions/mcp/config.ts:5`、`core/package-manager.ts:2686-2747`、`core/trust-manager.ts:188` |
| 环境变量 | `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR`、`PI_SHARE_VIEWER_URL` | `src/config.ts:609-611,621` |
| Windows 自更新隔离 | `.pi-native-quarantine` | `src/utils/windows-self-update.ts:6` |
| 包作用域 | `@earendil-works/pi-*` | `packages/coding-agent/package.json:2` 等 |

## 附：未验证事项（下一轮需实测）

1. Pi 是否支持 per-session 模型切换（影响 D6）。**【未验证】**
2. bash/powershell 工具结果是否结构化携带 `exitCode`、耗时（影响 M15/G4，**需求必然**）。**【未验证】**
3. Pi RPC 模式的事件覆盖度是否与会话事件一致（影响 Electron 桥接）。**【未验证】**
4. Pi `durable` 包的 checkpoint 语义（仅作重放参考，不默认引入）。**【未验证】**
5. dsh `orchestrator_report` 的具体字段与卡片渲染映射（文件存在，未逐行读）。**【未验证】**
