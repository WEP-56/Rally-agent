# Rally

一个基于 [Pi](https://github.com/earendil-works/pi) 的开源 AI Agent 工作台。Windows 可以在本机执行任务，也可以连接自己的 Linux 服务器；Android 连接同一服务器，查看对话、审批任务和收取产物。

在主对话里描述目标，主 Agent 负责沟通和分派，任务 Agent 在各自工作目录里执行。任务过程、文件、问题和结果都在同一工作台里呈现。

## 能做什么

- **多任务协作**：独立任务并行，相关任务按依赖执行；可以追加要求、回答问题、停止和续接。
- **自己的模型**：支持兼容 OpenAI Responses、Anthropic Messages 的服务，主 Agent 与任务 Agent 可分别选择模型和思考档位。
- **文件与多媒体**：粘贴、拖拽或选择附件；图片传入支持视觉的模型；Agent 可以读取目录图片、发布生成文件。附件可在新标签预览并保存到电脑或手机。
- **扩展与连接**：配置 MCP、Skills，连接飞书、QQ 机器人和 QQ 邮箱；不可逆操作使用审批卡确认。具体边界见各连接指南。
- **持续工作**：对话历史、长期记忆、任务归档和定时任务；本地模式提供终端、浏览器、服务预览和系统通知。
- **多端同步**：云端会话与任务在 Windows、Android 间共享，设备分别配对并可独立吊销。

例如：

> 分析 D:\projects\demo，修复失败的测试，再发布修改说明供我下载。

> 看一下这张截图，在项目里实现相同的页面布局。

> 每天上午九点整理工作目录中的新资料，完成后汇报。

## 选择运行方式

| | Windows 本地 | Windows 云端 | Android 云端 |
| --- | --- | --- | --- |
| Agent、命令与文件在哪 | 当前电脑 | 自己的 Linux 服务器 | 自己的 Linux 服务器 |
| 对话、任务、模型配置 | 当前电脑的数据 | 同一服务器共享 | 同一服务器共享 |
| 附件上传、预览、下载 | 支持 | 支持 | 支持 |
| 终端、内嵌浏览器、私有服务预览 | 支持 | 暂不提供客户端入口 | 暂不提供客户端入口 |
| 系统通知与托盘 | 支持 | 托盘；暂不提供系统通知 | 系统返回与文件选择/保存 |

本地与各服务器使用独立连接档案，切换模式不迁移历史。云端关闭客户端后服务器继续工作；本地选择退出会停止本机 Agent、作业和服务。Windows **设置 → 桌面行为**可选择关闭时退出或收起至托盘，默认退出。

当前源码还支持 Windows 安装版在此页设置**开机自启**，并补齐运行窗口的任务栏图标。两项改动将在下一次版本发布中提供，现有 `v0.1.0` 安装包尚未包含。

## 安装包与首次使用

下载入口为 [GitHub Releases](https://github.com/WEP-56/Rally-agent/releases)。

| 文件 | 用途 |
| --- | --- |
| `Rally-X.Y.Z-setup.exe` | Windows x64 安装器 |
| `Rally-X.Y.Z-android-arm64-v8a.apk` | 大多数现代 Android 手机 |
| `Rally-X.Y.Z-android-armeabi-v7a.apk` | 仅支持 32 位 ARM 的设备 |
| `Rally-X.Y.Z-android-x86_64.apk` | x86_64 设备/模拟器 |
| `rally-server-X.Y.Z-linux-x64.tar.gz` | Linux x64 VPS 服务端，包含 Node 与运行依赖 |

Android 最低系统为 Android 8（API 26），内置 GeckoView。只安装符合设备 ABI 的一个 APK；可用 `adb shell getprop ro.product.cpu.abilist` 查看设备支持列表。带 `-debug` 的包用于本地测试，不能作为正式签名包覆盖安装的保证；正式升级必须沿用同一签名。Windows 当前未配置代码签名证书。

Windows 下载后可核对：

```powershell
Get-FileHash .\Rally-X.Y.Z-setup.exe -Algorithm SHA256
```

本地模式的首次设置：

1. 选择“本地运行”，完成身份、供应商与工作区引导。
2. 填写模型服务协议、Base URL、API Key，选择主 Agent 和任务 Agent 模型。
3. 发出需求；派发需要批准时，确认任务卡后开始执行。

云端先按 [VPS 部署与升级指南](deploy/linux/README.md) 安装服务器，再在部署控制台给每台设备生成一次性接入密钥。Windows 选择“连接云端”，Android 填写相同服务器 URL 与各自密钥。提供商、模型、MCP 和工作目录在连接后的客户端配置；其中的路径指向服务器。

附件使用方式与格式范围见 [附件使用与验收](docs/附件使用与验收.md)。图片识别取决于所选模型；音频和视频目前作为文件交换、预览、下载，通用模型接口尚未提供直接音视频理解。图片、音频或视频生成需通过相应工具、MCP 或脚本接入。

## 扩展能力

在 **设置 → MCP 服务器**添加或编辑单个服务器，支持 stdio、HTTP 和工具搜索披露。任务 Agent 执行 MCP 工具，主 Agent 获取能力摘要。在 **设置 → Skills** 导入技能目录；项目级配置受信任设置控制。GitHub 操作需在 Agent 运行的电脑或服务器上安装并登录 `gh`。

- [飞书配置](docs/飞书连接.md)
- [QQ 机器人](docs/QQ机器人连接.md)
- [QQ 邮箱](docs/QQ邮箱连接.md)

连接器功能和附件协议各有范围：QQ/飞书消息连接不自动支持全部媒体转发；QQ 邮箱保存到执行目录的附件可由 Agent 发布到工作台。

## 数据与备份

本地业务数据在 `~/.rally/`，默认工作区为 `~/rally`。资源库位于 `~/.rally/resources/`，消息仅保存稳定引用；备份应同时包含资源、事件、任务、会话和配置。新建主会话、归档任务不删除附件；任务彻底删除仅释放它独有的引用，未发送上传和无引用资源在宽限期后清理。

Windows 模式档案、加密的设备令牌与桌面行为设置保存在 Electron 用户数据目录。云端业务数据、设备数据与密钥需要作为一套备份，具体路径和恢复步骤见部署指南。不要把配置或备份上传到公开仓库。

Rally 会执行命令并修改工作目录，当前没有命令级沙箱。模型请求发送到配置的服务，MCP、连接器和网络工具会访问相应服务。云端提供商配置加密保存且不回传明文；本地提供商配置仍由 Pi 管理。云端系统通知、客户端终端与浏览器、桌面自动更新尚未提供，macOS/Linux 桌面未验证。

## 从源码开发

准备 Git、Node.js 22.19+ 和 npm。发布构建固定使用 Node 24.11.1；Windows 将仓库放在 NTFS 分区以便 npm workspaces 创建链接。

```powershell
git clone https://github.com/WEP-56/Rally-agent.git
cd Rally-agent
npm install --ignore-scripts
node node_modules/electron/install.js
npm run hydrate:model-data
npm run build:packages
npm run dev
```

首次准备需要联网下载依赖、Electron 和模型数据；后续通常运行 `npm run dev`，修改 `packages/` 后重新构建 packages。

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 构建 packages、图标和桌面应用 |
| `npm run dist` | Windows NSIS 安装包 |
| `npm run build:server` | 无 Electron 的云端运行时 |
| `npm run dist:android` | 三个 ABI 的正式签名 APK，需签名环境变量 |
| `node scripts/cloud/build-android.mjs --debug` | 使用已有 renderer 构建三种 ABI 调试包 |
| `npm run typecheck` | 根与应用类型检查 |

Android 环境、正式签名、GitHub tag 工作流、产物校验和发版步骤见 [发布指南](docs/发布指南.md)。开发检查方法见 [AGENTS.md](AGENTS.md)；禁止全量 Vitest，以免检测到密钥后调用真实供应商。根类型检查当前仍有两个已知模型数据测试文件错误，node/web 检查单独执行。

欢迎在 [Issues](https://github.com/WEP-56/Rally-agent/issues) 提供复现步骤、系统版本与脱敏日志。实施状态见 [TODO](docs/开发实施TODO.md)，产品设计以 [问答记录](docs/superagent/00-问答记录.md) 为准。

## 致谢与许可

基于 Mario Zechner 及贡献者维护的 Pi 二次开发，项目采用 [MIT License](LICENSE)。上游包和 [第三方声明](THIRD_PARTY_NOTICES) 保留各自许可；GeckoView 的 MPL 2.0 许可与对应源码获取方式随 Android 安装包分发。
