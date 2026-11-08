# Rally

基于 Pi 二次开发的 Windows 桌面 AI Agent（Electron + React）。一个主 agent 负责对话和派发，多个任务 agent 在工位上并行干活。

## 当前阶段

M0（地基）：

- Electron 工程、8 个 `@rally/*` 包的构建已跑通。
- 主进程能创建 Pi 会话，配置全部落在 `~/.rally/agent`，不碰 `~/.pi`。
- 界面已换成设计原型，但**还没接后端**：对话和任务都是 `src/renderer/src/data.ts` 里的演示数据，发消息走的是模拟流程。

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
src/main/       主进程：窗口、IPC、~/.rally 路径、冒烟检查
src/preload/    contextBridge 暴露 window.rally
src/shared/     IPC 契约
src/renderer/   界面（来自 example/rally-ai-agent-ui-design）
packages/       Pi 源码，已改名为 @rally/*
docs/           设计文档，docs/superagent/00-问答记录.md 是决策依据
example/        上游参考（不入库）
```

## 许可

`packages/*` 来自 [Pi](https://github.com/earendil-works/pi)（基准 `085c84e`，v1.5.0，MIT，Copyright (c) 2025 Mario Zechner）。各包内的 `LICENSE` 和 `THIRD_PARTY_NOTICES` 在分发时必须保留。
