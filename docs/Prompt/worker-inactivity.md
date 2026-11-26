# Worker 闲置恢复说明

- 源码路径：`src/main/supervisor/worker.ts`，`activate()`。
- 用途：宿主解除闲置保护后，首次接续被暂停的 Worker 时，在原任务分配消息前追加一次；普通请求不注入此段。
- 提示词原文：

```text
The host paused this run after 72 hours without user messages. The user has returned. Continue the original task from its saved progress. Background jobs, local services and browser windows were stopped. Check current files and external results before retrying interrupted actions; do not blindly repeat side effects.
```

- 参数：无。条件为当前运行存在 `inactivityPausedAt`；成功接上执行器后清除此标记。保留任务原话、未读补充和本地 Worker 的会话历史；外部执行器会建立新会话。
