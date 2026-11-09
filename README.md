# Rally

基于 Pi 二次开发的 Windows 桌面 AI Agent（Electron + React）。一个主 agent 负责对话和派发，多个任务 agent 在工位上并行干活。

## 当前阶段

2026-11-09：主会话、模型配置与基本任务链路已收口，用户确认真实供应商双协议及现有能力完整测试通过；继续补齐后续协议。实施与验收状态统一维护在 [开发实施 TODO](docs/开发实施TODO.md)，设计以 [问答记录](docs/superagent/00-问答记录.md) 为准。

- 对话和任务已接主进程、Pi SDK 与持久事件日志；Rally 主/worker 角色提示词已显式加载，主会话声明只读工具和 8 个任务工具。
- 设置 → 供应商分别选择主 agent 与任务 agent 模型、思考档位，配置保存在 `~/.rally/agent/rally-models.json`；worker 启动与续接使用当前任务模型。
- 全局“需要批准／自动批准”持久化；待批准卡在主对话，右栏只读。基本派发、依赖/名额、取消、续接、worker 汇报与主会话唤醒有离线集成回归。
- “整理上下文”执行压缩，保留界面历史和原话 ID。跨段检索、压缩后状态重注入等仍未完成。
- Electron + 本地假模型的派发到汇报链路已验证；用户已完成真实供应商 Messages/Responses 与现有能力验收，见 [测试清单](docs/测试清单-提供商与模型.md)。作业/服务、内门、MCP/skills、完整访问痕迹、用户终端等仍待实现。

## 开发

需要 Node >= 22.19，且仓库必须放在 NTFS 分区（npm workspaces 在 Windows 上依赖 junction，exFAT 不支持）。

```bash
npm install --ignore-scripts              # 不跑依赖的生命周期脚本
node node_modules/electron/install.js     # 单独下载 Electron 二进制
npm run hydrate:model-data                # 生成模型数据（需联网）
npm run build:packages                    # 构建 packages/*
npm run dev                               # 启动应用
```

其它命令：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 构建 packages 和应用 |
| `npm run typecheck` | 类型检查（packages、main/preload、renderer） |
| `npm run dist` | 打包 NSIS 安装包（尚未实测） |

冒烟检查：先 `npx electron-vite build`，再设置环境变量 `RALLY_SMOKE=1` 运行 Electron。它会打印 JSON 结果后退出，不弹窗。

## 目录

```text
src/main/       主进程：模型配置、Supervisor、窗口、IPC、~/.rally 路径
src/preload/    contextBridge 暴露 window.rally
src/shared/     IPC 契约
src/renderer/   界面（来自 example/rally-ai-agent-ui-design）
packages/       Pi 源码，已改名为 @rally/*
docs/           设计文档，docs/superagent/00-问答记录.md 是决策依据
example/        上游参考（不入库）
```

离线任务回归（不调用真实 API）：

```powershell
cd packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/rally-supervisor.test.ts
```

不要跑全量 vitest。根类型检查目前受两个已知模型数据测试报错影响；应用 main/preload、renderer 的独立类型检查与完整构建已通过，详见实施 TODO 的验证记录。

## 许可

`packages/*` 来自 [Pi](https://github.com/earendil-works/pi)（基准 `085c84e`，v1.5.0，MIT，Copyright (c) 2025 Mario Zechner）。各包内的 `LICENSE` 和 `THIRD_PARTY_NOTICES` 在分发时必须保留。
