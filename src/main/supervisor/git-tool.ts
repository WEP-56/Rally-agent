import type { ToolDefinition } from "@rally/coding-agent";
import { Type } from "typebox";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { AuditLog } from "./audit.ts";
import type { GateService } from "./gates.ts";
import type { TaskStore } from "./task-store.ts";
import { withinOutput } from "./file-paths.ts";
import { gitToolResult } from "./git-inspect.ts";
import { planGit, type GitPlan } from "./git-plan.ts";
import { runGit, type GitResult, type GitRunner } from "./git-runner.ts";

const schema = Type.Object({ args: Type.Array(Type.String(), { minItems: 1 }), cwd: Type.Optional(Type.String({ minLength: 1 })) });
interface GitHost { task: Task; run: TaskRun; store: TaskStore; gates: GateService; audit: AuditLog; isActive(): boolean }

export function createGitTool(host: GitHost, runner: GitRunner = runGit): Pick<ToolDefinition<typeof schema, GitResult>, "name" | "label" | "description" | "parameters" | "execute"> {
	return {
		name: "git", label: "执行 Git", parameters: schema,
		description: "Execute a built-in Git subcommand using literal args (no shell or global flags); cwd defaults to this task's directory. Destructive forms wait for an approval gate; ordinary push is announced and audited. Return exitCode/output and a full log path for long output. Use full option names for controlled commands.",
		execute: async (id, input, signal) => {
			const request = structuredClone(input);
			const active = () => {
				signal?.throwIfAborted();
				if (!host.isActive() || host.task.ended || host.run.endedAt) throw new Error("TASK_ENDED: 任务或运行已结束");
			};
			active();
			const options = { signal, outputDir: host.task.outputDir };
			const plan = await planGit(host.task.cwd, request, options, runner);
			assertMode(host.task, plan);
			active();
			if (plan.tier === "irreversible") {
				const decision = await host.gates.request(host.task, host.run.id, id, "git", { args: request.args, cwd: plan.cwd, riskTier: plan.tier, fingerprint: plan.fingerprint }, {
					action: `执行 Git ${JSON.stringify(request.args)}；可能丢弃工作区改动、删除本地历史/引用或改写远端引用。`,
					scope: plan.scope,
					alternative: "先用 status/diff/log 检查；保留现状、备份需保留的改动，或缩小参数范围后重新请求。",
				}, signal, plan.cwd);
				if (decision.value !== "allow") throw new Error(`GATE_DENIED: ${decision.reason}`);
				active();
				const current = await planGit(host.task.cwd, request, options, runner);
				if (current.fingerprint !== plan.fingerprint) throw new Error("GIT_CONTEXT_CHANGED: 等待批准期间仓库、引用、配置或目标改变，请重新检查后发起请求");
				assertMode(host.task, current);
			}
			active();
			const audit = { taskId: host.task.id, runId: host.run.id, toolCallId: id, tool: "git", action: `git ${plan.command}`, cwd: plan.cwd, args: request.args, scope: plan.scope, riskTier: plan.tier };
			if (plan.tier === "external") {
				host.audit.append("external", { ...audit, result: "attempt" });
				host.store.recordExternalAction(host.task.id, `git ${plan.command}`);
			}
			// Command scope is an attempted access, not a claim about individual file
			// changes. Git can partially mutate a repository before returning nonzero.
			host.store.recordAccess(host.task.id, { toolCallId: `${host.run.id}:${id}`, runId: host.run.id, tool: "git", at: Date.now(), kind: plan.readonly ? "fs_read" : "fs_write", target: plan.repository, command: JSON.stringify(request.args), coverage: "command_scope", outcome: "attempt" });
			for (const target of plan.network) host.store.recordAccess(host.task.id, { toolCallId: `${host.run.id}:${id}`, runId: host.run.id, tool: "git", at: Date.now(), kind: "net", target, command: plan.command, coverage: "command_scope", outcome: "attempt" });
			active();
			try {
				const result = await runner(plan.cwd, plan.args, { ...options, readonly: plan.readonly });
				if (plan.tier !== "reversible") host.audit.append(plan.tier === "external" ? "external" : "gate", { ...audit, result: "finished", exitCode: result.exitCode });
				return gitToolResult(result);
			} catch (error) {
				if (plan.tier !== "reversible") host.audit.append(plan.tier === "external" ? "external" : "gate", { ...audit, result: signal?.aborted ? "cancelled" : "error" });
				throw error;
			}
		},
	};
}

function assertMode(task: Task, plan: GitPlan): void {
	if (task.mode !== "readonly" || plan.readonly) return;
	const localCommands = ["add", "stage", "commit", "reset", "checkout", "switch", "restore", "branch", "clean", "merge", "rebase", "cherry-pick", "revert", "stash", "reflog", "gc", "tag"];
	if (!localCommands.includes(plan.command) || ![plan.cwd, plan.repository, plan.gitDir, plan.commonDir].every((path) => withinOutput(task.outputDir, path))) {
		throw new Error("READONLY_TASK: 只读任务只能查询项目 Git；本地改动仅限完全位于本任务产出目录的仓库，请汇报 blocked 申请项目改写");
	}
}
