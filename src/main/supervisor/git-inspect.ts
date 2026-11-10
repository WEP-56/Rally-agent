import { realpath, stat } from "node:fs/promises";
import type { ToolDefinition } from "@rally/coding-agent";
import { Type } from "typebox";
import policy from "./git-policy.json" with { type: "json" };
import { resolveToolPath } from "./file-paths.ts";
import { runGit, type GitRunner, type GitResult } from "./git-runner.ts";

const schema = Type.Object({
	cwd: Type.Optional(Type.String({ minLength: 1 })),
	command: Type.Union([Type.Literal("status"), Type.Literal("log"), Type.Literal("diff"), Type.Literal("show"), Type.Literal("branch")]),
	args: Type.Optional(Type.Array(Type.String())),
});
export type GitReadCommand = "status" | "log" | "diff" | "show" | "branch";

export function createGitInspectTool(base: () => string, outputDir: string, runner: GitRunner = runGit): Pick<ToolDefinition<typeof schema, GitResult>, "name" | "label" | "description" | "parameters" | "execute"> {
	return {
		name: "git_inspect", label: "查询 Git", parameters: schema,
		description: "Read-only Git status/log/diff/show/branch queries. Relative cwd follows the main conversation's current default workspace. branch always lists; mutation, output-file, pager, external-diff and textconv options are rejected. Use args as literal argv, never a shell string.",
		execute: async (_id, input, signal) => {
			const args = inspectArgs(input.command, input.args ?? []);
			const cwd = await gitCwd(base(), input.cwd);
			const result = await runner(cwd, args, { signal, outputDir, readonly: true });
			return gitToolResult(result);
		},
	};
}

export async function gitCwd(base: string, input?: string): Promise<string> {
	const path = await realpath(resolveToolPath(input ?? ".", base));
	if (!(await stat(path)).isDirectory()) throw new Error("GIT_CWD_INVALID: cwd 必须是目录");
	return path;
}

export function gitToolResult(result: GitResult) {
	return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: result, ...(result.exitCode !== 0 ? { isError: true } : {}) };
}

/** An allowlist is necessary: e.g. diff --output writes and branch <name> creates a branch. */
export function inspectArgs(command: GitReadCommand, input: readonly string[]): string[] {
	if (!policy.readCommands.includes(command) || !Array.isArray(input) || input.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw readonlyError("参数无效");
	const allowed = new Set(command === "status" ? policy.readOptions.status : command === "branch" ? policy.readOptions.branch
		: [...policy.readOptions.diff, ...(command === "diff" ? [] : policy.readOptions.history)]);
	const args = [...input];
	let paths = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (paths) continue;
		if (arg === "--") {
			// It is not a path separator when the previous option consumes it as a value
			// (e.g. branch --format -- -D name). Require attached values in that case.
			if (i > 0 && couldConsumeValue(args[i - 1])) throw readonlyError("请先用 --option=value 或短选项附加值，再使用路径分隔符 --");
			paths = true; continue;
		}
		if (arg.startsWith("--")) {
			const name = arg.slice(2).split("=")[0];
			if (!allowed.has(name)) throw readonlyError(arg);
			// Check every token. Git has optional option values and different parsers per
			// command: assuming the next token is data can hide --output or a mutation.
			// For values beginning with '-', use the unambiguous --option=value form.
		} else if (arg.startsWith("-") && arg !== "-") {
			const pattern = command === "status" ? /^-[sbvz]+$|^-u(?:no|normal|all)?$/ : command === "branch" ? /^-[arvqi]+$/
				: /^-[psuwbRzaWcmr]+$|^-(?:U|B|M|C|l)\d*(?:%)?$|^-\d+$/;
			if (pattern.test(arg)) continue;
			if (command !== "status" && command !== "branch" && /^-[nLSGIO]/.test(arg)) {
				continue;
			}
			throw readonlyError(arg);
		}
	}
	// Force the semantic mode, independently of local Git configuration.
	return [command, ...(command === "branch" ? ["--list"] : command === "status" ? [] : ["--no-ext-diff", "--no-textconv"]), ...args];
}

const valueOptions = new Set([
	"format", "pretty", "date", "max-count", "skip", "since", "since-as-filter", "after", "until", "before", "author", "committer", "grep", "glob", "exclude", "decorate-refs", "decorate-refs-exclude", "encoding", "min-parents", "max-parents", "sort", "points-at", "stat-width", "stat-name-width", "stat-graph-width", "stat-count", "diff-algorithm", "anchored", "word-diff-regex", "ignore-matching-lines", "src-prefix", "dst-prefix", "line-prefix", "inter-hunk-context", "find-object", "diff-filter", "skip-to", "rotate-to", "output-indicator-new", "output-indicator-old", "output-indicator-context",
	"contains", "no-contains", "merged", "no-merged", "color", "column", "abbrev", "porcelain", "untracked-files", "ignored", "ignore-submodules", "find-renames", "branches", "tags", "remotes", "no-walk", "ancestry-path", "decorate", "notes", "expand-tabs", "diff-merges", "stat", "dirstat", "dirstat-by-file", "unified", "color-moved", "color-moved-ws", "ws-error-highlight", "break-rewrites", "find-copies", "word-diff", "color-words", "relative", "submodule",
]);
function couldConsumeValue(arg: string): boolean {
	return arg.startsWith("--") ? !arg.includes("=") && valueOptions.has(arg.slice(2)) : /^-[nLSGIOUBMClu]$/.test(arg);
}
function readonlyError(option: string): Error { return new Error(`READONLY_VIOLATION: git_inspect 不允许此参数或动作：${option}；请使用只读查询参数，修改交给任务 agent。`); }
