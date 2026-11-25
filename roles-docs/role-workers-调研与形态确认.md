# Role Workers：调研与已确认产品形态

日期：2026-11-24
状态：首版实现已落地，待用户验收。

## 已确认的产品形态

- Role worker 是普通 worker 的可复用角色配置；router 主 agent 根据任务需要派遣。角色本身不能再创建/派遣子 agent。
- 首版使用 Rally 原生 Pi worker。外部 Agent 接入 Rally 后也仍然是 worker，不新增特殊 agent 层级或委派动作。
- 角色配置：摘要、名称/头像、人设、工作规范、模型、推荐 Skills。模型只能从 Rally 已配置模型中选择。
- 首版由用户手动创建和编辑。角色功能落地完成后，后续再考虑 agent 自我管理配置。
- **Skills 是软推荐，不做权限过滤**：选择的 Skills 告诉 worker“遇到相关问题时优先参考”；worker 可自行决定是否读取/采用。
- **角色不配置 MCP**：角色不会筛选、禁用或额外授权 MCP；worker 沿用 Rally 当前已配置且原本对 worker 可用的 MCP。MCP 自身既有授权、审批和工具规则不因此改变。
- 外部 Agent 优先接入 **Claude Code，然后 Codex**；排序主要依据用户量。后续可视实际适配成本调整，不以 ACP 的协议接入方便程度替代产品优先级。

## 权限语义

角色仅改变身份、工作偏好与模型选择，不改变普通 worker 的目录、读写模式、审批、授权门、工具/MCP 可用范围，也不授予更高权限。

Skills 推荐列表只是提示词上下文，不是能力开关。用户选择某 Skill 后，系统向 worker 推荐其名称/描述或可用的 Skill 引用；worker 可以不读取。实现应保留 Pi/Rally 现有 Skills 发现与加载语义，不伪装成强制过滤。

角色配置不增加 MCP 清单。worker 继续沿用现有 MCP 集成；Rally 中原有的授权、工具审批及作用域控制仍有效。

## Rally 首版实现对应关系

`src/main/supervisor/worker.ts` 按任务创建 Pi `AgentSession`；`src/shared/task.ts` 的任务事实包含目录、读写模式、审批、运行记录等，当前没有 role 字段。首版建议让派发的任务可引用 role 配置，并在创建 Pi session 时注入角色身份、规范、模型和 Skills 推荐。它仍然进入现有任务 worker 生命周期、审批、报告和审计链路，不另建执行系统。

当前实现将 role ID 记录到任务事实；会话创建时读取角色配置，运行中不会热切换；后续 resume/recovery 按启动时的现有读取路径重新加载角色。用户编辑角色只影响新建会话。当前会话模型在启动时固定。

## Codeg 与外部 Agent 调研

Codeg 的公开实现将多种编码 Agent 接入统一运行界面；v0.48.0 发布记录显示 Claude Code 使用 `claude-agent-acp`、Codex 使用 `codex-acp`，并分别更新到 0.110.0 和 2.10.0。对 Rally 来说，可借鉴的是 ACP 的统一进程/事件接线方式；不应照搬 Codeg 的多 Agent 工作区或角色层级。

用户已确认优先级：

1. **Claude Code**：外部 worker 的首个接入目标。
2. **Codex**：第二个接入目标。

两者都应复用同一个 ACP 执行/事件适配层，避免分别创建两套并行架构。实际实现时需核实模型/认证、任务目录、权限/审批映射、流式事件、取消和错误传播。Codex ACP 可协商暴露子 agent 会话，因此 Rally 不能向它启用该能力；需确认不协商子会话后，执行器是否仍能自行创建不可见子 agent。如无法落实“角色 worker 不嵌套子 agent”，则该配置不得启用。

该优先级依据用户量而非当前测出的工程难度。Codeg 的持续更新证明这两条适配路径正在使用，但不代表 Rally 已完成兼容验证。

### 参考资料

- Codeg README：<https://github.com/spacering-net/codeg>
- Codeg v0.48.0 发布：<https://github.com/spacering-net/codeg/releases>
- Claude Agent ACP：<https://github.com/agentclientprotocol/claude-agent-acp>
- Codex ACP：<https://github.com/agentclientprotocol/codex-acp>
- PiBot 角色配置参考：`example/PiBot/docs/guide/zh/02-bots-and-roles.md`、`example/PiBot/packages/teams/builtin/roles/researcher.pibot/team.json`

## 当前状态

首版设计和实现记录见同目录的 `role-workers-产品与实施方案.md`。代码功能已完成，下一步为用户对设置页和任务详情的视觉验收；Claude Code、Codex ACP 仍为后续阶段。
