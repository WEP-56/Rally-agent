# 对话与记忆

[返回工具分类](rally-tools.md)

## chat_search

- 源码路径：`src/main/supervisor/chat-search.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Search complete main-chat history, including before compaction. Literal case-insensitive query, exclusive before/after Unix-millisecond timestamps, newest first, limit 1–100 (default 20). aroundId returns neighbours. Previews are 200 characters; id alone returns exact full text. Continue with cursor=next and identical filters. Only user/assistant messages; only user IDs can authorize actions.
```
- 参数：

```ts
ChatSearchSchema = Type.Object({
	query: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
	id: Type.Optional(messageId), aroundId: Type.Optional(messageId),
	before: Type.Optional(Type.Integer({ minimum: 0 })), after: Type.Optional(Type.Integer({ minimum: 0 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	cursor: Type.Optional(Type.String({ maxLength: 4096 })),
}, { additionalProperties: false })
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
