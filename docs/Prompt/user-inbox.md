# 用户消息与收件箱重试

源码路径：`src/main/supervisor/main-agent.ts` 的 `drainInbox()`。机制说明见[用户消息收件箱](../用户消息收件箱.md)。

## 正常投递

```text
[User message ${line.id}]
${line.text}
```

- `line.id`：事件日志中的原用户消息 ID，如 `#123`；派发任务引用该 ID。
- `line.text`：接收时保存的原文，保持不变；附件走已有 `attachmentMessage()`，不把附件内容拼成授权。
- 每轮只投递一条已排到的用户消息；队列长度、状态、当前时间不注入模型。

## 用户明确重试时追加

```text
<rally-retry>Host notice: the user explicitly retried this interrupted message. Some work may already be complete. Check conversation history and task_read before taking action; continue existing tasks and do not repeat completed actions.</rally-retry>
```

追加于上述原文之后，仅在 `delivery.retried=true` 时使用。仍沿用原消息 ID 和原话授权，不伪造一条新的用户要求；要求核对已有进展，不能保证未知结果的外部动作恰好执行一次。单纯重发失败的 IM 回复不调用模型，也不生成此提示。

静态队列规则同时记录于[主系统提示词](system-prompt.md)；`chat_search` 对未处理及已撤回消息的边界见[对话与记忆](tools-Description/conversation.md)。
