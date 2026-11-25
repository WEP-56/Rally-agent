
# Rally 外部 Agent 执行器

Rally 外部执行器是 Role Worker 的 ACP backend，不是拥有 Rally 内部工具的普通 Worker。先读取用户引用和当前 Rally 主机状态；桌面 Rally 与 Linux 服务主机上的文件、登录和 CLI 环境相互独立。不要用当前聊天所在设备的 `PATH` 或登录状态替代目标 Rally 主机结果。

## Rally 角色绑定配置

- Role Worker 配置：`$RALLY_CODING_AGENT_DIR/rally-role-workers.json`，详见本 Skill 的 `references/roles.md`。
- 对应角色使用 `executor: "claude-code"` 或 `"codex"`，并保存必填 `externalModel`。切为外部执行器时必须移除 Rally 专用 `model`；重新读 ACP 会话返回的 `category=model` 目录，模型选择器保存的 ID 必须与返回 `value` 完全一致，不使用 Rally 文本模型目录或猜测模型名。
- 模型目录探测会在目标主机启动对应 ACP adapter，创建只读、临时会话后关闭；它不是模型推理测试。无可用模型时不能绑定，也不能静默回退到其它 executor/model。

## 目标主机上的来源和配置

Rally 随应用固定版本携带 Claude/Codex ACP adapter，不要通过临时 `npx` 或不明脚本另外下载代码。运行时复用当前 Rally Worker 所在主机的环境与本机登录：

- Claude Code：检查目标进程的 `CLAUDE_CONFIG_DIR`（未设置时默认目标服务账号 `~/.claude`）下 `settings.json`，以及当前进程中 provider/model 相关环境变量。Rally 只读取模型相关字段/允许列表，不导入 hooks、MCP、项目设置、权限或工具。设置中的 `model`、`availableModels`、`modelOverrides`、`modelPicker` 可参与呈现模型目录；不得把其他设置原样复制进 Role 配置。不能回显凭据环境变量。
- Codex：沿用目标进程现有 `CODEX_HOME`、认证和模型/provider 配置（Codex 自己未设置 `CODEX_HOME` 时才按其默认用户目录发现）。Rally 不建第二份认证目录、不写 Rally API Key，也不复用此处模型作为 Claude 模型。只有 ACP `auth/status` 已认证且 adapter 返回模型时才报告“可派发”。
- 当前 Rally 版本以随包 ACP adapter / 它使用的本机配置为准；CLI 或 adapter 缺失、登录态不明、目录为空时停止并报告，不能在 Worker 所在机器替目标主机补装或登录。

## 执行边界和验证

Rally 明确禁用 Claude 的 Bash、Skill、Agent/Task 等工具与 hooks/settings 来源；Codex 会通过 `CODEX_CONFIG` 关闭 delegation、hooks 及 plugin hooks，并按任务模式设置 `read-only` 或 `workspace-write` sandbox。ACP 权限提升请求由 Rally 拒绝。外部 Agent 不接入 Rally MCP、浏览器或内部工具，也不等同于原生 Rally Worker 的工具审批；仍需遵守当前版本实现的工作目录、权限和任务范围，不得宣称主机级隔离。

保存角色后复查 executor/model 与目标 adapter 目录。若用户要求验证，只用用户授权的无副作用任务；不要发真实模型请求或创建/修改文件，除非明确授权。报告区分：adapter 可启动、登录状态、模型目录、角色配置保存、真实任务运行；这些不是同一项验证。
