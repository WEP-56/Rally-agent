# 对话与记忆

[返回工具分类](rally-tools.md)

## credential_request

- 源码路径：`src/main/supervisor/credential-tools.ts`（仅 Main Agent/router）
- 提示词原文：

```text
Ask the user to save a website account through Rally's private credential form. Pass the exact HTTP(S) website origin, optionally purpose and the related taskId. Requests expire after 24 hours or when their associated task/run ends. Never ask for account names or passwords in chat. Returns only request metadata; saving or cancelling automatically resumes you with a credential_result event. Continue from that result without asking the user to confirm saving in chat. Enabled saved accounts can be reused by Workers on the matching website; saving does not mean website login has succeeded. Browser control belongs to Workers.
```

- 参数：`{ website: string, purpose?: string, taskId?: string }`，HTTP(S) 地址长度 1–16384；用途长度 1–1000；任务 ID 长度 1–100，绑定其当前 run。工具调用 ID 用于申请幂等。
- 返回：申请 ID、origin、pending/saved/cancelled/expired、创建时间、可选用途/任务/run 及保存后的账号引用。提交只走宿主接口，账号密码不在工具参数或结果中。
- 保存和取消通过持久中继发送 `credential_result`：主 Agent 空闲时唤醒、忙时 steer，重启补发缺失结果，重复提交按申请 ID 和状态去重。账号密文保存在 Agent 配置目录的 `website-accounts.txt`，Windows 使用 safeStorage，Linux 使用部署 vault key。

### credential_result 回告

- 源码路径：`src/main/supervisor/relay.ts` 的 `render()`；由 `src/main/business.ts` 的提交/取消接口及 `src/main/supervisor/index.ts` 的启动恢复调用。
- 提示词原文（`enqueue()` 添加 `relayId`）：

```text
<rally-event kind="credential_result">
${JSON.stringify(input.request)}
The private credential request has finished. Continue the related work using this status; saved means the account is available to the Worker, not that website login has succeeded. Do not ask the user to confirm saving again.
</rally-event>
```

- 参数：`input.request` 为申请元数据，包含 ID、origin、status、createdAt 及可选 purpose/taskId/runId/accountId；不含账号或密码。`saved`、`cancelled`、`expired` 是不同结果，不把保存等同于登录成功。

## chat_search

- 源码路径：`src/main/supervisor/chat-search.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Search main-chat history when you need an older fact or original user authorization. Choose one mode: {id:"#123"} reads one full message and must be used alone; {query:"keyword",limit:20} searches; {aroundId:"#123",limit:10} reads neighbours. Never combine id with query, aroundId, times or cursor. Search is literal and case-insensitive; before/after are exclusive Unix-millisecond bounds. Results are newest first, with 200-character previews, limit 1–100. Continue with cursor=next and identical filters. Queued and withdrawn user messages are excluded. Only user IDs authorize actions. Worker background needs no search: use task_dispatch context:0–30 and memory:0/1.
```
- 参数：

```ts
ChatSearchSchema = Type.Object({
	query: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
	id: Type.Optional(Type.String({ ...messageId, description: 'Exact lookup: pass only {id:"#123"}. Do not add query, aroundId, times or cursor.' })),
	aroundId: Type.Optional(Type.String({ ...messageId, description: "Neighbourhood lookup; do not combine with id." })),
	before: Type.Optional(Type.Integer({ minimum: 0 })), after: Type.Optional(Type.Integer({ minimum: 0 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	cursor: Type.Optional(Type.String({ maxLength: 4096 })),
}, { additionalProperties: false });
```

## memory_add

- 源码路径：`src/main/supervisor/memory-tools.ts`（Main Agent）
- 提示词原文：

```text
Add one entry to your notebook about the user. file is USER (who they are: lasting facts), PREFERENCES (how they like things done) or RECENT (things happening now that will end). Write one line in the user's language, ending with its metadata in parentheses: (fact|inferred, source message or task ID, YYYY-MM-DD), and for RECENT also "; drop: <when this can be deleted>". The entry is appended to the end of the file; a nightly pass files and merges entries, so do not spend effort on placement. Fails if the file would exceed its budget: shorten or remove an older entry with memory_edit first.
```

- 参数：file 为 USER / PREFERENCES / RECENT；text 为 1–500 字的单行条目。

## memory_edit

- 源码路径：`src/main/supervisor/memory-tools.ts`（Main Agent）
- 提示词原文：

```text
Change or delete existing notebook text. old must match exactly one passage in the current memory snapshot of that file; new replaces it, and an empty new deletes it. Use this when the user corrects something you have on file, when a newer fact replaces an older one, when a RECENT item is resolved, or when they ask you to forget something. Fails if old is not found or matches more than once, which usually means the file changed: check the snapshot in your next request.
```

- 参数：file 为 USER / PREFERENCES / RECENT；old 为非空、唯一匹配的原文，new 为替换内容，空字符串表示删除。
