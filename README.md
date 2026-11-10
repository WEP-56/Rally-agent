# Rally

基于 Pi 二次开发的 Windows 桌面 AI Agent（Electron + React）。一个主 agent 负责对话和派发，多个任务 agent 在工位上并行干活。

## 当前阶段

2026-11-09：主会话、模型配置与基本任务链路已收口，用户确认真实供应商双协议及现有能力完整测试通过；继续补齐后续协议。实施与验收状态统一维护在 [开发实施 TODO](docs/开发实施TODO.md)，设计以 [问答记录](docs/superagent/00-问答记录.md) 为准。

- 对话和任务已接主进程、Pi SDK 与持久事件日志；Rally 主/worker 角色提示词已显式加载，主会话声明只读工具和 8 个任务工具。
- 设置 → 供应商分别选择主 agent 与任务 agent 模型、思考档位，配置保存在 `~/.rally/agent/rally-models.json`；worker 启动与续接使用当前任务模型。
- 全局“需要批准／自动批准”持久化；待批准卡在主对话，右栏只读。基本派发、依赖/名额、取消、续接、worker 汇报与主会话唤醒有离线集成回归。
- “整理上下文”执行压缩，保留界面历史和原话 ID。跨段检索、压缩后状态重注入等仍未完成。
- 设置 → 记忆使用一个可直接编辑的 MEMORY.md，支持更改路径、真实大小/预算提示与打开编辑。主会话每次调用动态读取，仅在用户明确要求时引用原话追加/删除；worker 不自动读取。预算约 2k tokens，超限需用户精简。
- 设置 → 项目与工作区仅配置主对话默认工作区，最近任务项目只读展示，配置保存于 `~/.rally/workspace.json`；主会话 cwd 固定，相对读取按默认工作区解析，worker 的绝对 cwd 由 router 明确指定。顶部栏保留拖拽区域。
- 已接入 task_read 六种视图与分页、派发 60 秒幂等、20 条结束任务窗口及 scope 交叉提醒；主/worker 的真实工具调用可折叠查看并随重启恢复。完整访问痕迹与费用投影仍待实现。
- worker 问题支持逐字卡片、选项直达、主对话原话代答、自动上升及重复问题去重；答复/失效历史持久保留。内门已接 MCP、受控删除与 worker git 分档。
- 主会话中继持久保存、按 relayId 去重与恢复，报告按顺序合并/steer；通知重启后仍不主动唤醒。新机制启用前的旧中继缺少载荷与确认信息，不追溯补发。
- worker 的 write/edit/file_delete 已接读后被改检测：成功 read 记录整文件 mtime/哈希，外部改写后返回 STALE_FILE 要求重读；基准随任务会话保存，重启续接仍有效。
- file_delete 默认预览数量/字节/未提交改动/目录外目标；实删冻结完整清单并走内门（产出与可确认的新建文件除外），批准后重验，逐项记录实际删除。链接不跟随目标，失败保留未执行项；确认卡展示删除风险。
- 主会话 git_inspect 支持只读 status/log/diff/show/branch；cwd 随默认工作区，branch 固定列出，禁止写文件及修改参数。worker git 按子命令和配置识别可逆、external、不可逆档；不可逆动作走内门，普通 push 审计并提示，访问记录标注仓库命令范围。长输出有完整日志，取消清理本次 Git 进程树。
- Electron + 本地假模型的派发到汇报链路已验证；用户已完成该基线的真实供应商 Messages/Responses 与现有能力验收，见 [测试清单](docs/测试清单-提供商与模型.md)。后续已接入 Skills/项目信任、worker MCP、逐工具风险档、内门、受控删除与 Git 分档；新能力以离线回归验证，真实供应商与视觉待用户验收。作业/服务、HTTP/OAuth 验证、完整访问痕迹、用户终端等仍待推进。

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
