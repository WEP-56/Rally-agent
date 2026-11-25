
# Rally 文本模型提供商

只处理 Rally 的聊天模型目录。先确认用户要“新增/修改供应商”“仅切换主模型”还是“设置默认 Worker 模型”，以及目标 Rally 主机。Worker 不知道主 Agent 的隐含选择；Key 或模型选择不能从先前未引用的上下文猜。

## 配置位置与字段

- 文件：`$RALLY_CODING_AGENT_DIR/rally-models.json`。不要误改 Pi 的 `models.json`；Rally 会把本文件注册进 Pi 的运行时。
- 根对象：`version: 1`、`active`（主 Agent 当前选择或 `null`）、`worker`（全局默认 Worker 选择或 `null`）、`providers`（供应商数组）。选择对象形如 `{ provider, model, thinkingLevel }`。
- 供应商：`id` 唯一标识、`name` 显示名、`protocol` 为 `messages`（Anthropic Messages 协议）或 `responses`（OpenAI Responses 协议）、`baseUrl`、`apiKey`、`models`。
- 模型：`id` 为服务端模型 ID，`name` 可选；`contextWindow` 与 `maxTokens` 必须为正数；`compactionThreshold` 为 0–1 的阈值；`vision`、`reasoning` 为布尔值；`thinkingLevels` 是该模型支持的子集，空数组表示由运行时采用默认能力。全局档位为 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。
- UI 新建模型默认元数据：上下文 128000、压缩阈值 0.8、最大输出 16384、`vision: false`、`reasoning: false`、`thinkingLevels: []`。这些是编辑器默认值，不可冒充供应商实测规格；应以用户/供应商资料修正。
- 目录 API 对供应商 Base URL 请求 `${baseUrl}/models`，最长等待 10 秒，接受数组、`data` 数组或 `models` 数组，最多展示 200 个 ID。

## 凭据和操作

优先用 Rally 设置 UI/API 的凭据流程，不让用户把 API Key 发在聊天里。注意：本地桌面当前的模型文件包含 `apiKey` 字段，Rally 的模型运行时支持配置值引用；不要把新 Key 明文写入普通 JSON、任务 note、命令行或日志，先确认当前设置流程如何解析/保存凭据，不要假设它会自动进 vault。也不要把云端返回的脱敏占位符当作真实 Key。模型请求可能产生费用，除非用户明确授权，不要用真实聊天请求测试。

先读现有状态，验证目标主机 `/models` 目录并展示模型 ID，让用户选定后再添加/切换。目录不可用时只报告安全的错误摘要并请用户提供精确模型 ID；不得猜模型 ID。新增供应商不自动切成主模型。切换主模型写入 `active`；设置默认 Worker 写入 `worker`，二者不可互换。思考级别必须属于该模型实际支持列表。删除/重命名当前使用的 provider/model 可能使相应选择归零；先向用户说明影响。

保存后重新读取状态，分别报告供应商配置、可用模型目录、主模型和 Worker 默认模型；仅当执行了获授权的真实请求时才报告调用成功。
