# Rally 开发交接（更新 2026-11-09）

> 先读 `docs/开发实施TODO.md` 和 `docs/superagent/00-问答记录.md`。实施进度以 TODO 的验证记录为准；本文保留历史背景，不作为阶段完成证明。

## 0. 现状一句话

主会话、供应商配置和基本任务链路已修复并通过现有能力验收。2026-11-09 用户确认真实供应商 Messages/Responses 双协议及现有能力完整测试均通过，授权继续后续 TODO。后续协议、作业/服务等仍未实现，不能据此称整个编排完成。

### 0.0 本轮收口（2026-11-09，优先于后面的历史记录）

- `supervisor/session.ts` 统一角色会话创建：resource loader 显式 reload，白名单包含 custom tools，创建后校验角色与实际 active tools。主会话只读 + 8 个任务工具，worker 无派发/子 agent；禁用 Pi 默认身份和不存在的 docs 注入。
- `ModelStore` 保存独立 `active`/`worker`（模型及思考档位），共用 Rally 供应商运行时。设置页两套选择器，主对话仍可切主模型。worker 启动/续接读当前设置，不回退 Pi 默认；缺模型明确失败。
- 用户消息附宿主 `#N`，任务工具引用逐字原话。note 只作路由背景/明确约束，统一长度与描述；代答要求当前 questionId，不再允许主模型自编 answer 替代原话。
- 审批开关持久化，旧 pending 不追溯批准。主对话卡片展示原话/cwd/mode 后批准，右栏只读。无模拟百分比，工位名片展示实际双模型。
- 补启动取消/终态晚报保护、按 taskId 去重名额、空闲 worker 唤醒排队、同 JSONL 续接重新审批/换模型、重启 interrupted 待决；readonly write/edit 检查产出目录及 junction，成功写入及时记录 changedFiles。
- “整理上下文”真实调用 compact，保留 UI 历史和原话 ID；压缩后的任务状态重注入、chat_search 和物理分段仍未做。
- 定向自动测试在 `packages/coding-agent/test/suite/rally-supervisor.test.ts`，使用 harness/faux provider，不调真实 API。Electron 以隔离 HOME/AppData 和本地假 Messages 服务验证模型选择、高档位实际参数、主对话审批、读文件/汇报/唤醒、开关及模型/任务重启恢复，renderer 异常 0。
- 双端类型检查、完整构建通过；根 typecheck 仍被两个既有模型数据测试阻塞。最终测试数量与复核结果见 TODO。
- 真供应商 Messages/Responses 和现有能力完整清单已由用户实测通过；当前收口已验收。后续缺口仍未勾选，按 TODO 顺序推进，不宣称整个编排完成。

### 0.1 D: 会话进展

已完成：

- §3.1–3.4 第 5 步：根 `package.json`、三个 tsconfig、`electron.vite.config.ts`、`electron-builder.yml`、`src/` 骨架、安装、模型数据、构建、冒烟（`RALLY_SMOKE=1`）。
- §4：bin/exports 已改；`.pi` 文案已改；`AGENTS.md` 已建；README 已重写。
- 原型搬入 `src/renderer/src`：去掉了模拟桌面和窗口框，换成无边框 Electron 窗口，标题栏按钮经 IPC 控制真实窗口。

和 §4 不一样的地方：`startup-ui.ts` 的 `OFFICIAL_CONFIG_DIR_NAME = ".pi"` **不要改**，它判断“是否官方 Pi 发行版”，Rally 必须判定为否。

未完成：

- 附录 B 第 1–7 项实测，结果写到 `docs/superagent/06-M0实测.md`。第 8 项（node-pty）留到做终端时；第 9 项只作参考。
- `npm run dist` 打包未实测（workspace 链接的 `@rally/*` 能否正确进包要验证）。
- `@rally/ai` 的 `fireworks-models` 等测试类型报错：模型数据是当天拉取的，和测试写死的模型名对不上。
- 模型数据是否入库仍待定，目前已 gitignore。

M1 接后端时，原型需要按问答记录调整的点：

| 原型现状 | 按问答记录改为 | 依据 |
| --- | --- | --- |
| `data.ts`、`App.tsx` 的 `send` 是演示数据和模拟流程 | 接 IPC 与真实事件 | M1 |
| 任务卡有进度条和技能标签 | 只显示粗略状态＋时间 | Q13/Q16 |
| “新建对话”（按钮、Ctrl+N、菜单、命令面板） | “整理上下文” | Q11 |
| 浏览器标签是 iframe（CSP 暂开 `frame-src`） | `WebContentsView`，独立 partition，改完收紧 CSP | Q20 |
| 终端是模拟的 | xterm.js＋node-pty，归用户 | Q20 |
| 配置存 localStorage | 主进程持久化：供应商/模型写 `~/.rally/agent/rally-models.json`；主会话模型在对话框底部选择 | Q22 / M1-C |

### 0.2 M1-A 进展（2026-11-08 第二段会话）

已完成「主会话接后端」：

- 新增 `src/main/supervisor/event-log.ts`（单写者、单调整数 seq、`state/events-0001.jsonl` 追加日志，重启回放）。
- 新增 `src/main/supervisor/main-agent.ts`：用 Pi `createAgentSession` 建主会话（`cwd=~/.rally/agent/main`，`SessionManager.continueRecent(mainCwd, sessionsMainDir)`），只启用 `read/grep/find/ls`，`noContextFiles/noExtensions/noSkills/noPromptTemplates/noThemes`，系统提示来自 `src/main/prompts.ts`。
- 聊天流：监听 Pi 的 `message_start/update/end`，助手消息按 `#N` 编号落事件日志；`agent_start/agent_end` 驱动 busy；用户消息立即入列并落盘（不回显 Pi 的 user 事件）；忙时 `sendUserMessage(..., { deliverAs: "steer" })`。
- IPC：`chat:state/send/abort/reset` + `chat:event` 推送（`src/shared/ipc.ts`、`src/main/ipc.ts`、`src/preload/index.ts`）。
- 渲染层：`src/renderer/src/chat.ts` 的 `useChat` 接管消息/忙碌状态；`App.tsx` 删除模拟发送与定时器；`ChatPanel` 新增系统行渲染。
- `paths.ts` 新增 `sessionsMainDir/sessionsTasksDir/eventsFile/snapshotFile/auditFile/jobsDir` 并创建目录。

验证：`tsc -p tsconfig.node.json` 与 `-p tsconfig.web.json` 通过；`electron-vite build` 通过；`RALLY_SMOKE=1` 通过（`model` 现在是 `unknown/unknown`，`modelFallbackMessage` 提示未配置 provider）。根 `typecheck` 仍因 `packages/ai/test` 的模型数据旧断言失败（§4 已记）。

已知偏差/待办：

- 提示词暂放 `src/main/prompts.ts`（03 §6 说的“核心包 prompts/”尚不存在）。
- `chat:reset` 的旧“新开会话 + 清屏”已在本轮替换为 compact，见 §0.0。
- 未配置 provider 时，发送只得到一条系统行；M1-C 已补上真实提供商配置（见 §0.4）。
- 本沙箱里 Electron 子进程无法在 `~/.rally` 下新建目录（`EPERM`），验证前需手工建好 `sessions/main`、`sessions/tasks`、`state/jobs`；真实用户运行无此问题。
- 下一阶段 M1-B：TaskStore/调度/派发/批准/worker 汇报/唤醒闭环。

### 0.3 M1-B 进展（2026-11-08 第三段会话）

历史实现记录（曾误报闭环完成；本轮修复及验证以 §0.0/TODO 为准）：

- `src/shared/task.ts`：Task/Run/Input/Attention/Usage 与显示状态推导；`scope: string[]`、`changedFiles`；`QueueReason` 仅 `dependency_failed | dependency | capacity`（无 `write_lock`、无 lock 字段）。
- `src/main/supervisor/task-store.ts`：事件流单写者落任务快照；创建时 scope 与运行中任务交叉只产生 `warnings` 并记 `task_scope_overlap`，不阻止；批准/取消/更新/续接/steer/answer/汇报/运行开始结束/实际改动文件/用量全部落事件。
- `src/main/supervisor/tools.ts`：主 agent 的 `task_dispatch/approve/update/steer/answer/resume/cancel/read`；worker 的 `task_report/task_read`（只能看自己与上游）。
- `src/main/supervisor/worker.ts`：每任务一个 Pi 会话（`sessions/tasks/<taskId>.jsonl`），工具集 read/write/edit/grep/find/ls + bash/powershell，注入 `RALLY_TASK_ID`、`RALLY_OUTPUT_DIR`（这仅是环境提示，构建产物强制隔离尚未落实）；tool 事件收集实际改动文件与用量；轮末未汇报先 nudge、再犯记 blocked；终态释放会话。
- `src/main/supervisor/scheduler.ts`：默认名额 2、依赖阻塞（`dependency`/`dependency_failed`，后者只唤醒一次）、容量排队（`capacity`/`waiting` 事件）、启动恢复后中断的 run 等用户决定（不自动重跑）。
- `src/main/supervisor/relay.ts`：worker 汇报/提问/依赖失败/中断 → 忙时 steer、闲时 2s 合并为一个 turn；notice 不唤醒。
- `src/main/supervisor/index.ts`：总装 Supervisor；启动时把未结束 run 标 interrupted 并唤醒主 agent；`approve/cancel` 宿主接口已接线。本轮批准按钮已移到主对话，右栏只读。
- IPC：`tasks:state/approve/cancel` + `task:event`；preload 暴露 `window.rally.tasks`；renderer 用 `useTasks` 镜像真实任务，工位列表替换 mock，待批准卡片有“批准派发/取消”。
- 文档已按最终口径改完（04 §2 写范围声明＋警告、构建隔离；00 Q2/Q6/Q8/Q9/Q17；01/02/03；改造计划 C10、§5.2、M2），不再保留“git worktree 根加锁”。

验证：

- `tsc -p tsconfig.node.json`、`-p tsconfig.web.json` 通过；`electron-vite build` 通过；`RALLY_SMOKE=1` 通过。
- 真实启动 5 秒无主进程错误。
- 一次性逻辑校验（临时脚本，已删）：scope 交叉恰好 1 条 `task_scope_overlap`；limit=2 时第 3 个任务排队 `capacity` 且记 `waiting`；上游 failed 后下游 `dependency_failed` 且只唤醒一次；任务对象无 lock 字段。

当时的偏差及当前状态（不作为闭环完成证明）：

- 当时只读任务仅有提示词约束；本轮已强制拦截产出目录之外的 write/edit，包括路径穿越与 junction。shell 仍不是文件沙箱，完整访问痕迹待实现。
- `bash/powershell` 的重定向目标未进 `changedFiles`（只收集 write/edit 的 path）；间接改动仍是已知局限。
- 作业（jobs）与服务（services）未实现；`stop{target:"service",source:"user"}` 事件类型已定义，右栏“停止服务”直连尚无服务可停。
- 当时 `autoApprove` 硬编码为 false、worker 沿用默认模型；本轮已接持久审批开关与独立任务模型/思考档位，见 §0.0。
- 无 provider 时主会话与 worker 都只得到未配置提示；M1-B 的真实模型端到端仍未实测。
- 主 agent 系统提示与 worker 提示在 `src/main/prompts.ts`，尚未迁到 03 §6 的核心包 `prompts/`。

### 0.4 M1-C 进展（2026-11-08 第四段会话）

以下是 11-08 的历史范围；本轮已按 Q22 接入任务模型并修复调度，见 §0.0。

已完成：

- `src/shared/models.ts`：Provider/Model/Active/ModelsState/FetchModelsResult 等契约；`THINKING_LEVELS` 与 `defaultModel`。
- `src/main/model-store.ts`：`ModelStore` 读写 `~/.rally/agent/rally-models.json`（明文、`version/active/providers`），把每个供应商用 `ModelRuntime.registerProvider` 注册进 Pi；`api` 映射为 `messages → anthropic-messages`、`responses → openai-responses`，**不自写 HTTP 适配**。
- 模型列表拉取：主进程请求 `<baseUrl>/models`（messages 带 `x-api-key` + `anthropic-version`，responses 带 Bearer），失败/超时/非 2xx 都返回可读文案，不抛异常。
- 模型元数据：上下文长度、压缩阈值、最大输出、视觉、思考、可选思考档位（`thinkingLevelMap`，`off` 始终可用）。压缩阈值目前仅保存与展示，不驱动 Pi 自动压缩（Pi 只有 `contextWindow` 触发压缩）。
- 主会话接入：`MainAgent` 启动时用同一 `ModelRuntime`，按文件里的 `active` 恢复模型与思考档位；新增 `selectModel()`（`session.setModel` + `setThinkingLevel`，持久化），以及保存供应商后的 `reapplyActiveModel()`（改 URL/Key 后无需重新选择即可生效）。
- IPC：`models:state/save/fetch/select`；preload 暴露 `window.rally.models`；`ChatState` 增加 `thinkingLevel/thinkingLevels`。
- 渲染层：`src/renderer/src/models.ts`（模块级共享缓存 + `useModels`）；`forms.tsx` 的 `ProvidersForm` 重写为多供应商卡片（无任何预设模板、拉取/手填、逐模型元数据、显式「保存配置」）；`ModelPicker.tsx` 为分组选择器（浅色供应商名 + 模型，思考模型向右展开强度面板）；设置页删除了旧的「模型」小节，引导页删除了「模型用途」步骤。
- 测试清单：`docs/测试清单-提供商与模型.md`（23 条，★ 为必过项）。

验证：

- `npx tsc --noEmit -p tsconfig.node.json`、`-p tsconfig.web.json` 通过；`npx electron-vite build` 通过。
- 一次性脚本（Temp，已删）在 Pi 层验证通过：供应商注册、模型解析、`session.setModel` 跨供应商切换、`setThinkingLevel`、默认/声明档位（`off,minimal,low,medium,high` / `off,low,high`）、非法 Base URL 报错、拉取失败返回可读文案、active 在模型删除后被清理、配置文件为明文 JSON。
- **未自测**：`RALLY_SMOKE=1`、`npm run dev` 与所有需要点界面的条目——本会话工具环境审批拒绝启动完整 Electron（详见清单 §8）。真实模型回复、错误凭据、真实任务端到端同样需要用户实测。

已知边界（M1-C 范围内）：

- 「压缩阈值」是 Rally 元数据，未接入 Pi 的自动压缩参数。
- 模型列表拉取只覆盖 `/models` 这一常见形态；供应商没有该接口时走手填。
- 供应商配置是显式保存（不是逐字段自动保存）；未保存时页面显示「未保存」。
- 主/任务模型已分别接 Rally 供应商配置。旧“双模型 v1 不做／接线待批准”与 Q22 冲突，已撤回，无此额外批准要求。
- `chat:reset` 已改为上下文压缩，保留 UI 历史与原话引用；更多压缩协议仍待补齐。

### 0.5 交接速查（新会话先看这段）

**已有基础实现（不等于阶段验收）**

| 里程碑 | 实际做了什么 |
| --- | --- |
| M1-A | Rally 角色会话、事件日志、聊天 IPC、真实流式对话、中止/压缩；状态重注入/检索仍未完成 |
| M1-B | 无锁 TaskStore、基本依赖/名额/取消/续接、worker 汇报与 relay、主对话审批；持久中继/幂等/完整轨迹等仍未完成 |
| M1-C | Rally 供应商配置 + Pi 运行时 + 模型列表/手填 + 主/任务模型与思考选择器 + 持久化；真实服务清单未验收 |

**配置文件**

- 路径：`C:\Users\<用户名>\.rally\agent\rally-models.json`（与 Pi 的 `models.json`、`auth.json` 不冲突）。
- 结构：`{ version: 1, active: Selection | null, worker: Selection | null, providers: ProviderEntry[] }`；Selection 含 provider/model/thinkingLevel。旧文件无 worker 时保持未配置，不自动回退。
- 协议值：`messages` / `responses`；写入 Pi 时映射为 `anthropic-messages` / `openai-responses`。

**测试清单**：`docs/测试清单-提供商与模型.md`（★ 为必过项；§8 列出无法自测项）。

**当前必须靠真模型验证的**

- 聊天能真的流式回复、切换模型后下一条消息用新模型、重启后选择保留。
- 错误 Key / 断网时的界面错误提示。
- 真实任务端到端：派发 → 主对话批准 → worker 使用任务模型运行 → 汇报回主对话。本地假 HTTP/UI 已跑通，真供应商仍待验收。

**无需再询问的已定项**

- 主/任务两个全局模型是 Q22 已定，worker 同一供应商配置接线已实施。

**下一步建议顺序（理由）**

1. **先按清单做真模型实测**：M1-C 的价值全在“能配、能选、能跑”，未实测前不要叠加新功能。
2. 实测暴露问题就地修（供应商/选择器/主会话切换相关问题优先）。
3. 按实施 TODO 补 M1 剩余协议，不把压缩按钮已接线等同于整个压缩/恢复完成。
4. 当前收口验收后，再考虑作业/服务及其他未实现能力；任务模型已在本轮接通。

### 0.6 已否决 / 已定不做（不要再提、不要重试）

- **写锁/租约/目录归属/阻塞 `acquire`**：已定不做。并发靠 `scope` 声明 + 交叉警告 + `changedFiles` 事后追踪 + 构建产物独立后缀。
- **按任务临时指定模型**：不做。Q22 采用两个全局设置；派发/续接工具没有 model 参数。
- **任务卡百分比进度**：不做，只显示粗略状态与时间。
- **“汇报必须带原话引用”**：不成立；`task_report` 没有 quotes 参数，宿主也不校验。
- **停止服务经 worker**：已定改为右侧按钮直连，事件写 `stop(source=user)`；改任务内容仍必须走 `task_steer`。
- **内置 OpenAI/Anthropic 等供应商预设模板**：M1-C 明确不做，供应商一律由用户自填。

## 1. 为什么在 D 盘

- `E:` 是 **exFAT**（簇大小 256KB），**不支持 junction 和符号链接**（实测 `EISDIR`）。npm workspaces 在 Windows 上靠 junction 链接 `node_modules/@rally/*` → `packages/*`，在 E: 上装不起来。
- `D:` 是 NTFS（4KB 簇，junction 实测可用），剩余约 76G。
- **`D:\Rally-agent` 是唯一的正本**。`E:\Rally-agent` 是迁移前的副本（其中 `packages/` 是**改名前**的状态），确认 D 盘无误后由用户自行删除；不要再在 E: 上工作或安装依赖。
- 选定方案：**标准 npm workspaces**，Electron 应用就在仓库根目录（不再嵌套一层目录），Pi 源码在 `packages/*`。

## 2. 已完成

### 2.1 文档

| 文件 | 内容 |
| --- | --- |
| `docs/superagent/00-问答记录.md` | 24 题问答原文、派生默认值、未提问默认值 A1–A10；**决策唯一依据** |
| `docs/superagent/01-角色与协议.md` | 角色、领域对象（Task/Run/Input/Attention/Gate）、显示状态推导表、主流程、中继格式、主 agent 上下文、事件清单 |
| `docs/superagent/02-工具规格.md` | 主 agent 22 个工具、任务 agent 22 个工具＋MCP 的参数与返回、门控分档、投影信封、访问痕迹 |
| `docs/superagent/03-提示词.md` | 组装顺序、优先级、英文提示词初稿、消息模板 |
| `docs/superagent/04-工作区与并发.md` | 目录模型、写锁、调度与名额、worker 生命周期、作业/服务、持久化、启动恢复 |
| `docs/superagent/05-界面与交互.md` | 主对话卡片、右栏只读、浏览器/终端、设置页、开源复用选型（许可证已核实） |
| `docs/改造计划.md` | v3 总纲与决策表（C1–C10、D1–D15、里程碑 M0–M5、附录 B 实测清单） |

### 2.2 Pi 源码搬迁（"搬源码改"）

来源：`example/pi`（上游 `earendil-works/pi`，基准 `085c84e`，v1.5.0，MIT）。

| 目录 | 包名（改后） | 上游包名 |
| --- | --- | --- |
| `packages/telemetry` | `@rally/telemetry` | `@earendil-works/pi-telemetry` |
| `packages/schema` | `@rally/schema` | `@earendil-works/pi-schema` |
| `packages/tui` | `@rally/tui` | `@earendil-works/pi-tui` |
| `packages/codemode` | `@rally/codemode` | `@earendil-works/pi-codemode` |
| `packages/mcp` | `@rally/mcp` | `@earendil-works/pi-mcp` |
| `packages/ai` | `@rally/ai` | `@earendil-works/pi-ai` |
| `packages/agent` | `@rally/agent-core` | `@earendil-works/pi-agent-core` |
| `packages/coding-agent` | `@rally/coding-agent` | `@earendil-works/pi-coding-agent` |

- 依赖关系：coding-agent → agent-core、ai、codemode、mcp、tui；agent-core → ai、schema；ai → schema、telemetry。这 8 个包自成闭包；没搬 env/chord/durable/evals/apps。
- 没搬：各包的 `node_modules`、`dist`；coding-agent 的 `docs/`（14M）、`examples/`（34M）、`install-lock/`、`tsconfig.examples.json`（需要参考时看 `example/pi`）。
- 每个包放了一份 Pi 的 `LICENSE`（MIT，Copyright (c) 2025 Mario Zechner）；mcp、schema 自带的 `THIRD_PARTY_NOTICES` 保留。**分发时必须保留这些声明。**
- 根目录带过来的构建支持文件：`tsconfig.base.json`（原样）、`vitest.base.ts`（已精简为这 8 个包、`@rally/*` 别名）、`biome.json`（includes 已改为 Rally 布局）、`scripts/package-files.mjs`、`scripts/biome/model-type-comparison.grit`。
- 这 8 个包都**没有原生 node 插件**依赖（photon、quickjs 是 WASM）；唯一的 `.node` 是 tui 的 Windows 剪贴板预编译件（N-API），只在 TUI 里用。

### 2.3 改名（C4）

- `@earendil-works/pi-*` → `@rally/*`：431 个文件 983 处，外加 3 个 vitest 配置里的正则写法。`CHANGELOG.md` 与 `.jsonl` 测试夹具**未改**（历史记录／会话数据）。
- `packages/coding-agent/package.json` 的 `piConfig` 改为 `{ "name": "rally", "configDir": ".rally" }`。由此 `APP_NAME=rally`、全局目录 `~/.rally/agent`、环境变量 `RALLY_CODING_AGENT_DIR` / `RALLY_CODING_AGENT_SESSION_DIR`、调试日志 `rally-debug.log`（机制见 `src/config.ts:602-611`）。
- **扩展兼容**：`src/core/extensions/virtual-modules.ts` 与 `loader.ts` 的别名表里，除 `@rally/*` 外保留了 `@earendil-works/pi-*` 和 `@mariozechner/*`，Pi 生态的现成扩展仍能加载。

## 3. 下一步（按顺序）

### 3.1 根 `package.json`（草案，版本已于 2026-11-08 核实）

```json
{
	"name": "rally",
	"productName": "Rally",
	"version": "0.1.0",
	"private": true,
	"type": "module",
	"main": "./out/main/index.js",
	"workspaces": ["packages/*"],
	"engines": { "node": ">=22.19.0" },
	"scripts": {
		"dev": "electron-vite dev",
		"build:packages": "npm run build -w @rally/telemetry && npm run build -w @rally/schema && npm run build -w @rally/tui && npm run build -w @rally/codemode && npm run build -w @rally/mcp && npm run build:offline -w @rally/ai && npm run build -w @rally/agent-core && npm run build:unbundled -w @rally/coding-agent",
		"build": "npm run build:packages && electron-vite build",
		"preview": "electron-vite preview",
		"typecheck": "tsc --noEmit -p tsconfig.json",
		"dist": "npm run build && electron-builder --win"
	},
	"dependencies": {
		"@rally/agent-core": "1.5.0",
		"@rally/ai": "1.5.0",
		"@rally/coding-agent": "1.5.0"
	},
	"devDependencies": {
		"@biomejs/biome": "2.3.5",
		"@tailwindcss/vite": "4.3.5",
		"@types/node": "22.19.19",
		"@types/react": "19.3.0",
		"@types/react-dom": "19.3.0",
		"@vitejs/plugin-react": "6.2.1",
		"clsx": "2.1.1",
		"electron": "45.2.3",
		"electron-builder": "26.18.0",
		"electron-vite": "6.0.0",
		"lucide-react": "1.70.0",
		"react": "19.3.1",
		"react-dom": "19.3.1",
		"tailwind-merge": "3.7.0",
		"tailwindcss": "4.3.5",
		"typescript": "7.0.2",
		"vite": "8.3.6",
		"vitest": "4.1.12"
	},
	"overrides": { "protobufjs": "7.6.6" }
}
```

| 版本要点 | 说明 |
| --- | --- |
| electron 45.2.3 | 自带 Node 24.22.2、Chrome 156；满足 Pi 的 `node >=22.19` |
| electron-vite 6.0.0 | 支持 vite `^6 \|\| ^7 \|\| ^8` |
| @vitejs/plugin-react 6.2.1 | 要求 vite `^8` |
| typescript 7.0.2、vitest 4.1.12、@types/node 22.19.19、biome 2.3.5 | 与 Pi 保持一致，避免装两套 |
| 本机 | Node v24.11.1、npm 11.6.2、registry `registry.npmjs.org` |

- coding-agent 用 `build:unbundled`（Pi 的 `build` 还会跑单文件 bundle 脚本，Rally 不需要，那个脚本也没搬）。
- ai 用 `build:offline`，前提是先生成模型数据（3.4）。

### 3.2 其余配置

1. `tsconfig.json`（根，`noEmit`）：参照 `example/pi/tsconfig.json`，`paths` 把 `@rally/*` 指向 `packages/*/src`，删掉 chord/durable/env/agent-old 的条目；`exclude` 加上引用未搬 examples/docs 的 14 个测试文件（§4）。
2. `tsconfig.node.json`（main/preload）、`tsconfig.web.json`（renderer）。
3. `electron.vite.config.ts`：main 输出 ESM 并外部化依赖（`@rally/*` 运行时经 workspace 链接加载各包 `dist`）；preload 输出 CJS（配合 `sandbox: true`）；renderer 用 React＋`@tailwindcss/vite`。**先读 `node_modules/electron-vite` 的类型定义再写配置**（vite 8 改用 rolldown，选项名可能有变化）。
4. `electron-builder.yml`：NSIS、按用户安装、appId（附 A1）。
5. `.gitignore` 补 `out/`、`packages/*/dist`、`packages/ai/src/providers/data/`（若决定不提交模型数据）。

### 3.3 `src/` 骨架

```text
src/
├─ main/        index.ts（单实例锁、窗口 titleBarOverlay）、paths.ts（~/.rally 布局，见 04 §1）、ipc.ts
├─ preload/     index.ts（contextBridge 暴露类型化 API）
├─ shared/      IPC 契约与事件类型
└─ renderer/    index.html、src/main.tsx、App.tsx（双栏壳；视觉 token 取自 example/rally-ai-agent-ui-design/src/index.css）
```

### 3.4 安装、生成、构建、冒烟

1. `npm install --ignore-scripts`（遵循 Pi 的安全约定：不跑依赖的生命周期脚本）。
2. `node node_modules/electron/install.js` 单独下载 Electron 二进制；慢就设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
3. `npm --prefix packages/ai run hydrate-model-data`：**需联网**（models.dev、OpenRouter、Vercel AI Gateway、NVIDIA NIM 等）。Pi 把生成结果 `packages/ai/src/providers/data/` 放进了 gitignore；Rally 要不要提交它以便离线构建，待定。
4. `npm run build:packages`。
5. 冒烟（M0 判据）：主进程里 `createAgentSession({ cwd, agentDir: <~/.rally/agent>, sessionManager: SessionManager.inMemory(), tools: [...] })` 能创建会话、列出工具；确认没有写入 `~/.pi`。建议做成 `RALLY_SMOKE=1` 启动时打印结果后退出，不弹窗。
6. 然后做改造计划附录 B 的实测项（多会话同进程、steer/唤醒 API、`tool_call` 钩子能否异步挂起等）。

## 4. 历史问题与待清理（当前状态以 §0.0 和 TODO 为准）

- **历史 `.pi` 清理记录**：资源与配置路径使用辅助函数和 `CONFIG_DIR_NAME`。`packages/coding-agent/src/cli/startup-ui.ts` 的 `OFFICIAL_CONFIG_DIR_NAME = ".pi"` 是官方发行版判断，故意保留，不能替换。
- **coding-agent 的 package.json**：`bin` 仍是 `"pi": "dist/bundle/cli.js"`，`exports["./rpc-entry"]` 指向未构建的 `dist/bundle/`，`files` 里还有 `docs`/`examples`。workspaces 会给 `pi` 建一个指向不存在文件的 bin 垫片，且与 C4 冲突 → 改成 `rally` 或删除。ai 的 `bin` `pi-ai` 同理。
- **测试**：`packages/coding-agent/test/config.test.ts` 用 `@earendil-works` 模拟 CLI 安装路径（夹具，未改）。14 个测试文件引用了未搬的 `examples/` 或 `docs/`：`changelog`、`compaction-extensions-example`、`extensions-discovery`、`git-merge-and-resolve-extension`、`input-transform-streaming-example`、`jev-router-example`、`plan-mode-extension`、`plan-mode-utils`、`subagent-extension`、`suite/agent-session-mcp`、`suite/regressions/8261-subagent-project-trust`、`system-prompt`、`tool-renderer-examples`、`trigger-compact-extension`（另有 fixtures 里的 jsonl 提到 examples 路径，属数据）。
- **ai 的 devDependency `canvas`** 是原生模块，`--ignore-scripts` 下不会装预编译件，只影响用到它的测试。
- **Pi 的 AGENTS.md 规则对 `packages/` 继续适用**：只用可擦除的 TS 语法；coding-agent 的资源路径一律经 `src/config.ts` 的辅助函数；不要直接跑全量 vitest（e2e 测试检测到密钥环境变量会真调 API），按单个测试文件跑；新依赖保持精确版本。建议在 Rally 根目录建 `AGENTS.md`（或 `CLAUDE.md`）收录这些规则。
- **根 `README.md`**：已按本轮真实现状更新，实施与验收状态链接至 TODO。
- **工具环境的坑**：本会话的 Bash 工具会把命令里的 `\\` 吞成 `\`。写涉及反斜杠的脚本时用 `String.fromCharCode(92)`，或把脚本写进文件再执行。

## 5. 协作偏好（给下一个会话）

- 中文交流。设计决策用问答形式（AskUserQuestion，带推荐项）；用户倾向最小范围、信任 agent（如不设预算上限、worker 说完成就完成、不做回滚）。
- 原型 `example/rally-ai-agent-ui-design` **只作风格参考**，不从原型推导功能。
- 用户希望直接推进、少做确认。已明确："搬源码改"；工程放在仓库根目录，不再嵌套目录。
- 本会话的 Claude Code 记忆目录按路径区分（E: 与 D: 不同），所以交接信息都写在本文里。

## 6. 文件索引

| 路径 | 用途 |
| --- | --- |
| `HANDOFF.md` | 本文 |
| `docs/superagent/00–05` | 设计分册（以 00 为准） |
| `docs/改造计划.md` | 总纲与决策表 |
| `docs/prototype-inventory.md` | 原型盘点（2026-11-07 快照，部分结论已被 v3 取代） |
| `packages/*` | 改名后的 Pi 源码 |
| `example/`（gitignore） | 上游参考：`pi`、`dsh-superagent`、`rally-ai-agent-ui-design` |
