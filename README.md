# Rally

一个面向 Windows 的开源桌面 AI Agent，基于 [Pi](https://github.com/earendil-works/pi) 构建。

你在主对话里描述目标，Rally 负责拆解任务、分派给任务 agent，并汇总结果。右侧工位展示各任务的执行过程，同一个窗口里可以查看网页预览、使用终端、继续跟进已有任务。

## 能做什么

- **多任务协作**：主 agent 负责沟通与调度，任务 agent 在各自的工作目录里执行。可以并行处理独立任务，也可以按依赖顺序推进。
- **自行选择模型**：支持兼容 OpenAI Responses 和 Anthropic Messages 协议的服务，主 agent 与任务 agent 可以使用不同的模型和思考档位。
- **MCP 与 Skills**：添加多个 MCP 服务器、导入技能目录，按需扩展任务能力。MCP 支持搜索披露，让 agent 先查找所需工具，再加载和调用。
- **看得见的执行过程**：查看任务状态、工具调用、思考内容和问题答复；为已有任务追加要求，或归档已结束的任务。
- **持续的对话与记忆**：对话和任务记录保存在本地，支持整理上下文、恢复历史显示，以及管理可编辑的长期记忆。
- **桌面工作台**：内置网页预览、终端和本地服务列表，任务完成或需要处理时可通过系统通知提醒。
- **任务审批**：可选择逐次批准或自动批准派发；不可逆操作仍按授权与确认流程处理。

例如，你可以这样开始：

> 分析 D:\projects\demo 的代码结构，整理一份中文说明。

> 在这个项目里运行测试，修复失败用例，并告诉我改了什么。

> 为这个页面补上移动端布局，完成后启动本地服务供我预览。

## 从源码启动

当前以 Windows x64 为主要运行环境，尚未发布预编译安装包。

准备好 **Git、Node.js 22.19 或更新版本（含 npm）**，以及一个支持上述协议的模型服务账号。Windows 下请将仓库放在 **NTFS 分区**，npm workspaces 需要创建目录链接。

在 PowerShell 中执行：

```powershell
git clone https://github.com/WEP-56/Rally-agent.git
cd Rally-agent

npm install --ignore-scripts
node node_modules/electron/install.js
npm run hydrate:model-data
npm run build:packages
npm run dev
```

首次准备需要联网下载依赖、Electron 和模型数据。后续启动可直接运行 `npm run dev`；更新 `packages/` 源码后，需要重新执行 `npm run build:packages`。

## 首次使用

1. 在引导页或 **设置 → 供应商** 中添加服务，填写协议、Base URL、API Key，并拉取或手动添加模型，然后保存。
2. 分别选择 **主 agent 模型** 和 **任务 agent 模型**，两者可以相同。主模型也可以在对话框底部切换。
3. 在 **设置 → 项目与工作区** 中设置默认工作区。处理已有项目时，在对话中明确告诉 Rally 项目路径。
4. 发送任务需求。如果启用了“需要批准”，确认派发卡片后任务才会开始执行。

执行过程中，可以继续在主对话里补充要求、回答问题或要求停止某个任务。主对话的停止按钮只中断主 agent 当前回复；停止具体任务时，请在对话中说明任务名称或 ID。

任务结束后，可以继续补充要求让 Rally 续接，也可以在工位列表或任务页归档，在“已归档”中恢复。

## 扩展能力

**MCP**：在 **设置 → MCP** 中点击“添加服务器”，填写名称和单个服务器的 JSON 配置；已有服务器可以逐项编辑。支持 stdio 与 HTTP，具体启动参数按对应 MCP 服务的说明填写。

“搜索披露”适合工具较多的服务。主 agent 获得简短的能力摘要，由任务 agent 实际使用 MCP。配置变更用于之后启动或续接的任务。

**Skills**：在 **设置 → Skills** 中导入技能目录并管理启用状态。主 agent 根据名称与摘要分派工作，任务 agent 按需读取和使用技能；项目内的技能与 MCP 配置受项目信任设置控制。

**GitHub**：使用 issue、PR 相关能力前，需要在本机安装 GitHub CLI（`gh`）并完成登录。

内置浏览器用于查看网页和预览本地服务。浏览器自动化等额外能力可以通过 MCP 扩展。

## 数据与当前限制

Rally 默认将配置、会话和任务记录保存在用户目录的 `~/.rally/` 下，默认工作区为 `~/rally`。记忆文件可在设置中查看和编辑。供应商 API Key 等配置目前以明文保存在本地，请勿公开该目录。

应用在本地运行，模型请求会发送到你配置的供应商，MCP 和网络工具会访问相应服务。任务能够执行本地命令和修改文件，当前没有命令级沙箱。

项目仍处于早期阶段，macOS 和 Linux 尚未验证；内置网页搜索、定时任务和自动更新尚未提供。具体进展见 [开发实施 TODO](docs/开发实施TODO.md)。

## 开发与反馈

Rally 使用 Electron、React 和 TypeScript，`packages/` 中包含基于 Pi 修改的 agent 运行时。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发环境 |
| `npm run build` | 构建全部 packages 和桌面应用 |
| `npm run preview` | 运行已构建的应用 |
| `npm run dist` | 构建 Windows NSIS 安装包，输出到 `release/` |
| `npm run typecheck` | 执行类型检查 |

开发约定、定向测试方法和已知检查问题见 [AGENTS.md](AGENTS.md)。设计背景见 [设计记录](docs/superagent/00-问答记录.md)，功能检查项见 [测试清单](docs/测试清单-提供商与模型.md)。

欢迎通过 [Issues](https://github.com/WEP-56/Rally-agent/issues) 报告问题或提出建议，也欢迎提交 Pull Request。报告问题时请附上系统环境、复现步骤和相关报错，隐去 API Key 等敏感信息。

## 致谢与许可

Rally 基于 [Pi](https://github.com/earendil-works/pi) 二次开发，感谢 Mario Zechner 及上游贡献者。

项目采用 [MIT License](LICENSE)。Pi 各包的许可证及 [第三方版权声明](THIRD_PARTY_NOTICES) 保留各自的版权归属。
