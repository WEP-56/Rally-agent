## Regarding LLM
Avoid stopping to end the turn while the task is incomplete or if there is an authorized next step you can take, and instead take the next steps within task scope to progress the user's request. If your final response before ending the turn is a suggested next step, a plan, a request to the user for a routine decision, instructions for a task to execute, or similar handoff to the user, take these steps yourself to make progress towards what the user asked for. Make sure that you have authorization to do so, and flag any assumptions or decisions you make to the user.
>
Only stop to clarify with the user if there is significant change in task scope, you are concretely blocked, have a decision that the user needs to resolve, or before irreversible or destructive actions.

Above all, be thorough in producing high-quality, correct code that completely fulfills the user's task. Keep the code easy to read and verify that the user-requested outcome works as they intend. Follow these instructions when coding:
>
(a) Reuse existing logic in the user's repo when you can. You should reuse existing classes, methods, representations, and APIs in the codebase as long as they preserve correctness. Before consolidating or removing code, preserve the behavior its callers rely on unless the task requires changing it.
>
(b) Skip new tests unless requested, required by the repo, or needed to catch a specific regression existing tests would miss.
>
(c) Make sure that code is human readable. Do not use fewer lines, shorter variable names, minified formatting, or dense one-liners as substitutes for simplicity.
>
(d) Avoid unnecessary indirection and abstraction. Helper functions, utility functions, and class abstractions can add cognitive complexity even when they do not add branches.

## for this project

用中文交流，默认情况下用简单易懂的方式（ELI5）与用户沟通，如果用户要求，再深入讲解。设计以用户当前明确要求及现行功能文档为准；开发状态和后续工作见 [HANDOFF](docs/HANDOFF.md)。

### 产品边界

- 界面的样子来自 `example/rally-ai-agent-ui-design`，已搬到 `src/renderer/src`。功能和字段按已确认需求及现行功能文档定，不从原型反推。
- 用户在意这套设计：改界面时保持原型的视觉风格和 token，不要另起一套。
- 连接器提供的所有工具（无论是否通过 MCP 实现）统一在「连接」页对应连接器内展示和设置权限；MCP 页管理用户配置的 MCP 服务。新增连接器工具时同步登记工具清单、默认风险档并接入执行时校验，不能只有界面配置。具体约定见 [Connector](docs/Connector/README.md)。

### 代码

- `packages/` 是 Pi 源码。只用可擦除的 TS 语法（不用 `enum`、`namespace`、参数属性等）。
- `packages/coding-agent` 的资源路径一律经 `src/config.ts` 的辅助函数，不直接用 `__dirname`；配置目录名用 `CONFIG_DIR_NAME`。
- `packages/coding-agent/src/cli/startup-ui.ts` 里的 `OFFICIAL_CONFIG_DIR_NAME = ".pi"` 是故意的：它判断“是否官方 Pi 发行版”，Rally 必须判定为否。
- 不要手改 `packages/ai/src/models.generated.ts`；`packages/ai/src/providers/data/` 是生成物，不入库。
- 少用 `any`，只用顶层 import（不用 `await import()` 和 `import("pkg").Type`）。
- 主进程和渲染进程只通过 `src/shared/ipc.ts` 声明的通道通信。

### 依赖

- 直接依赖固定精确版本。依赖和 lockfile 的改动按代码审查。
- 安装用 `npm install --ignore-scripts`，除非用户要求，不跑生命周期脚本。

### 检查

- 视觉验证默认由用户负责，以提高开发效率；除非用户明确要求，不主动启动截图、浏览器或 Electron 视觉验收。开发侧仍执行类型检查、构建和必要的功能测试，交付时如实标明视觉待用户验收，不以此阻塞开发。
- 改代码后跑 `npm run typecheck`。模型目录更新导致测试失效时，核对测试依赖的模型是否仍存在；通用兼容性遍历当前目录，特定能力分支使用固定上游样本，不手改生成物或用类型断言掩盖错误。
- **不要跑全量 vitest**：e2e 测试检测到密钥环境变量会真实调用 API。在包目录下按单个文件跑：`node ../../node_modules/vitest/dist/cli.js --run test/xxx.test.ts`；`packages/tui` 用 `node --test test/xxx.test.ts`。
- `packages/coding-agent/test/suite/` 用 `harness.ts` 加 faux provider，不用真实 API 和密钥。

### Git

- 用户要求时才提交。
- 只 `git add` 明确的路径，不用 `git add -A`。
- 不跑 `git reset --hard`、`git clean -fd`、`git stash`、`git checkout .`，不 force push，不跳过 hook。

### 文档维护

- [文档索引](docs/README.md) 按用途链接当前文档；迁移或删除文档时同步更新引用。
- [Connector](docs/Connector/README.md) 记录外部应用接入方式；新增或改动连接器时同步更新。
- `docs/Prompt/` 按“源码路径、提示词原文、参数”记录提示词；提示词变化时同步更新。
- 设计、实施、调研文档直接放在 `docs/`，不另建子目录；相关工作完整实现、用户确认验收后删除。
- 新会话先读 [HANDOFF](docs/HANDOFF.md)。用户提到上下文太长、要开启新会话或更新 handoff 时，删除过时描述，写明下个会话的任务；任务不明确时询问用户。

### 一个重要的提醒
开发 AI Agent 应用时，请站在实际使用工具的 LLM 角度设计：假如你离开当前的 Codex / Claude 环境，进入这个 Agent，仅凭它提供的提示词、工具描述、参数和返回结果，还能理解怎么做、顺手地完成任务吗？以此检查所有 LLM 会接触的工具，优先让它们简单、好用、少占上下文。

不要假定Rally内的agent了解你所知道的。尤其是对修改或新增系统提示词、工具描述、skills时。
否则这会让Rally非常困惑，因为它确实没有你的上下文！
