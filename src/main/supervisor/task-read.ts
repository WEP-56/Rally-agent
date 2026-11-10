import { Type, type Static } from "typebox";
import type { Task } from "../../shared/task.ts";
import { taskView } from "../../shared/task.ts";
import { TaskError, type TaskStore } from "./task-store.ts";

export const TaskReadSchema = Type.Object({
	taskId: Type.Optional(Type.String()),
	view: Type.Optional(Type.Union([Type.Literal("board"), Type.Literal("card"), Type.Literal("report"), Type.Literal("runs"), Type.Literal("files"), Type.Literal("timeline"), Type.Literal("services")])),
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

export function readTask(store: TaskStore, task: Task, params: TaskReadParams): Record<string, unknown> {
	// Validate even scalar views: direct callers must obey the same contract as schema-validated calls.
	page([], params);
	switch (params.view ?? "card") {
		case "card": return { card: taskView(task), outputDir: task.outputDir };
		case "report": return { report: task.runs.findLast((run) => run.lastReport)?.lastReport ?? null, attention: task.attention?.answer ? null : task.attention ?? null, gates: task.gates?.filter((gate) => !gate.decision) ?? [], changedFiles: task.changedFiles ?? [] };
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
				coverage: { writes: "successful write/edit only", reads: "successful read/grep/find/ls only", git: "attempted repository command scope; not exact changed files", shell: "unknown", network: "git fetch/pull/push resolved remote hosts only; attempts, not confirmed traffic", deletes: "successful file_delete entries only", jobs: "background shell job IDs; process effects unknown", services: "registered service IDs; process effects unknown", history: "legacy accesses not backfilled" }, ...paging };
		}
		default: throw new TaskError("VIEW_INVALID", "该任务视图不可用");
	}
}
