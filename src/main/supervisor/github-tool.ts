import { createHash } from "node:crypto";
import type { ToolDefinition } from "@rally/coding-agent";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { AuditLog } from "./audit.ts";
import { GithubReadSchema, GithubSchema, planGithub, resolveGithubRepository } from "./github-plan.ts";
import type { GithubRunner, GithubResult } from "./github-runner.ts";
import type { TaskStore } from "./task-store.ts";

const usage = "Use repo as OWNER/REPO (github.com) or HOST/OWNER/REPO; omit to resolve from cwd. Uses the user's existing gh login. list supports state/search/limit (default 30, max 100); view/comment require number. Returns exitCode/output, with a full log path for long output.";
interface GithubHost { task: Task; run: TaskRun; store: TaskStore; audit: AuditLog; isActive(): boolean }

export function createGithubReadTool(base: () => string, outputDir: string, runner: GithubRunner): Pick<ToolDefinition<typeof GithubReadSchema, GithubResult>, "name" | "label" | "description" | "parameters" | "execute"> {
	return {
		name: "github_read", label: "查询 GitHub", parameters: GithubReadSchema,
		description: `Read-only GitHub issue/PR list and view. cwd follows the main conversation's current default workspace. ${usage}`,
		execute: async (_id, input, signal) => {
			const request = structuredClone(input); const plan = planGithub(request, true);
			const cwd = base(); const options = { signal, outputDir };
			signal?.throwIfAborted();
			const repository = await resolveGithubRepository(cwd, request.repo, options, runner);
			signal?.throwIfAborted();
			return result(await runner(cwd, [...plan.args, `--repo=${repository.repo}`], options));
		},
	};
}

export function createGithubTool(host: GithubHost, runner: GithubRunner): Pick<ToolDefinition<typeof GithubSchema, GithubResult>, "name" | "label" | "description" | "parameters" | "execute"> {
	return {
		name: "github", label: "操作 GitHub", parameters: GithubSchema,
		description: `GitHub issue/PR list/view/create/comment in this task's cwd. Creation/comments are external actions: announced and audited without a gate. Only send when the user's quoted words explicitly authorize it. create requires title and explicit body; pr_create also requires an already pushed head (branch or owner:branch), with optional base/draft. Comment requires nonempty body. Body is literal stdin, not a filename. Nonzero/aborted writes may have succeeded remotely; inspect before retrying. ${usage}`,
		execute: async (id, input, signal) => {
			const active = () => {
				signal?.throwIfAborted();
				if (!host.isActive() || host.task.ended || host.run.endedAt) throw new Error("TASK_ENDED: 任务或运行已结束");
			};
			active();
			const request = structuredClone(input); const plan = planGithub(request, false);
			const options = { signal, outputDir: host.task.outputDir };
			const repository = await resolveGithubRepository(host.task.cwd, request.repo, options, runner);
			active();
			const audit = { taskId: host.task.id, runId: host.run.id, toolCallId: id, tool: "github", action: plan.action, repo: repository.repo, number: request.number, title: request.title, head: request.head, base: request.base, draft: request.draft, riskTier: "external",
				...(plan.stdin !== undefined ? { bodySha256: createHash("sha256").update(plan.stdin).digest("hex"), bodyBytes: Buffer.byteLength(plan.stdin) } : {}) };
			if (plan.external) {
				host.audit.append("external", { ...audit, result: "attempt" });
				host.store.recordExternalAction(host.task.id, `github ${plan.action} ${repository.repo}${request.number ? ` #${request.number}` : ""}`);
			}
			// Repository host only: not a claim about API/proxy redirects or remote success.
			host.store.recordAccess(host.task.id, { toolCallId: `${host.run.id}:${id}`, runId: host.run.id, tool: "github", at: Date.now(), kind: "net", target: repository.host, command: plan.action, coverage: "command_scope", outcome: "attempt" });
			try {
				active();
				const response = await runner(host.task.cwd, [...plan.args, `--repo=${repository.repo}`], { ...options, stdin: plan.stdin });
				if (plan.external) host.audit.append("external", { ...audit, result: "finished", exitCode: response.exitCode, outcome: response.exitCode === 0 ? "success" : "unknown" });
				return result(response);
			} catch (error) {
				if (plan.external) host.audit.append("external", { ...audit, result: signal?.aborted ? "cancelled" : "error", outcome: "unknown" });
				throw error;
			}
		},
	};
}
function result(value: GithubResult) { return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value, ...(value.exitCode !== 0 ? { isError: true } : {}) }; }
