# 生图与附件

[返回工具分类](rally-tools.md)

## image_gen

- 源码路径：`src/main/supervisor/provider-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
`Generate and attach one image in this conversation for an explicit user request. Dispatch a worker for batches or design work. An explicit parameter rejection permits one corrected request, never another image. ${imageCompatibility}`
```
- 参数：

```ts
mainImageSchema = Type.Object({
	prompt,
	providerOptions: Type.Optional(Type.Object({
		...providerFields,
		count: Type.Optional(Type.Literal(1, { description: "Use only if this provider requires API field n." })),
	}, { description: providerOptionsDescription })),
	userMessageId: Type.String({ pattern: "^#[1-9][0-9]*$", description: "The latest original user message authorizing this one image. Never sent to the provider." }),
})
```

- 源码路径：`src/main/supervisor/provider-tools.ts`（可用角色：Worker）
- 提示词原文：

```text
`Generate up to four images per request when the provider supports it and the task authorizes it. For an authorized batch, set providerOptions.count. Published images appear in the timeline and task_report and can be previewed or downloaded. Do not copy them again with resource_publish. ${imageCompatibility}`
```
- 参数：

```ts
workerImageSchema = Type.Object({
	prompt,
	providerOptions: Type.Optional(Type.Object({
		...providerFields,
		count: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_GENERATED_IMAGES, description: "Number of images (API n). Set for an authorized batch or when the provider requires n." })),
	}, { description: providerOptionsDescription })),
})
```

## resource_publish

- 源码路径：`src/main/supervisor/resource-tools.ts`（可用角色：Main Agent / Worker）
- 提示词原文：

```text
Publish files as immutable attachments in Rally for preview/download. Supports images, audio, video and ordinary files. This does not send to external recipients. Workers should publish deliverables before task_report; published files accompany their reports.
```
- 参数：

```ts
schema = Type.Object({
  paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: MESSAGE_MAX_RESOURCES, description: "Files to snapshot from the working/output directory. Relative paths use cwd." })),
  resourceIds: Type.Optional(Type.Array(Type.String(), { maxItems: MESSAGE_MAX_RESOURCES, description: "Existing resource IDs to show again; do not invent IDs." })),
})
```
