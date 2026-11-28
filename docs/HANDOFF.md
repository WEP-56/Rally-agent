# Rally 开发交接（2026-11-28）

入口：[文档索引](README.md) · [实施清单](开发实施TODO.md) · [连接器约定](Connector/README.md) · [Prompt](Prompt/system-prompt.md) · [发布指南](发布指南.md)。

## 下一阶段

用户已确认本轮工作，要求提交并推送到 GitHub。后续是持续迭代：补充连接器、补充外部 Agent，并根据真实使用体验和 Rally 内 LLM 的反馈优化。尚未指定下一个接入对象或具体缺陷；下一会话以用户带来的需求、日志和反馈为切入点，不预设整套扩展框架。

每次先确认实际任务、运行主机、工具参数与返回结果，复现卡点，再做最小必要改动。尤其检查 LLM 能否只凭系统提示词、工具描述、参数和结果顺畅完成任务；优先改善可理解性、交互连续性和上下文体积，避免堆工具、重复配置及防御性流程。Rally 内的 LLM 没有本开发会话的上下文。

## 本轮已完成

- SSH 已加入「连接」页：支持多服务器、密码或私钥、指纹确认、验证和启停。本地与云端共用配置业务接口；内置 Worker 使用 `ssh_list`、`ssh_exec`、`ssh_write_stdin`，主助手仅查询轻量服务器信息。工具风险档在连接器里管理并实际参与执行校验。保持可选 PTY、增量有界输出和已有作业通知，不扩展终端模拟器、SFTP 或断线自动重放。契约见 [SSH 连接](Connector/SSH连接.md) 和 [工具描述](Prompt/tools-Description/ssh.md)。
- SSH 续读时空 `chars`／空 `credential.id` 按省略处理，纯读取不误走输入校验或审批；有效输入仍按权限执行。用户已验证相关修复。
- Windows 本地浏览器标签关闭不再通过 IPC 返回原生事件对象；关闭后迟到的布局消息被忽略，避免对象无法克隆及 `BROWSER_NOT_FOUND`。用户已验证。
- 外部 Claude Code／Codex Worker 复用任务运行主机已有的 CLI、登录与模型配置。自动发现 PATH、常见用户安装目录、npm 安装，并支持可选 `executablePath`；旧私有 CLI 与高级 `adapterPath` 只保留兼容，不创建第二份程序。
- ACP 连接层由 Rally 构建并随包发布，用户无需补装 adapter、SDK、Node 或 npm。Codex ACP 2.10.0、Claude ACP 0.110.1、Claude JS SDK 0.3.330 的依赖锁位于 `scripts/external-agents/`；只分发 JavaScript 和许可证，约 8.7 MiB，不包含原生 CLI。开发启动及桌面／服务端构建自动准备，应用运行时不安装依赖。
- Windows ACP 资源位于 ASAR 外；SDK 必须保留单独的 `extraResources` 映射，默认复制器会跳过资源根 `node_modules`。Linux 位于服务根目录 `external-agents/`。发布检查和独立目录加载回归已覆盖。实现入口为 `external-worker-runtime.ts`、`external-worker-session.ts` 与 `scripts/prepare-external-agents.mjs`。
- 角色页、自我管理 Skill 和 [Prompt 描述](Prompt/self-management.md) 已同步“内置连接层，复用已有 CLI”。缺 CLI、登录失败和 Rally 内置组件缺失分别处理；内置组件缺失应修复 Rally 安装。自我管理仍只有一个 Skill，按领域读取 `skills/references/`；外部执行器说明见 [参考文档](../skills/references/external-agents.md)。

用户要求删除旧问答记录及相关索引，现行约定保留在根 `AGENTS.md` 和对应功能文档，不再维护集中式对话流水账。

## 验证与边界

- 本轮代码已通过 `npm run typecheck`、桌面构建、服务端构建与 Skill 校验；SSH、浏览器、外部执行器及角色／Skill 使用定向离线回归，不跑全量 Vitest。
- SSH 12 项、浏览器 13 项、外部执行器 21 项、角色／Skill 子集 5 项、发布检查 2 项及独立目录加载检查 1 项通过；Unix 原生 adapter 的 1 项用例在 Windows 跳过。
- 本机内置连接层复用已有 Codex 读到 4 个模型、Claude 读到 6 个模型，均完成选模型、只读模式及关闭。Windows 实际目录包也用包内 Rally 运行时完成模型目录检查，组件共 9,088,793 字节，无原生 CLI。没有发送推理任务，不将目录检查当作完整真实任务验收。
- Linux 服务端构建通过，完整 Linux 打包仍由相应平台 CI 验证。视觉与真实使用继续按项目约定由用户负责。
- 本次按用户要求提交和推送代码，版本保持 `0.5.1`，不打 tag、不发 Release、不部署 VPS。推送 master 不会触发仅监听版本 tag／手动派发的发布流水线。

## 后续保持的约定

- 连接器提供的所有工具在「连接」页对应连接器内展示和设置权限；MCP 页只管理用户配置的 MCP。新增工具同时登记清单、默认风险档和执行校验，维护 [Connector](Connector/README.md) 与 `docs/Prompt/`。
- 外部 Agent 扩展优先复用成熟适配器与宿主已有程序。客户端与云端任务主机的路径、登录相互独立；不桥接 Rally 的 MCP、浏览器或内部工具，不静默改模型或执行器。
- 维持已有 MD3 风格和 token，不从原型反推功能。视觉默认由用户验收，开发侧执行必要的类型检查、构建和定向测试，不为验收调用付费模型。
- 按根 `AGENTS.md` 执行依赖、代码和 Git 约定。提交明确路径，不提交私密配置、依赖、生成物或本地参考仓库；发版／部署另需明确要求。
- Android 使用既有 VPS 配对；没有明确要求时，不切换到本地模拟服务，不清除配对或签名。连接信息及签名只在私有 `.signing/`，不写入文档或日志。

## 本地参考与产物

- `example/codeg` 已克隆，参考提交 `20e5e27749000b899ea72f53fbe5677abfcb5a69`，可继续参考外部 Agent 的进程、协议和模式兼容处理；整个 `example/` 受 Git 忽略，不随代码推送。来源和许可记录在 `THIRD_PARTY_NOTICES/external-agent-sources.txt`。
- `.artifacts/external-agent-package` 是本轮 Windows 临时验证目录；清理曾被自动审批拒绝，暂留且不入库。无需继续重试删除或再次打包，除非后续改动需要验证。
