
# Rally 外部 Agent 执行器

Rally 外部执行器是 Role Worker 的 ACP backend，不是拥有 Rally 内部工具的普通 Worker。先读取用户引用和当前 Rally 主机状态；桌面 Rally 与 Linux 服务主机上的文件、登录和 CLI 环境相互独立。不要用当前聊天所在设备的 `PATH` 或登录状态替代目标 Rally 主机结果。

## Rally 角色绑定配置

- Role Worker 配置：`$RALLY_CODING_AGENT_DIR/rally-role-workers.json`，详见本 Skill 的 `references/roles.md`。
- 对应角色使用 `executor: "claude-code"` 或 `"codex"`，并保存必填 `externalModel`。切为外部执行器时必须移除 Rally 专用 `model`；重新读 ACP 会话返回的 `category=model` 目录，模型选择器保存的 ID 必须与返回 `value` 完全一致，不使用 Rally 文本模型目录或猜测模型名。
- 模型目录探测会在目标主机启动对应 ACP adapter，创建只读、临时会话后关闭；它不是模型推理测试。无可用模型时不能绑定，也不能静默回退到其它 executor/model。

## 程序和适配器：优先复用，缺少时按需安装

从 Rally 0.4.1 起，基础包不含 Claude Code、Codex、它们的 SDK 运行时和 ACP adapter。用户要求启用或配置某个执行器时，只准备所选执行器；打开设置或刷新模型不会自动下载程序。外部执行器需要实际 CLI 和接入 Rally 的 ACP adapter 两部分，仅安装 CLI 不等于已经接入。

先按总索引确认目标主机、运行账号和 `RALLY_CODING_AGENT_DIR`。Windows 桌面、Linux 服务和远端客户端不是同一台机器，云端任务需在服务端配置；程序必须安装在该运行账号可访问的位置。

### 路径与字段

配置文件为 `$RALLY_CODING_AGENT_DIR/external-agents.json`，可选。每次启动外部会话都重读，修改文件后无需重启 Rally；已运行的会话继续使用原程序。

```json
{
  "claude-code": {
    "adapterPath": "C:/Users/实际账号/某安装目录/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js",
    "executablePath": "C:/Users/实际账号/.local/bin/claude.exe"
  },
  "codex": {
    "adapterPath": "/实际安装目录/node_modules/@agentclientprotocol/codex-acp/dist/index.js",
    "executablePath": "/实际工具目录/codex"
  }
}
```

这是字段示例，不可原样复制，只填写本次目标主机上的真实绝对路径，保留其它执行器配置。

- 顶层键为 `claude-code` 或 `codex`，不是角色 ID，每个值是对象。
- `adapterPath`：可选，已有 ACP adapter 的 JavaScript 入口绝对路径，不能填 npm 命令或目录。未设置时固定读取 `$RALLY_CODING_AGENT_DIR/external-agents/<执行器>/node_modules/<包名>/dist/index.js`。不会寻找 Rally 应用目录内旧版随包副本。
- `executablePath`：可选，CLI 文件绝对路径，不接受参数或相对路径。优先于目标 Rally 进程的 `CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`。未设置时依次搜索 Agent 的 `bin/`、该进程 `PATH`、该账号 `~/.local/bin`、Windows `%APPDATA%/npm`，最后检查按需安装的 adapter 所带原生依赖。显式路径失效会报错，不会偷偷换用另一套程序。
- Windows 标准 npm 的 `claude.cmd` / `codex.cmd`（以及 `.ps1`）会按包内 `bin` 字段解析为实际程序，兼容 Claude 原生版和旧 JS 版；JS 入口由 Rally 自带 Node 运行，Codex npm 入口解析为同一安装中的原生二进制。自定义启动脚本不保证兼容，优先填写实际 CLI 路径。
- 此文件不存模型、密钥、登录态或 shell 命令。模型仍保存在 Role Worker 的 `externalModel`，凭据仍由对应 CLI 管理。更新后在角色设置刷新模型。

### 安装步骤

1. 检查目标主机的已有 CLI：Windows `Get-Command claude,codex -ErrorAction SilentlyContinue`，Linux `command -v claude` / `command -v codex`。同时检查上述默认用户目录；进程 PATH 可能未包含后来安装的程序。已有程序优先复用，不重复下载 CLI。已有 adapter 则检查它的 `package.json` 和入口，兼容安装可通过 `adapterPath` 复用。
2. 缺 adapter 时，用下表固定版本安装到目标账号用户数据目录。先确认 `node` / `npm` 可用。Linux 正式包提供 `/opt/rally/current/bin/node` 和 `npm`，其 `bin` 需在 PATH 中；Windows 桌面仅自带运行所需 Node，不含 npm，若设备缺 npm，先通过官方 Node.js 来源为该用户准备 npm。不能假定 npm 已存在，不要安装到 Rally 应用目录、源码目录或另一台机器。

| 执行器目录名 | adapter 包及固定版本 |
| --- | --- |
| `claude-code` | `@agentclientprotocol/claude-agent-acp@0.110.1` |
| `codex` | `@agentclientprotocol/codex-acp@2.10.0` |

已有 Codex CLI、仅缺 adapter 时，Windows PowerShell：

```powershell
$runtimeDir = Join-Path $env:RALLY_CODING_AGENT_DIR 'external-agents/codex'
npm install --prefix "$runtimeDir" --save-exact --ignore-scripts --omit=optional '@agentclientprotocol/codex-acp@2.10.0'
```

Linux：

```sh
runtime_dir="$RALLY_CODING_AGENT_DIR/external-agents/codex"
npm install --prefix "$runtime_dir" --save-exact --ignore-scripts --omit=optional '@agentclientprotocol/codex-acp@2.10.0'
```

Claude 对应替换目录名和包。`--omit=optional` 避免重复下载大型原生 CLI；安装后把已发现 CLI 的绝对路径写入 `executablePath`，避免桌面/服务 PATH 差异。已有 adapter 但缺 CLI 时，可按 CLI 官方说明安装到目标账号并记录路径。

3. 若主机没有 CLI 且用户要求安装，也可对所选 adapter 使用同样命令，去掉 `--omit=optional` 并加 `--include=optional`。它会在此用户目录下载 CLI 原生依赖，Rally 可直接发现。这是按需下载，体积可达数百 MB；不要为另一个未使用的执行器也安装。保留生成的 `package-lock.json` 记录依赖版本；不用临时 `npx` 或未知脚本。
4. 用实际 CLI 路径运行 `--version`，检查操作系统/架构和可启动性。登录必须在同一目标账号完成，复用已有登录；需要交互时使用已有安全授权/接管流程，不复制另一台机器的凭据，不将凭据写入普通配置。
5. 在角色设置刷新外部模型，成功后用返回的确切 ID 保存角色。失败分别报告缺 adapter、CLI 路径问题、登录/配置问题或版本不兼容。先核查 CLI 版本和 adapter 要求，不能自动换 provider/model 或回退到 Rally Worker。`--version` 成功不等于真实模型运行成功。

按需组件保存在用户数据目录，升级 Rally 不覆盖。清理或升级组件前先结束使用它的任务，只操作该执行器目录，保留角色和 CLI 登录数据。

## 目标主机上的模型和登录配置

- Claude Code：检查目标进程的 `CLAUDE_CONFIG_DIR`（未设置时默认目标服务账号 `~/.claude`）下 `settings.json`，以及当前进程中 provider/model 相关环境变量。Rally 只读取模型相关字段/允许列表，不导入 hooks、MCP、项目设置、权限或工具。设置中的 `model`、`availableModels`、`modelOverrides`、`modelPicker` 可参与呈现模型目录；不得把其他设置原样复制进 Role 配置。不能回显凭据环境变量。
- Codex：沿用目标进程现有 `CODEX_HOME`、认证和模型/provider 配置（Codex 自己未设置 `CODEX_HOME` 时才按其默认用户目录发现）。Rally 不建第二份认证目录、不写 Rally API Key，也不复用此处模型作为 Claude 模型。只有 ACP `auth/status` 已认证且 adapter 返回模型时才报告“可派发”。
- CLI 或 adapter 缺失时按上面步骤在已确认的目标主机准备；登录态不明、模型目录为空时不要保存假模型或派发任务，不能在 Worker 所在机器替另一个目标主机补装或登录。

## 执行边界和验证

Rally 明确禁用 Claude 的 Bash、Skill、Agent/Task 等工具与 hooks/settings 来源；Codex 会通过 `CODEX_CONFIG` 关闭 delegation、hooks 及 plugin hooks，并按任务模式设置 `read-only` 或 `workspace-write` sandbox。ACP 权限提升请求由 Rally 拒绝。外部 Agent 不接入 Rally MCP、浏览器或内部工具，也不等同于原生 Rally Worker 的工具审批；仍需遵守当前版本实现的工作目录、权限和任务范围，不得宣称主机级隔离。

保存角色后复查 executor/model 与目标 adapter 目录。若用户要求验证，只用用户授权的无副作用任务；不要发真实模型请求或创建/修改文件，除非明确授权。报告区分：adapter 可启动、登录状态、模型目录、角色配置保存、真实任务运行；这些不是同一项验证。
