# 文件与目录

[返回工具分类](rally-tools.md)

## read

- 源码路径：`packages/coding-agent/src/core/tools/read.ts`（可用角色：Main Agent / Worker）
- 提示词原文：

```text
`Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`
```
- 参数：

```ts
readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
})
```

## grep

- 源码路径：`packages/coding-agent/src/core/tools/grep.ts`（可用角色：Main Agent / Worker）
- 提示词原文：

```text
`Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`
```
- 参数：

```ts
grepSchema = Type.Object({
	pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
	glob: Type.Optional(
		Type.String({
			description:
				"Filter files by glob pattern, relative to path, e.g. '*.ts', 'src/**/*.ts' or '**/*.spec.ts'. A pattern without '/' matches file names at any depth",
		}),
	),
	ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
	literal: Type.Optional(
		Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" }),
	),
	context: Type.Optional(
		Type.Number({ description: "Number of lines to show before and after each match (default: 0)" }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
})
```

## find

- 源码路径：`packages/coding-agent/src/core/tools/find.ts`（可用角色：Main Agent / Worker）
- 提示词原文：

```text
`Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`
```
- 参数：

```ts
findSchema = Type.Object({
	pattern: Type.String({
		description: "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
	}),
	path: Type.Optional(Type.String({ description: "Directory to search in (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
})
```

## ls

- 源码路径：`packages/coding-agent/src/core/tools/ls.ts`（可用角色：Main Agent / Worker）
- 提示词原文：

```text
`List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`
```
- 参数：

```ts
lsSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "Directory to list (default: current directory)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
})
```

## write

- 源码路径：`packages/coding-agent/src/core/tools/write.ts`（可用角色：Worker）
- 提示词原文：

```text
Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.
```
- 参数：

```ts
writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
})
```

## edit

- 源码路径：`packages/coding-agent/src/core/tools/edit.ts`（可用角色：Worker）
- 提示词原文：

```text
Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.
```
- 参数：

```ts
editSchema = Type.Object(
	{
		path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
		edits: Type.Array(replaceEditSchema, {
			description:
				"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
		}),
	},
	{},
)
```

## file_delete

- 源码路径：`src/main/supervisor/file-delete.ts`（可用角色：Worker）
- 提示词原文：

```text
Preview file/directory deletion (default dryRun=true), including bytes, uncommitted files and paths outside cwd. Real deletion checks read versions and waits for an irreversible-action gate except for task output or verified task-created files. Never bypass a refusal with shell.
```
- 参数：

```ts
schema = Type.Object({
	paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Literal paths, relative to the task cwd or absolute; no globs. Symlinks are removed without following their targets." }),
	recursive: Type.Optional(Type.Boolean({ description: "Include directory contents. Default false." })),
	dryRun: Type.Optional(Type.Boolean({ description: "Preview only by default. false requests deletion; Rally obtains approval when required." })),
})
```
