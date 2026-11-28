import { Type, type Static } from "typebox";
import type { Task } from "../../shared/task.ts";
import { taskView } from "../../shared/task.ts";
import { modelGate } from "./gate-tools.ts";
import { TaskError, type TaskStore } from "./task-store.ts";

export const TaskReadSchema = Type.Object({
	taskId: Type.Optional(Type.String()),
	view: Type.Optional(Type.Union([
		Type.Literal("board"), Type.Literal("card"), Type.Literal("report"), Type.Literal("runs"), Type.Literal("files"), Type.Literal("timeline"),
		Type.Literal("jobs"), Type.Literal("services"), Type.Literal("inputs"), Type.Literal("context"), Type.Literal("requirements"), Type.Literal("questions"), Type.Literal("gates"),
	])),
	offset: Type.Optional(Type.Integer({ minimum: 0 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
export type TaskReadParams = Static<typeof TaskReadSchema>;

export function page<T>(items: T[], params: TaskReadParams) {
	const offset = params.offset ?? 0;
	const limit = params.limit ?? 20;
	if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TaskError("PAGE_INVALID", "offset 必须为非负整数，limit 为 1–100 的整数");
	const slice = items.slice(offset, offset + limit);
	return { items: slice, offset, total: items.length, nextOffset: offset + slice.length < items.length ? offset + slice.length : null };
}

/** Model reads need current facts, not the UI's complete task record. Keep this an explicit allowlist. */
export function modelTaskCard(task: Task, now = Date.now()) {
	const liveRuns = new Set(task.runs.filter(run => !run.endedAt).map(run => run.id));
	const gates = task.ended ? [] : (task.gates ?? []).filter(gate => !gate.decision && gate.expiresAt > now && liveRuns.has(gate.runId));
	const attention = !task.ended && task.attention && !task.attention.answer && !task.attention.closed && liveRuns.has(task.attention.runId) ? task.attention : undefined;
	const view = taskView({ ...task, gates, attention }, now);
	const run = task.runs.at(-1);
	const report = task.runs.findLast(run => run.lastReport)?.lastReport;
	return {
		id: task.id, title: task.title, schedule: view.schedule, status: view.status, statusText: view.statusText,
		mode: task.mode, roleId: task.roleId, cwd: task.cwd, scope: task.scope, dependsOn: task.dependsOn,
		createdAt: task.createdAt, updatedAt: task.updatedAt, durationMs: view.durationMs,
		approval: { state: task.approval.state, by: task.approval.by, at: task.approval.at }, queue: task.queue,
		run: run ? { id: run.id, n: run.n, endedAt: run.endedAt } : undefined,
		lastReport: report ? { state: report.state, at: report.at } : undefined,
		attention: attention ? { id: attention.id, waitingOn: attention.escalatedAt !== undefined ? "user" : "main" } : undefined,
		pendingGates: gates.length,
		jobs: { total: task.jobs?.length ?? 0, running: task.jobs?.filter(job => job.status === "running").length ?? 0 },
		services: { total: task.services?.length ?? 0, running: task.services?.filter(service => service.status === "running").length ?? 0 },
		counts: { runs: task.runs.length, inputs: task.inputs.length, requirements: task.quotes.length, context: task.context?.length ?? 0,
			questions: (task.attentionHistory?.length ?? 0) + (task.attention ? 1 : 0), gates: task.gates?.length ?? 0, changedFiles: task.changedFiles?.length ?? 0 },
		lastExternalAction: task.lastExternalAction,
		ended: task.ended ? { at: task.ended.at, outcome: task.ended.outcome, by: task.ended.by } : undefined,
		archivedAt: task.archivedAt, usage: task.usage,
	};
}

export function readTask(store: TaskStore, task: Task, params: TaskReadParams): Record<string, unknown> {
	// Validate even scalar views: direct callers must obey the same contract as schema-validated calls.
	page([], params);
	switch (params.view ?? "card") {
		case "card": return { card: modelTaskCard(task), outputDir: task.outputDir };
		case "report": return { report: task.runs.findLast((run) => run.lastReport)?.lastReport ?? null, attention: task.attention?.answer ? null : task.attention ?? null, gates: task.gates?.filter((gate) => !gate.decision).map(modelGate) ?? [], changedFiles: task.changedFiles ?? [] };
		case "jobs": {
			const { items, ...paging } = page([...(task.jobs ?? [])].reverse(), params);
			return { jobs: items, ...paging };
		}
		case "inputs": {
			const { items, ...paging } = page([...task.inputs].reverse(), params);
			return { inputs: items, ...paging };
		}
		case "context": {
			const { items, ...paging } = page(task.context ?? [], params);
			return { context: structuredClone(items), ...paging };
		}
		case "requirements": {
			const { items, ...paging } = page(task.quotes, params);
			return { quotes: items, note: task.note, ...paging };
		}
		case "questions": {
			const questions = [...(task.attentionHistory ?? []), ...(task.attention ? [task.attention] : [])].reverse();
			const { items, ...paging } = page(questions, params);
			return { questions: items, ...paging };
		}
		case "gates": {
			const { items, ...paging } = page([...(task.gates ?? [])].reverse(), params);
			return { gates: items.map(modelGate), ...paging };
		}
		case "runs": {
			const { items, ...paging } = page([...task.runs].reverse(), params);
			return { runs: items, ...paging };
		}
		case "services": {
			const { items, ...paging } = page([...(task.services ?? [])].reverse(), params);
			return { services: items, ...paging };
		}
		case "timeline": {
			// Tool inputs are bounded summaries; outputs and full worker messages are excluded.
			const { items, ...paging } = page(store.timeline(task.id).reverse().map(({ output: _output, ...call }) => call), params);
			return { timeline: items, ...paging };
		}
		case "files": {
			const { items, ...paging } = page(store.access(task.id), params);
			return { accesses: items, changedFiles: task.changedFiles ?? [], outputDir: task.outputDir,
				coverage: { writes: "successful write/edit only", reads: "successful read/grep/find/ls only", git: "attempted repository command scope; not exact changed files", shell: "unknown", network: "fetch_page/http_request/world_location/world_weather explicit hosts, methods and redirect hops; git resolved remote hosts and github repository hosts; attempts, not confirmed traffic; gh discovery, proxy traffic, MCP and arbitrary shell effects not tracked", deletes: "successful file_delete entries only", jobs: "background shell job IDs; process effects unknown", services: "registered service IDs; process effects unknown", history: "legacy accesses not backfilled" }, ...paging };
		}
		default: throw new TaskError("VIEW_INVALID", "该任务视图不可用");
	}
}
