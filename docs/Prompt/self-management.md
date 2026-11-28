# 自我管理 Skill 路由描述

- 源码路径：`skills/SKILL.md` 的 YAML `description`。主助手从 `src/main/supervisor/capability-catalog.ts` 接收摘要；Worker 按需读取 Skill 和对应 supporting reference。
- 提示词原文：

```text
Route explicit requests to configure Rally itself: identity/avatar, coach, chat models, image generation or web search, MCP, Skills, Rally roles, and Claude Code/Codex executors. For external agents, reuse the task host's installed CLI, login and model settings; Rally already includes the ACP connection layer. Read only the matching domain reference; this is the single Rally self-management entry.
```

- 参数：无模型填写参数；主助手按现有 `task_dispatch` 引用用户要求并传递必要背景，执行配置的 Worker 通过 `RALLY_CODING_AGENT_DIR` 确认目标运行主机的 Agent 配置目录。
- 完整 Skill 原文：[自我管理入口](../../skills/SKILL.md)；外部执行器部分：[发现与复用](../../skills/references/external-agents.md)。原文只在这些源文件维护。
- 外部执行器路径覆盖：可选 `external-agents.json`，顶层为 `claude-code` / `codex`，`executablePath` 指向已有 CLI 绝对路径。缺省时发现任务主机的已有安装，ACP 连接层使用 Rally 内置版本；客户端和云端运行主机须区分。`adapterPath` 只保留为高级覆盖和旧配置兼容，普通接入无需填写或另装连接层。
