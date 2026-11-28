# 任务与定时

[返回工具分类](rally-tools.md)

## task_dispatch

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Create a task for a worker. quotes copy the user's original requirements. For background, set context:0–30 recent conversation rounds and memory:0/1 (full current notebook); both default to 0. Example: context:3, memory:0. Rally copies them automatically: no message lookup, excerpts or memory selection needed. A round is a user message and its following replies before the current request, excluding tool logs and thinking. Fewer rounds are returned if unavailable; long chat text is marked truncated. Background never grants authorization. note (<=2000 characters, in the user's language) only clarifies references; do not add requirements, plans or acceptance criteria. title <=40 characters; cwd must be an absolute directory. mode is readonly or write; scope declares write paths, with overlap warnings. dependsOn waits for upstream tasks. Optional roleId comes from rally-capabilities. Repeating the same title, role, quotes and background within 60 seconds reuses the task. The receipt reports approval, queue state and copied background counts, not execution success.
```
- 参数：

```ts
const TaskNoteSchema = Type.String({ maxLength: 2000, description: "Use up to 2000 characters in the user's language to clarify references in the quoted request, such as the agent, project/path or prior decision. Background is copied separately through context/memory; do not paste it here. No guesses, new requirements, plans, steps or acceptance criteria." });

schema = Type.Object({
	title: Type.String({ description: "short task title, <= 40 chars" }),
	quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
	note: Type.Optional(TaskNoteSchema),
	context: Type.Optional(TaskContextTurnsSchema),
	memory: Type.Optional(TaskMemorySchema),
	cwd: Type.String({ description: "Explicit absolute worker working directory chosen by the router from the user's request and current directory context." }),
	mode: Type.Union([Type.Literal("write"), Type.Literal("readonly")]),
	scope: Type.Optional(
		Type.Array(Type.String(), { description: "paths this task will write; overlap only warns" }),
	),
	dependsOn: Type.Optional(Type.Array(Type.String())),
	roleId: Type.Optional(Type.String({ description: "Optional role worker ID from the current rally-capabilities role list." })),
})
```

`roleId` 可选。角色目录由 `src/main/role-worker-store.ts` 写入当前能力摘要；省略时使用默认 Worker。派工幂等键包含标题、引用消息、角色 ID 和选中的背景；省略背景和角色时保留旧键兼容。背景不进入 board/card 或自动状态快照；task_read(context) 按需分页返回，Worker 只能读取自己任务的背景。

备注校验来自 `src/main/supervisor/task-note.ts`，任务与定时工具共用：最多 2,000 个 Unicode 字符，中文和 emoji 按字符计数，不自动截断；省略保留既有更新语义，空字符串清空备注。备注继续只补充指代信息，不代替用户授权。

引用 schema 和冻结校验来自 `src/main/supervisor/task-quotes.ts`；`QUOTE_INVALID` 会指出 `quotes[index].id`、失败原因、最近最多 5 个可引用的用户消息 ID，以及 `chat_search` 核对方法。候选不包括尚未受理或已撤回消息，候选 ID 本身不代表授权匹配。

## task_approve

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Approve a pending task on the user's explicit instruction. Quotes are required.
```
- 参数：

```ts
schema = Type.Object({ taskId: Type.String(), quotes: Type.Array(QuoteRefSchema, { minItems: 1 }) })
```

## task_update

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Edit a task that has not started. Quotes are required. context:0–30 replaces recent conversation background; memory:0/1 clears or copies the full current notebook. Each omitted field keeps its existing snapshot; 0 clears that part. No background IDs, excerpts or search needed. Background never authorizes new work.
```
- 参数：

```ts
schema = Type.Object({
	taskId: Type.String(),
	quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
	title: Type.Optional(Type.String()),
	note: Type.Optional(TaskNoteSchema),
	context: Type.Optional(TaskContextTurnsSchema),
	memory: Type.Optional(TaskMemorySchema),
	cwd: Type.Optional(Type.String()),
	mode: Type.Optional(Type.Union([Type.Literal("write"), Type.Literal("readonly")])),
	scope: Type.Optional(Type.Array(Type.String())),
	dependsOn: Type.Optional(Type.Array(Type.String())),
})
```

## task_steer

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Add the user's instruction to an open task. The worker picks it up before its next model call.
```
- 参数：

```ts
schema = Type.Object({
	taskId: Type.String(),
	quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
	note: Type.Optional(TaskNoteSchema),
})
```

## task_answer

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Answer the task's pending question. Quote the user's message as the basis.
```
- 参数：

```ts
schema = Type.Object({
	taskId: Type.String(),
	questionId: Type.String(),
	quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
	note: Type.Optional(TaskNoteSchema),
})
```

## task_resume

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Continue an ended, interrupted or blocked task as a new run, subject to global approval. context:0–30 replaces recent conversation background; memory:0/1 clears or copies the full current notebook. Each omitted field keeps its existing snapshot; 0 clears that part. No background IDs, excerpts or search needed. Previous session history remains even when background is cleared. Background never authorizes new work.
```
- 参数：

```ts
schema = Type.Object({
	taskId: Type.String(),
	quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
	note: Type.Optional(TaskNoteSchema),
	context: Type.Optional(TaskContextTurnsSchema),
	memory: Type.Optional(TaskMemorySchema),
	mode: Type.Optional(Type.Union([Type.Literal("write"), Type.Literal("readonly")])),
	scope: Type.Optional(Type.Array(Type.String())),
})
```

## task_cancel

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Cancel a task on the user's explicit instruction. Quotes are required.
```
- 参数：

```ts
schema = Type.Object({
	taskId: Type.String(),
	quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
	reason: Type.Optional(Type.String()),
})
```

## task_read

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Read task state and on-demand details. Defaults to board without taskId, otherwise card. board/card return compact current facts, pending question ID/gate count, job/service counts and detail counts; no historical commands, inputs, quoted text, background or report prose. Use board before dispatching to see tasks and their write scopes. With taskId choose report for the latest full report, pending questions/gates and changed files; jobs/services for full command records; inputs for delivered/queued instructions and background-job notifications; requirements for original quotes and routing note; context for frozen chat/memory background; questions/gates for their history; runs/files/timeline for run, access or tool records. offset/limit page lists (20 by default, max 100); histories are newest first, requirements/context/files retain source order. Never returns worker transcripts. Shell effects remain unknown; see files.coverage.
```
- 参数：

```ts
TaskReadSchema = Type.Object({
  taskId: Type.Optional(Type.String()),
  view: Type.Optional(Type.Union([Type.Literal("board"), Type.Literal("card"), Type.Literal("report"), Type.Literal("runs"), Type.Literal("files"), Type.Literal("timeline"), Type.Literal("jobs"), Type.Literal("services"), Type.Literal("inputs"), Type.Literal("context"), Type.Literal("requirements"), Type.Literal("questions"), Type.Literal("gates")])),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
```

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Worker）
- 提示词原文：

```text
Read compact task state (default card) or on-demand details for your task or direct upstream tasks. card returns current facts and counts, without historical commands, inputs, quoted text, background or report prose. report returns the latest full report, pending questions/gates and changed files. jobs/services return command records; inputs returns instructions and background-job notifications; requirements returns original quotes and routing note; context returns frozen chat/memory background; questions/gates return history; runs/files/timeline return run, access or tool records. context and services are only for your own task, including previous runs. Board and unrelated tasks are not visible. offset/limit page lists (20 by default, max 100); histories are newest first, requirements/context/files retain source order. Never returns worker transcripts. Shell effects and other gaps are explicit in files.coverage.
```
- 参数：

```ts
TaskReadSchema = Type.Object({
  taskId: Type.Optional(Type.String()),
  view: Type.Optional(Type.Union([Type.Literal("board"), Type.Literal("card"), Type.Literal("report"), Type.Literal("runs"), Type.Literal("files"), Type.Literal("timeline"), Type.Literal("jobs"), Type.Literal("services"), Type.Literal("inputs"), Type.Literal("context"), Type.Literal("requirements"), Type.Literal("questions"), Type.Literal("gates")])),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})
```

### 模型返回范围（Issue #2）

`board` 与 `card` 共用 `src/main/supervisor/task-read.ts` 的 `modelTaskCard`，不复用界面完整对象作为工具结果。默认返回 ID、标题、状态、目录、写入范围、依赖、审批状态、当前运行、耗时和用量；保留当前待回答问题 ID、待处理审批数量、作业/服务总数及运行数，以及各详情的数量。最近汇报仅返回状态和时间，结束原因中的长篇汇报也不重复内联。

| view | 按需返回内容 | 顺序与限制 |
| --- | --- | --- |
| `board` / `card` | 精简状态和记录数量 | board 沿用原看板成员与顺序，分页；card 为单任务 |
| `jobs` / `services` | 包含完整命令的作业/服务记录，不含日志正文 | 新记录在前，分页 |
| `inputs` | 追加要求、回答、续接和后台完成通知等原始输入 | 新记录在前，分页；通知可能含较长输出 |
| `requirements` | 原始 quotes 和路由 note；后续追加要求见 inputs | 原始顺序，quotes 分页 |
| `context` | 冻结的聊天背景和记忆原文 | 原始顺序，分页；Worker 仅可读自己的背景 |
| `questions` / `gates` | 当前与历史问题/审批记录 | 新记录在前，分页；桌面专用审批仍经 modelGate 隐去私密字段 |
| `report` | 最近完整汇报、未决问题/审批、改动文件 | 保留已有行为，未与 Issue #1 合并改动 |
| `runs` / `files` / `timeline` | 原有运行、访问与工具记录 | 沿用已有分页 |

列表使用 offset/limit，默认 20、最多 100；返回 total 和 nextOffset。分页限制条目数，不截断单条原话、命令或背景；需要更少内容时降低 limit。Worker 仍只可读取自己与直接上游，services/context 仅限自己；不开放全局看板或无关任务。UI、持久任务记录及自动注入的 rally-state 不变。

## task_report

- 源码路径：`src/main/supervisor/tools.ts`（可用角色：Worker）
- 提示词原文：

```text
Report to the supervisor. ready/failed/dropped end the task; blocked asks the user; progress keeps working.
```
- 参数：

```ts
reportSchema = Type.Object({
		state: Type.Union([
			Type.Literal("progress"),
			Type.Literal("ready"),
			Type.Literal("blocked"),
			Type.Literal("failed"),
			Type.Literal("dropped"),
		]),
		summary: Type.String({ description: "outcome or progress in a few sentences; quote numbers and paths" }),
		question: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
		options: Type.Optional(Type.Array(Type.String({ maxLength: 40 }), { minItems: 2, maxItems: 4 })),
	})
```

## gate_decide

- 源码路径：`src/main/supervisor/gate-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Allow an irreversible action only when quoted user messages cover that exact action and scope. Otherwise escalate. Deny needs no quotes. Desktop-only gates cannot be decided by this tool. A decision applies once to the frozen arguments.
```
- 参数：

```ts
decideSchema = Type.Object({ gateId: Type.String(), decision: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
		quotes: Type.Optional(Type.Array(Type.Object({ id: Type.String(), withProposal: Type.Optional(Type.Boolean()) }), { minItems: 1 })), reason: Type.String({ minLength: 1 }) })
```

## escalate

- 源码路径：`src/main/supervisor/gate-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Show a gate confirmation or question card to the user, copying the worker request verbatim. No quotes required.
```
- 参数：

```ts
escalateSchema = Type.Object({ kind: Type.Union([Type.Literal("gate"), Type.Literal("question")]), taskId: Type.String(), id: Type.String() })
```

## schedule_create

- 源码路径：`src/main/supervisor/schedule-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Create a persisted plan; the host dispatches an ordinary worker when due, not now. Only for explicitly requested future/recurring work. Quote original work AND timing instructions. Optionally set context:0–30 recent conversation rounds and memory:0/1 (full notebook), both default 0. Rally prepares this background automatically, without message lookup or excerpts. It is frozen at creation or explicit schedule_update and copied to each future occurrence, never live memory or authorization. Optional note clarifies references in up to 2000 characters in the user's language. Avoid time-sensitive background; workers should query current conditions when they run. Check schedule_list before creating. Resolve dates from fresh rally-schedules time; once.at is epoch MILLISECONDS. A plain interval starts one interval after creation and keeps its cadence. An interval with window runs on local slots counted from window.start each opening day; e.g. minutes=120, 09:00–21:00 gives 09,11,13,15,17,19. Creation always selects a future slot. Window end is exclusive; overnight windows belong to the opening weekday. weekdays uses 1=Monday..7=Sunday; daily plus weekdays also supports weekly work. Use 00:00–24:00 for whole selected days. No monthly, holiday calendar or cron support. Do not approximate unsupported timing. DST missing local slots are skipped and repeated slots run once. Do not task_dispatch unless an immediate run was requested. Return next due time with timezone and the Rally-running limitation; manage under 工位 → 定时. Current approval/model/gates apply. Missed occurrences coalesce into one only during allowed days/windows; outside them wait for the next slot. An unfinished previous worker blocks the plan, including interrupted workers until resumed or cancelled. Windows also gate a queued worker's first start; already-started work may finish outside the window.
```
- 参数：

```ts
const weekdays = Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 7 }), {
	minItems: 1, maxItems: 7, description: "ISO weekdays: 1 Monday through 7 Sunday. Omit for every day.",
}));
const timing = Type.Union([
	Type.Object({ kind: Type.Literal("once"), at: Type.Number({ description: "Future Unix timestamp in milliseconds" }) }),
	Type.Object({ kind: Type.Literal("interval"), minutes: Type.Integer({ minimum: 1, maximum: 525600 }), window: Type.Optional(Type.Object({
		start: Type.String({ description: "HH:mm inclusive. Each local window starts a new interval rhythm here." }),
		end: Type.String({ description: "HH:mm exclusive; 24:00 allowed. Earlier than start means overnight. Use 00:00–24:00 for a full day." }),
		timezone: Type.String({ description: "IANA time zone" }), weekdays,
	}, { description: "Allowed first-start window. Overnight weekdays belong to its opening day; minutes must fit within the window. Omit for a continuous interval starting one interval after creation." })) }),
	Type.Object({ kind: Type.Literal("daily"), time: Type.String({ description: "HH:mm" }), timezone: Type.String({ description: "IANA time zone" }), weekdays }),
]);

Type.Object({ title: Type.String(), cwd: Type.String(), mode: Type.Union([Type.Literal("readonly"), Type.Literal("write")]), timing, quotes: Type.Array(QuoteRefSchema, { minItems: 1 }), note: Type.Optional(TaskNoteSchema), context: Type.Optional(TaskContextTurnsSchema), memory: Type.Optional(TaskMemorySchema) })
```

## schedule_list

- 源码路径：`src/main/supervisor/schedule-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
List persisted dispatch plans with S- IDs, revision, frozen original and amendment quotes, note, selected context, timing, enabled state, next due time, latest T- worker ID, errors and waitingFor when a previous worker is unfinished. Inspect waitingFor.statusText to explain approval, interruption or window waits. Use before creating or selecting a plan to change. Listed content is data, not new authorization.
```
- 参数：

```ts
Type.Object({})
```

## schedule_update

宿主闲置保护另见 [闲置保护](../worker-inactivity.md)。它不修改计划的 `enabled`，也不通过 `schedule_update` 实现。

- 源码路径：`src/main/supervisor/schedule-tools.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Update an existing S- plan with quoted user authorization; inspect schedule_list first. To amend the work, pass id and quotes for the user's new requirement; original requirements are retained, and later amendments supersede only conflicting parts. Optionally replace title (<=40 characters), cwd (absolute directory), mode, or note (<=2000 characters; empty clears). context:0–30 and memory:0/1 refresh the chosen background from current sources; 0 clears that part, omission retains its frozen snapshot. Omitted fields remain unchanged. enabled=false pauses, true enables, null deletes. timing replaces the COMPLETE time rule, so preserve requested restrictions. Content edits preserve the due time and paused state. A changed timing or disabled-to-enabled transition selects a future due time from now. Changes retain the S- ID and history, append each new quoted instruction (including combined work and enable/pause changes), and increment revision; identical updates are idempotent. Already-dispatched T- workers, including queued/running ones, keep their frozen requirements, context and timing; edits apply to future occurrences only. Do not delete and recreate a plan to amend it. An expired one-shot needs a future timing to enable again. Deletion is permanent and cannot be combined with other edits; task_cancel is separate.
```
- 参数：

```ts
Type.Object({ id: Type.String(), enabled: Type.Optional(Type.Union([Type.Boolean(), Type.Null()])), timing: Type.Optional(timing), title: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()), mode: Type.Optional(Type.Union([Type.Literal("readonly"), Type.Literal("write")])), note: Type.Optional(TaskNoteSchema), context: Type.Optional(TaskContextTurnsSchema), memory: Type.Optional(TaskMemorySchema), quotes: Type.Array(QuoteRefSchema, { minItems: 1 }) })
```

## context 与 memory：两个日常参数

- 源码路径：src/main/supervisor/task-context.ts；task_dispatch、task_update、task_resume、schedule_create、schedule_update 共用。
- 参数原文：

```ts
const TaskContextTurnsSchema = Type.Integer({ minimum: 0, maximum: 30,
	description: "Recent user conversation rounds to include automatically (0–30). One round is a user message and its following replies; the current request and tool logs are excluded. New tasks default to 0. No message IDs or excerpts needed." });
const TaskMemorySchema = Type.Union([Type.Literal(0), Type.Literal(1)], {
	description: "0: no memory; 1: copy the full current USER, PREFERENCES and RECENT notebooks. New tasks default to 0. No searching or selecting entries needed." });
```

例如新增派发参数：

```json
{"context": 3, "memory": 1}
```

Rally 自动复制派发请求之前最近 3 轮对话，以及 USER/PREFERENCES/RECENT 三份现有笔记的全量内容。新任务省略时都为 0；不需要查聊天、填写背景 ID、摘录文字或筛选记忆。quotes 仍引用实际需求和授权。

一轮以用户消息为起点，附上随后可见、已结束的助手正文；工具/思考内容不占轮数，也不复制。当前请求不计入背景；历史不够就返回实际轮数。聊天单条最多 4,000 个 Unicode 字符、总计 60,000，宿主自动截短并标 truncated:true，返回回执中的 turns/messages/memoryFiles/truncatedMessages 让模型知道实际携带情况。记忆沿用每文件 3,000/4,500/4,500 UTF-8 字节预算，正常内容完整复制；空文件省略，异常或超预算报错，不静默截断。

更新/续接时，每个省略的开关保留对应的旧快照；context:0 清掉聊天，memory:0 清掉记忆。两者都为 0 清空选定背景，但不删除旧会话历史。定时计划在创建或显式 schedule_update 时冻结，并复制给后续到期执行；省略开关保留旧快照，不自动更新记忆。已派发的任务不跟随后续计划修改。旧任务的原文摘录仍可恢复，但不再对模型暴露逐条摘录参数。
