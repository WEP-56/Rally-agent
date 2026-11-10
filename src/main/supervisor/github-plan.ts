import { Type, type Static } from "typebox";
import type { GithubRunner, GithubRunOptions } from "./github-runner.ts";

const readActions = ["issue_list", "issue_view", "pr_list", "pr_view"] as const;
const actions = [...readActions, "issue_create", "issue_comment", "pr_create", "pr_comment"] as const;
const queryFields = {
	repo: Type.Optional(Type.String({ minLength: 1 })),
	number: Type.Optional(Type.Integer({ minimum: 1 })),
	search: Type.Optional(Type.String()),
	state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
};
const readActionSchema = Type.Union([Type.Literal("issue_list"), Type.Literal("issue_view"), Type.Literal("pr_list"), Type.Literal("pr_view")]);
export const GithubReadSchema = Type.Object({ action: readActionSchema, ...queryFields }, { additionalProperties: false });
export const GithubSchema = Type.Object({
	action: Type.Union([Type.Literal("issue_list"), Type.Literal("issue_view"), Type.Literal("pr_list"), Type.Literal("pr_view"), Type.Literal("issue_create"), Type.Literal("issue_comment"), Type.Literal("pr_create"), Type.Literal("pr_comment")]), ...queryFields,
	title: Type.Optional(Type.String({ minLength: 1 })), body: Type.Optional(Type.String()),
	base: Type.Optional(Type.String({ minLength: 1 })), head: Type.Optional(Type.String({ minLength: 1 })),
	draft: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type GithubInput = Static<typeof GithubSchema>;
export interface GithubRepository { repo: string; host: string; url: string }
export interface GithubPlan { action: GithubInput["action"]; external: boolean; args: string[]; stdin?: string }

/** A fixed action grammar: no arbitrary gh subcommands, flags, templates or shell. */
export function planGithub(input: GithubInput, readonly: boolean): GithubPlan {
	if (!actions.includes(input.action)) throw invalid("不支持的 action");
	const external = !readActions.some(action => action === input.action);
	if (readonly && external) throw new Error("READONLY_VIOLATION: github_read 只允许 issue/PR 的 list/view");
	const [kind, operation] = input.action.split("_");
	const allowed = new Set(["action", "repo", ...(operation === "list" ? ["search", "state", "limit"] : operation === "view" ? ["number"] : operation === "comment" ? ["number", "body"] : kind === "pr" ? ["title", "body", "base", "head", "draft"] : ["title", "body"])]);
	for (const [key, value] of Object.entries(input)) {
		if (!allowed.has(key)) throw invalid(`${input.action} 不接受 ${key}`);
		if (["action", "repo", "search", "state", "title", "body", "base", "head"].includes(key) && (typeof value !== "string" || value.includes("\0") || value.length > 1024 * 1024)) throw invalid(`${key} 必须为不含 NUL 的字符串，且不超过 1 MiB 字符`);
	}
	if (input.repo !== undefined) githubRepository(input.repo);
	const args = [kind, operation];
	if (operation === "list") {
		if (input.state !== undefined && !["open", "closed", "all"].includes(input.state)) throw invalid("state 必须是 open/closed/all");
		const limit = input.limit ?? 30;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid("limit 必须为 1–100 整数");
		args.push(`--state=${input.state ?? "open"}`, `--limit=${limit}`);
		if (input.search !== undefined) args.push(`--search=${input.search}`);
	} else if (operation === "view" || operation === "comment") {
		if (!Number.isSafeInteger(input.number) || input.number! < 1) throw invalid("view/comment 必须指定正整数 number");
		args.push(String(input.number));
	}
	if (!external) {
		const fields = ["number", "title", "state", "url", "author", "labels", "createdAt", "updatedAt"];
		if (operation === "view") fields.push("body", "comments", ...(kind === "pr" ? ["baseRefName", "headRefName", "isDraft", "reviewDecision", "reviews", "statusCheckRollup"] : ["assignees", "stateReason"]));
		args.push(`--json=${fields.join(",")}`);
		return { action: input.action, external, args };
	}
	if (typeof input.body !== "string" || (operation === "comment" && !input.body.trim())) throw invalid("创建/评论必须显式提供 body；评论正文不能为空");
	if (operation === "create") {
		if (!input.title?.trim()) throw invalid("创建必须提供 title");
		args.push(`--title=${input.title}`);
		if (kind === "pr") {
			// gh explicitly skips implicit pushing/forking when --head is supplied.
			if (!input.head?.trim()) throw invalid("pr_create 必须指定已推送的 head（分支或 owner:branch）；需要推送时单独使用 git 工具");
			if (input.base !== undefined && !input.base.trim()) throw invalid("base 不能为空");
			if (input.draft !== undefined && typeof input.draft !== "boolean") throw invalid("draft 必须为布尔值");
			args.push(`--head=${input.head}`);
			if (input.base !== undefined) args.push(`--base=${input.base}`);
			if (input.draft) args.push("--draft");
		}
	}
	args.push("--body-file=-");
	return { action: input.action, external, args, stdin: input.body };
}

export function githubRepository(value: string): GithubRepository {
	const parts = value.split("/");
	if (parts.length === 2) parts.unshift("github.com");
	const [rawHost, owner, name] = parts;
	if (parts.length !== 3 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(rawHost) || rawHost.includes("..") || ![owner, name].every(part => /^[a-z0-9_.-]+$/i.test(part) && part !== "." && part !== "..")) throw invalid("repo 格式为 OWNER/REPO 或 HOST/OWNER/REPO（不接受 URL、凭据和查询参数）");
	const host = rawHost.toLowerCase();
	return { repo: `${host}/${owner}/${name}`, host, url: `https://${host}/${owner}/${name}` };
}

export async function resolveGithubRepository(cwd: string, repo: string | undefined, options: GithubRunOptions, runner: GithubRunner): Promise<GithubRepository> {
	if (repo !== undefined) return githubRepository(repo);
	// Resolve once, then pin --repo for the operation even if local remotes change.
	const result = await runner(cwd, ["repo", "view", "--json=nameWithOwner,url"], { ...options, metadata: true });
	if (result.exitCode !== 0) throw new Error(`GITHUB_REPO_UNRESOLVED: 请显式指定 repo，或检查当前目录与 gh 登录。${result.output}`);
	try {
		const data: unknown = JSON.parse(result.output);
		if (!data || typeof data !== "object" || !("url" in data) || typeof data.url !== "string" || !("nameWithOwner" in data) || typeof data.nameWithOwner !== "string") throw invalid("仓库元数据缺少字段");
		const url = new URL(data.url);
		if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname.replace(/\/$/, "") !== `/${data.nameWithOwner}`) throw invalid("仓库 URL 无效");
		return githubRepository(`${url.hostname}/${data.nameWithOwner}`);
	} catch (cause) { throw new Error("GITHUB_REPO_UNRESOLVED: gh 未返回有效仓库元数据，请显式指定 repo", { cause }); }
}
function invalid(message: string): Error { return new Error(`GITHUB_ARGUMENT_INVALID: ${message}`); }
