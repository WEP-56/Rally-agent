# Rally 工具描述

按用途查找工具。各条目保留「源码路径 → 提示词原文 → 参数」的结构；主 Agent 与 Worker 使用同名工具但定义不同时分开标注。

| 分类 | 工具 |
| --- | --- |
| [任务与定时](tasks.md) | `task_dispatch`、`task_approve`、`task_update`、`task_steer`、`task_answer`、`task_resume`、`task_cancel`、`task_read`、`task_report`、`gate_decide`、`escalate`、`schedule_create`、`schedule_list`、`schedule_update` |
| [对话与记忆](conversation.md) | `chat_search`、`memory_add`、`memory_edit`、`credential_request` |
| [世界感知](world.md) | `world_time`、`world_location`、`world_weather` |
| [Worker 浏览器](browser.md) | `browser_open`、`browser_snapshot`、`browser_screenshot`、`browser_navigate`、`browser_action`、`browser_login`、`browser_file` |
| [文件与目录](files.md) | `read`、`grep`、`find`、`ls`、`write`、`edit`、`file_delete` |
| [命令、作业与服务](execution.md) | `bash`、`powershell`、`job_output`、`job_kill`、`service_start`、`service_status`、`service_stop` |
| [网页搜索与网络请求](network.md) | `web_search`、`fetch_page`、`http_request` |
| [Git 与 GitHub](git-github.md) | `git_inspect`、`git`、`github_read`、`github` |
| [生图与附件](media.md) | `image_gen`、`resource_publish` |
| [连接器与 MCP](connectors.md) | `qqmail_search`、`qqmail_read`、`qqmail_save_attachment`、`qqmail_send`、动态 MCP 工具 |
