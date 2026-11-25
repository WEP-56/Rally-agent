# Role Workers 首版产品与实施方案

日期：2026-11-24
状态：首版实现已落地，待用户视觉验收

## 产品范围

### 首版

- 设置中由用户新建、编辑、删除角色。
- 字段：名称、头像、摘要、人设、工作规范、可选 Rally 模型、推荐 Skills。
- router 的角色目录包含名称、摘要、工作重点；主 agent 依据任务选用角色，并通过已有 `task_dispatch` 派发，不创建下级 agent。
- 角色没有独立权限。worker 仍用任务原有 cwd、读写模式、审批和 MCP/工具链路。
- Skills 选项只作为软推荐进入角色上下文，Pi 现有 Skills 发现和按需加载方式不变。
- 角色未指定模型时使用 Rally 现有 worker 模型；指定模型须为 Rally 当前可用模型。默认思考级别沿用 worker 选择支持的级别，否则关闭思考。
- 角色目录存放在 Rally agent 配置目录，首版只在当前 Rally 实例设置；IPC 通过已有 business handler 同时服务桌面/云端。

### 后续

- ACP 执行器先 Claude Code，再 Codex；首版不依赖外部执行器。
- ACP 不得暴露子 agent 能力，必须验证执行器是否能完全遵守“worker 不嵌套子 agent”。
- agent 自我管理角色配置属于后续阶段，不进入首版。

## 数据及运行设计

- 单独定义 `RoleWorkerProfile` 共享类型与 `RoleWorkerStore`；角色配置以版本化 JSON 原子持久化，复用 `RallyPaths.agentDir`。
- Task 可选保存角色 ID；task_dispatch 从当前角色配置校验 ID，防止模型派发不存在的角色。
- 启动 worker 时按 role ID 读取角色：用角色模型（若有）覆盖全局 worker model；将人设、规范和推荐 Skill 名称注入 `WORKER_SYSTEM_PROMPT`；MCP、工具列表和权限完全沿用普通 worker。
- 更新角色不会热改正在运行的 session；后续 resume/recovery 在启动时读取当前角色配置。删除被尚未结束任务引用的角色应报错，避免历史任务下次启动时丢失其角色定义。
- router 每轮最新 `rally-capabilities` 快照提供可选角色目录和摘要；工具参数携带可选 role ID。任务无角色时保持现有行为。

## 管理界面

- 在现有设置导航新增“角色 Workers”页，复用 Rally 的卡片、表单、按钮和 token。
- 支持列表、创建、编辑、删除；头像使用本地图片选择并标准化为 PNG data URL；技能以已有 Skills 清单多选，文案明确“推荐使用，不限制加载”。
- 模型选择复用现有可用模型数据，可选“沿用默认任务模型”。MCP 不出现在角色表单。

## 主要实现位置

- 共享契约：`src/shared/role-workers.ts`、`src/shared/ipc.ts`、`src/shared/client-api.ts`
- 持久化与业务接线：`src/main/role-worker-store.ts`、`src/main/business.ts`、`src/main/supervisor/index.ts`
- 派发与执行：`src/shared/task.ts`、`src/main/supervisor/tools.ts`、`src/main/supervisor/worker.ts`
- 设置界面：`src/renderer/src/components/RoleWorkersSection.tsx`、`src/renderer/src/components/Settings.tsx`、`src/renderer/src/App.tsx`
- 定向测试：角色配置校验/持久化、角色模型选择、派发角色验证、worker prompt 注入、删除使用中角色拒绝。

## 实施结果（2026-11-24）

- 已新增 `src/shared/role-workers.ts`、`src/main/role-worker-store.ts`；角色写入 `~/.rally/agent/rally-role-workers.json`，版本化并原子保存。
- 已新增角色 Workers 设置页、头像 PNG 标准化、模型选择、Skills 推荐选择及角色 CRUD。MCP 未纳入表单。
- 已新增 IPC/business handler；云端仍通过既有 command transport。设置界面在云端配置事件和窗口聚焦时刷新。
- `task_dispatch` 增加可选 `roleId`；当前角色目录注入主 agent 最新 capabilities，上下文仅公开 ID/名称/摘要。
- worker session 使用角色人设/工作规范和 Skills 建议；角色模型覆盖全局 worker 模型。MCP/工具、权限与审批未变。
- 任务保留 roleId；被未结束任务使用的角色不能删除。任务详情展示角色名/头像。
- 定向生产回归已加入 `packages/coding-agent/test/suite/rally-supervisor.test.ts`。

## 验收标准

1. 用户能创建/编辑/删除角色，字段重启后保留，头像可以选择、预览和清除。
2. 不可保存 Rally 未配置模型；未选角色模型时按现有 worker 配置运行。
3. 主 agent 能看到角色名和摘要，并在派发时选择；无角色的旧任务/旧流程保持兼容。
4. Pi worker 收到角色人设、工作规范和推荐 Skills；推荐文本明确可忽略，实际 Skills 仍按现有加载逻辑发现/调用。
5. MCP 清单和权限对角色不变；读写、审批及外部工具门沿用任务既有控制。
6. 删除被未结束任务引用的角色会得到明确错误；运行中编辑不改变当前会话。
7. `npm run typecheck` 目前只报仓库记录的两个模型数据测试文件错误；node/web 项目类型检查通过。角色生产集成测试随 `rally-supervisor.test.ts` 运行通过。
8. 不改动 `roles-docs/` 以外的文档。视觉验收由用户负责。
