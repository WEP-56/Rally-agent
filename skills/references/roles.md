
# Rally Role Worker 设置

先明确用户要新增/编辑/删除哪个角色，或其真实 ID/字段；Worker 看不到主 Agent 未引用的聊天和 UI 状态，不能猜角色身份。删除角色是破坏性操作，必须对应用户明确要求。

## 配置位置与字段

- 文件：`$RALLY_CODING_AGENT_DIR/rally-role-workers.json`。
- 根对象 `{ version: 1, roles: [...] }`，最多 40 个角色，ID 唯一。
- 档案字段：`id`（字母/数字/下划线/连字符，最多 80 字）、`name`（必填，最多 40 字）、`avatar`、`summary`（最多 500 字）、`personality`（最多 4000 字）、`workstyle`（最多 4000 字）、`recommendedSkills`（最多 20 项，每项非空且最多 120 字）、`createdAt`、`updatedAt`（毫秒时间戳由 Rally 维护）。
- `avatar` 为 `null` 或本地 256×256 PNG data URL，最多 512 KiB。替换前先给候选并取得用户确认。
- Rally 执行器可选 `model: { provider, model }`，必须存在于 Rally 当前模型目录；Role schema 不含思考档位。
- 外部执行器可选 `executor: "claude-code" | "codex"` 加必填 `externalModel`（最多 200 字）；外部档案不能同时有 Rally `model`。缺省 executor 为 `rally`。模型必须来自该目标主机对应 adapter 当前返回的目录。

## 角色语义与安全

名称、摘要、人设、工作方式和推荐 Skills 描述任务偏好，不构成额外能力、项目范围或审批授权。推荐 Skill 只是提示，不代表已安装/启用。Rally Role Worker 仍是普通 Worker，不能派生子 Agent。Claude Code/Codex executor 是外部进程，不桥接 Rally MCP、浏览器、内部工具或原生工具审批；依赖这些能力的任务不应交给该角色。

通过当前可用的角色设置工具/UI操作，不编造接口名。更新时保留未提及字段；模型选择前确认执行器类型并读取对应的实时目录。保存后重新读取目录核对字段和模型是否仍可用。若用户要求试运行，只派发授权的无副作用小任务，并按实际结果报告。
