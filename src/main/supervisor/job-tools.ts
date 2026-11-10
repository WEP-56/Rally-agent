import { getPowerShellConfig, getShellConfig, getShellEnv, type ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { JobManager } from "./jobs.ts";
import type { ProcessCommand } from "./process-host.ts";

const shellSchema = Type.Object({ command: Type.String({ minLength: 1 }), timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 2147483 })) });
const outputSchema = Type.Object({ jobId: Type.String(), tail: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })) });
const killSchema = Type.Object({ jobId: Type.String() });

export function shellCommand(shell: "bash" | "powershell", command: string, task: Pick<Task, "id" | "cwd" | "outputDir">): ProcessCommand {
	if (/^\s*(?:sleep\b|start-sleep\b|timeout(?:\.exe)?\s+\/t\b)/i.test(command)) throw new Error("NO_POLLING: 不使用 sleep/Start-Sleep/timeout /t 轮询；作业结束会自动通知");
	const config = shell === "powershell" ? getPowerShellConfig() : getShellConfig();
	const text = shell === "powershell" ? `try { [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding } catch {}\n${command}` : command;
	return { executable: config.shell, args: config.commandTransport === "stdin" ? [...config.args] : [...config.args, text],
		...(config.commandTransport === "stdin" ? { stdin: `${text}\n` } : {}), cwd: task.cwd,
		env: { ...getShellEnv(), RALLY_TASK_ID: task.id, RALLY_OUTPUT_DIR: task.outputDir, PYTHONIOENCODING: "utf-8", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } };
}

export function createJobTools(jobs: JobManager, task: Task, run: TaskRun): ToolDefinition[] {
	const shells: ToolDefinition[] = (["bash", "powershell"] as const).map(shell => ({
		name: shell, label: shell === "bash" ? "执行 Bash" : "执行 PowerShell", parameters: shellSchema,
		description: "Run a command in the task cwd. Commands exceeding the foreground window become background jobs; completion automatically wakes or steers you. timeout is seconds (default unlimited). Do not sleep or poll; continue other work or end this turn while a job runs. Full output is logged; tool output is bounded.",
		async execute(_id: string, params: Static<typeof shellSchema>, signal?: AbortSignal) {
			const result = await jobs.execute(task, run, shell, params.command, shellCommand(shell, params.command, task), params.timeout, signal);
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, ...("exitCode" in result && result.exitCode !== 0 ? { isError: true } : {}) };
		},
	}));
	return [...shells, {
		name: "job_output", label: "读取作业输出", parameters: outputSchema,
		description: "Immediately read this task's job state and last output lines (default 200, max 2000; bounded bytes). Does not wait; completion is delivered automatically. Other tasks' jobs are inaccessible.",
		async execute(_id: string, params: Static<typeof outputSchema>) { const result = jobs.output(task.id, params.jobId, params.tail); return { content: [{ type: "text", text: JSON.stringify(result) }], details: result }; },
	}, {
		name: "job_kill", label: "停止作业", parameters: killSchema,
		description: "Stop this task's job process tree, escalating after five seconds if needed. Waits for termination confirmation. Other tasks' jobs are inaccessible.",
		async execute(_id: string, params: Static<typeof killSchema>) { const result = await jobs.kill(task.id, params.jobId); return { content: [{ type: "text", text: JSON.stringify(result) }], details: result }; },
	}];
}
