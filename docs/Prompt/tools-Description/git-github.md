# Git 与 GitHub

[返回工具分类](rally-tools.md)

## git_inspect

- 源码路径：`src/main/supervisor/git-inspect.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Read-only Git status/log/diff/show/branch queries. Relative cwd follows the main conversation's current default workspace. branch always lists; mutation, output-file, pager, external-diff and textconv options are rejected. Use args as literal argv, never a shell string.
```
- 参数：

```ts
schema = Type.Object({
	cwd: Type.Optional(Type.String({ minLength: 1 })),
	command: Type.Union([Type.Literal("status"), Type.Literal("log"), Type.Literal("diff"), Type.Literal("show"), Type.Literal("branch")]),
	args: Type.Optional(Type.Array(Type.String())),
})
```

## git

- 源码路径：`src/main/supervisor/git-tool.ts`（可用角色：Worker）
- 提示词原文：

```text
Execute a built-in Git subcommand using literal args (no shell or global flags); cwd defaults to this task's directory. Destructive forms wait for an approval gate; ordinary push is announced and audited. Return exitCode/output and a full log path for long output. Use full option names for controlled commands.
```
- 参数：

```ts
schema = Type.Object({ args: Type.Array(Type.String(), { minItems: 1 }), cwd: Type.Optional(Type.String({ minLength: 1 })) })
```

## github_read

- 源码路径：`src/main/supervisor/github-tool.ts`（可用角色：Main Agent）
- 提示词原文：

```text
Read-only GitHub issue/PR list and view. cwd follows the main conversation's current default workspace. Use repo as OWNER/REPO (github.com) or HOST/OWNER/REPO; omit to resolve from cwd. Uses the user's existing gh login. list supports state/search/limit (default 30, max 100); view/comment require number. Returns exitCode/output, with a full log path for long output.
```
- 参数：

```ts
const readActionSchema = Type.Union([Type.Literal("issue_list"), Type.Literal("issue_view"), Type.Literal("pr_list"), Type.Literal("pr_view")])
const queryFields = {
  repo: Type.Optional(Type.String({ minLength: 1 })), number: Type.Optional(Type.Integer({ minimum: 1 })),
  search: Type.Optional(Type.String()), state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
}
GithubReadSchema = Type.Object({ action: readActionSchema, ...queryFields }, { additionalProperties: false })
```

## github

- 源码路径：`src/main/supervisor/github-tool.ts`（schema 在 `src/main/supervisor/github-plan.ts`；可用角色：Worker）
- 提示词原文：

```text
GitHub issue/PR list/view/create/comment in this task's cwd. Creation/comments are external actions: announced and audited without a gate. Only send when the user's quoted words explicitly authorize it. create requires title and explicit body; pr_create also requires an already pushed head (branch or owner:branch), with optional base/draft. Comment requires nonempty body. Body is literal stdin, not a filename. Nonzero/aborted writes may have succeeded remotely; inspect before retrying. Use repo as OWNER/REPO (github.com) or HOST/OWNER/REPO; omit to resolve from cwd. Uses the user's existing gh login. list supports state/search/limit (default 30, max 100); view/comment require number. Returns exitCode/output, with a full log path for long output.
```
- 参数：

```ts
GithubSchema = Type.Object({
  action: Type.Union([Type.Literal("issue_list"), Type.Literal("issue_view"), Type.Literal("pr_list"), Type.Literal("pr_view"), Type.Literal("issue_create"), Type.Literal("issue_comment"), Type.Literal("pr_create"), Type.Literal("pr_comment")]),
  ...queryFields,
  title: Type.Optional(Type.String({ minLength: 1 })), body: Type.Optional(Type.String()),
  base: Type.Optional(Type.String({ minLength: 1 })), head: Type.Optional(Type.String({ minLength: 1 })),
  draft: Type.Optional(Type.Boolean()),
}, { additionalProperties: false })
```
