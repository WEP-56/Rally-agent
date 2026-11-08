# Rally 开发规则

用中文交流。设计决策以 `docs/superagent/00-问答记录.md` 为准，分册和改造计划与它冲突时听它的。

## 产品边界

- 界面的样子来自 `example/rally-ai-agent-ui-design`，已搬到 `src/renderer/src`。功能和字段按问答记录定，不从原型反推。
- 用户在意这套设计：改界面时保持原型的视觉风格和 token，不要另起一套。

## 代码

- `packages/` 是 Pi 源码。只用可擦除的 TS 语法（不用 `enum`、`namespace`、参数属性等）。
- `packages/coding-agent` 的资源路径一律经 `src/config.ts` 的辅助函数，不直接用 `__dirname`；配置目录名用 `CONFIG_DIR_NAME`。
- `packages/coding-agent/src/cli/startup-ui.ts` 里的 `OFFICIAL_CONFIG_DIR_NAME = ".pi"` 是故意的：它判断“是否官方 Pi 发行版”，Rally 必须判定为否。
- 不要手改 `packages/ai/src/models.generated.ts`；`packages/ai/src/providers/data/` 是生成物，不入库。
- 少用 `any`，只用顶层 import（不用 `await import()` 和 `import("pkg").Type`）。
- 主进程和渲染进程只通过 `src/shared/ipc.ts` 声明的通道通信。

## 依赖

- 直接依赖固定精确版本。依赖和 lockfile 的改动按代码审查。
- 安装用 `npm install --ignore-scripts`，除非用户要求，不跑生命周期脚本。

## 检查

- 改代码后跑 `npm run typecheck`。已知 `packages/ai/test` 的 `fireworks-models` 和 `anthropic-empty-thinking-signature-compat` 会报错：测试里写死的模型名和最新拉取的模型数据对不上。
- **不要跑全量 vitest**：e2e 测试检测到密钥环境变量会真实调用 API。在包目录下按单个文件跑：`node ../../node_modules/vitest/dist/cli.js --run test/xxx.test.ts`；`packages/tui` 用 `node --test test/xxx.test.ts`。
- `packages/coding-agent/test/suite/` 用 `harness.ts` 加 faux provider，不用真实 API 和密钥。

## Git

- 用户要求时才提交。
- 只 `git add` 明确的路径，不用 `git add -A`。
- 不跑 `git reset --hard`、`git clean -fd`、`git stash`、`git checkout .`，不 force push，不跳过 hook。
