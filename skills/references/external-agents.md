
# Rally 外部 Agent 执行器

Rally 外部执行器是 Role Worker 的 ACP backend，不是拥有 Rally 内部工具的普通 Worker。先读取用户引用和当前 Rally 主机状态；桌面 Rally 与 Linux 服务主机上的文件、登录和 CLI 环境相互独立。不要用当前聊天所在设备的 `PATH` 或登录状态替代目标 Rally 主机结果。

## Rally 角色绑定配置

- Role Worker 配置：`$RALLY_CODING_AGENT_DIR/rally-role-workers.json`，详见本 Skill 的 `references/roles.md`。
- 对应角色使用 `executor: "claude-code"` 或 `"codex"`，并保存必填 `externalModel`。切为外部执行器时必须移除 Rally 专用 `model`；重新读 ACP 会话返回的 `category=model` 目录，模型选择器保存的 ID 必须与返回 `value` 完全一致，不使用 Rally 文本模型目录或猜测模型名。
- 模型目录探测会在目标主机启动对应 ACP adapter，创建只读、临时会话后关闭；它不是模型推理测试。无可用模型时不能绑定，也不能静默回退到其它 executor/model。

## 连接目标主机已有程序

Rally 已内置 ACP 连接层，负责把会话接到 Claude Code / Codex。用户只需在任务运行主机安装并登录相应 CLI；不需要安装 adapter、SDK、Node 或 npm，也不需要把现有程序复制到 Rally 目录。打开设置和刷新模型只检测，不下载安装。

先按总索引确认目标主机、运行账号和 `RALLY_CODING_AGENT_DIR`。本地模式使用这台电脑，云端模式使用服务器；程序和登录状态必须属于实际运行任务的账号。

### 路径与字段

可选配置文件为 `$RALLY_CODING_AGENT_DIR/external-agents.json`。通常无需创建；程序在非标准目录或 Rally 的 PATH 未更新时，只填写实际 CLI 路径：

```json
{
  "claude-code": {
    "executablePath": "C:/Users/实际账号/.local/bin/claude.exe"
  },
  "codex": {
    "executablePath": "/实际工具目录/codex"
  }
}
```

这是字段示例，不可原样复制。只写目标主机实际存在的路径，保留其它执行器配置。每次启动会话都重读，无需重启；已运行的会话继续使用原程序。

- 顶层键为 `claude-code` 或 `codex`，不是角色 ID，每个值是对象。
- `executablePath`：已有 CLI 文件的绝对路径，不接受参数或相对路径。优先于目标 Rally 进程的 `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`。省略时搜索进程 `PATH`、该账号 `~/.local/bin`、Windows `%APPDATA%/npm`（未设置 APPDATA 时使用该账号的默认目录）及已配置的 npm prefix，再兼容旧 Rally `bin/` 和旧私有安装。也会检查这些位置的标准 npm 包，不扫描整块磁盘。
- Windows 标准 npm 的 `claude.cmd` / `codex.cmd` 及 `.ps1` 会解析为实际程序，兼容 Claude 原生版和旧 JS 版；JS 入口使用 Rally 自带运行时，Codex npm 入口解析为同一安装中的原生程序。自定义启动脚本不保证兼容，优先填写实际 CLI 路径。
- `adapterPath`：仅供高级覆盖或保留旧配置，可指向现有 ACP 的 JS 入口或原生程序。正常使用应省略，由 Rally 选择随包验证过的连接层；不自动采用 PATH 中其它版本，也不要求用户另行安装。已有覆盖路径失效时，确认用户没有定制需求后只删除该字段，恢复内置组件。
- 显式路径失效会报错；自动搜索会跳过损坏的候选，继续查找已有安装。此文件不存模型、密钥、登录态或 shell 命令；模型仍保存在角色的 `externalModel`，凭据仍由 CLI 管理。

### 配置步骤

1. 检查目标账号已有的 CLI。Windows 用 `Get-Command codex,claude -All -ErrorAction SilentlyContinue`；Linux 用 `command -v codex`、`command -v claude`。结合上述用户安装目录核对，终端与 Rally 的 PATH 可能不同。已安装但未被发现时填入 `executablePath`，不要再装一份。
2. 用实际路径运行 `--version`，检查程序能否启动。仅在目标主机确实没有 CLI、且用户要求安装时，按对应 CLI 官方方式安装一次；不在 Rally 内另建副本。版本不兼容或安装损坏时，报告具体路径和错误，不自动升级或替换。
3. 沿用目标账号现有登录和模型配置。需要登录时走该 CLI 的授权流程，不复制其它账号的凭据、不将凭据写入路径配置。
4. 在角色设置刷新模型，用返回的确切 ID 保存角色。分别报告“程序已发现”“模型目录可用”“角色已保存”，不要把 `--version` 或模型列表检查说成真实任务成功，也不要自动回退到其它执行器或模型。

若提示“Rally 内置连接组件缺失”，问题在 Rally 安装包，需更新或修复 Rally；不要让用户用 npm 补装连接层，也不要为此重装 CLI。源码开发的构建准备见发布指南。

升级 Rally 不覆盖设备已有程序或登录数据。旧私有目录中的 CLI 仅作兼容，不自动迁移、复制或删除；用户要求清理时先确认它是否仍被使用。

## 目标主机上的模型和登录配置

- Claude Code：检查目标进程的 `CLAUDE_CONFIG_DIR`（未设置时默认目标服务账号 `~/.claude`）下 `settings.json`，以及当前进程中 provider/model 相关环境变量。Rally 只读取模型相关字段/允许列表，不导入 hooks、MCP、项目设置、权限或工具。设置中的 `model`、`availableModels`、`modelOverrides`、`modelPicker` 可参与呈现模型目录；不得把其他设置原样复制进 Role 配置。不能回显凭据环境变量。
- Codex：沿用目标进程现有 `CODEX_HOME`、认证和模型/provider 配置（Codex 自己未设置 `CODEX_HOME` 时才按其默认用户目录发现）。Rally 不建第二份认证目录、不写 Rally API Key，也不复用此处模型作为 Claude 模型。支持 `auth/status` 时先检查它；旧 adapter 不支持该可选接口时，由创建会话检查认证。只有会话创建成功且返回模型后才确认目录可用，登录失败不忽略。
- CLI 未找到或内置连接组件缺失时分别按上面步骤处理；登录态不明、模型目录为空时不要保存假模型或派发任务，不能在客户端替运行任务的服务器补装或登录。

## 执行边界和验证

Rally 明确禁用 Claude 的 Bash、Skill、Agent/Task 等工具与 hooks/settings 来源；Codex 会通过 `CODEX_CONFIG` 关闭 delegation、hooks 及 plugin hooks，并按任务模式设置 `read-only` 或 `workspace-write` sandbox。ACP 权限提升请求由 Rally 拒绝。外部 Agent 不接入 Rally MCP、浏览器或内部工具，也不等同于原生 Rally Worker 的工具审批；仍需遵守当前版本实现的工作目录、权限和任务范围，不得宣称主机级隔离。

保存角色后复查 executor/model 与实际解析到的 CLI、adapter 路径。模型列表检查不发送任务 prompt，不以此声称真实任务已成功。用户明确要求试运行时，再执行其授权范围内的小任务。
