# 交接文档（2026-11-08 · E: 会话 → D: 会话）

> 下一个会话先读本文，再读 `docs/superagent/00-问答记录.md`。本文是临时交接用，地基完成后可删除。

## 0. 现状一句话

（2026-11-08 D: 会话更新）Electron 工程已建好，依赖、8 个包、应用都构建通过；M0 冒烟通过（`~/.rally/agent`、无 `~/.pi` 写入）。界面已换成原型，用户确认与原型无差异，但**还没接后端**。下一步见 §0.1。下文 §3、§4 是更早的记录，已完成的项以 §0.1 为准。

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
| 配置存 localStorage | 主进程持久化；模型与供应商走 `models.json`/`auth.json` | Q22 |

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

## 4. 已知问题与待清理

- **硬编码的 `.pi`**：`packages/coding-agent/src/cli/startup-ui.ts:36` 的 `OFFICIAL_CONFIG_DIR_NAME = ".pi"`；帮助文案与注释（`cli/auth-command.ts:48`、`extensions/mcp/index.ts:806,1020`、`extensions/mcp/cli.ts:567`、`extensions/mcp/config.ts:5`、`core/package-manager.ts`、`core/session-manager.ts`、`core/sdk.ts:51`、`migrations.ts:76`）。应改为引用 `CONFIG_DIR_NAME`。
- **coding-agent 的 package.json**：`bin` 仍是 `"pi": "dist/bundle/cli.js"`，`exports["./rpc-entry"]` 指向未构建的 `dist/bundle/`，`files` 里还有 `docs`/`examples`。workspaces 会给 `pi` 建一个指向不存在文件的 bin 垫片，且与 C4 冲突 → 改成 `rally` 或删除。ai 的 `bin` `pi-ai` 同理。
- **测试**：`packages/coding-agent/test/config.test.ts` 用 `@earendil-works` 模拟 CLI 安装路径（夹具，未改）。14 个测试文件引用了未搬的 `examples/` 或 `docs/`：`changelog`、`compaction-extensions-example`、`extensions-discovery`、`git-merge-and-resolve-extension`、`input-transform-streaming-example`、`jev-router-example`、`plan-mode-extension`、`plan-mode-utils`、`subagent-extension`、`suite/agent-session-mcp`、`suite/regressions/8261-subagent-project-trust`、`system-prompt`、`tool-renderer-examples`、`trigger-compact-extension`（另有 fixtures 里的 jsonl 提到 examples 路径，属数据）。
- **ai 的 devDependency `canvas`** 是原生模块，`--ignore-scripts` 下不会装预编译件，只影响用到它的测试。
- **Pi 的 AGENTS.md 规则对 `packages/` 继续适用**：只用可擦除的 TS 语法；coding-agent 的资源路径一律经 `src/config.ts` 的辅助函数；不要直接跑全量 vitest（e2e 测试检测到密钥环境变量会真调 API），按单个测试文件跑；新依赖保持精确版本。建议在 Rally 根目录建 `AGENTS.md`（或 `CLAUDE.md`）收录这些规则。
- **根 `README.md` 已过时**（目录结构、`E:\` 路径、"未开工"），需要按现状重写。
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
