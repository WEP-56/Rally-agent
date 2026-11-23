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

## memory_append

- 源码路径：`src/main/supervisor/memory-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Append a short memory (1–300 characters) when the user explicitly asks to remember it. quotes references that user's message. Returns entryId and an optional size warning.
```
- 参数：

```ts
append = Type.Object({ text: Type.String({ minLength: 1, maxLength: 300 }), quotes: refs })
```

## memory_remove

- 源码路径：`src/main/supervisor/memory-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Remove an entryId shown in the current memory snapshot when the user explicitly asks to forget it. quotes references that user's message. Returns removed:true.
```
- 参数：

```ts
remove = Type.Object({ entryId: Type.String({ pattern: "^M-[1-9][0-9]*$" }), quotes: refs })
```
