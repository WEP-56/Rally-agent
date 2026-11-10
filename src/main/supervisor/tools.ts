// Main-agent task tools (docs 02 §2.2) and worker report tools (docs 02 §3.9).
// Validation lives here; the store only records facts.

import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { AgentToolResult, ToolDefinition } from "@rally/coding-agent";
import { type Static, Type } from "typebox";
import type { Quote, QuoteRef, ReportState, TaskBoard } from "../../shared/task.ts";
import { taskView } from "../../shared/task.ts";
import { ensureDir, normalizePath, resolveScope, TaskError, type TaskStore } from "./task-store.ts";
import { page, readTask, TaskReadSchema, type TaskReadParams } from "./task-read.ts";

/** What task tools may ask the supervisor to do. Keeps the tools free of Pi/Electron imports. */
export interface TaskToolHost {
	readonly store: TaskStore;
	readonly workspaceDir: string;
	autoApprove(): boolean;
	quote(ref: QuoteRef): Quote | null;
	tick(): void;
	deliverSteer(taskId: string, text: string): InputDelivery;
	deliverAnswer(taskId: string, text: string): InputDelivery;
	abortWorker(taskId: string): void;
	board(): TaskBoard;
}

export type InputDelivery = "queued_with_first_message" | "steered" | "woke_worker" | "queued_for_worker";

function dispatchState(task: Parameters<typeof taskView>[0]) {
	return { taskId: task.id, status: taskView(task).status, approval: task.approval.state, queuedReason: task.queue?.reason, outputDir: task.outputDir };
}

export function createMainTaskTools(host: TaskToolHost): ToolDefinition[] {
	return [
		dispatchTool(host),
		approveTool(host),
		updateTool(host),
		steerTool(host),
		answerTool(host),
		resumeTool(host),
		cancelTool(host),
		readTool(host),
	];
}

function result(text: string, details: Record<string, unknown> = {}): AgentToolResult<Record<string, unknown>> {
	return { content: [{ type: "text", text }], details };
}

function fail(message: string): AgentToolResult<Record<string, unknown>> {
	return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
}

/** Freeze every input reference; any missing/non-user id rejects the whole call. */
function freezeQuotes(host: TaskToolHost, refs: QuoteRef[]): Quote[] {
	if (refs.length === 0) throw new TaskError("QUOTE_REQUIRED", "必须引用用户原话（至少一条）");
	return refs.map((ref) => {
		const quote = host.quote(ref);
		if (!quote) throw new TaskError("QUOTE_INVALID", `引用 ${ref.id} 不存在或不是用户消息`);
		return quote;
	});
}

const QuoteRefSchema = Type.Object({
	id: Type.String({ description: 'chat line id such as "#1203"' }),
	withProposal: Type.Optional(
		Type.Boolean({ description: "also quote the main agent's confirmed proposal before it" }),
	),
});

const NoteSchema = Type.String({ description: "Routing background or explicit user constraints only, <= 30 words. No requirements, implementation steps, or acceptance criteria." });

function checkNote(note?: string): void {
	if (countWords(note ?? "") > 30) throw new TaskError("NOTE_TOO_LONG", "备注超过 30 个词");
}

function dispatchTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({
		title: Type.String({ description: "short task title, <= 40 chars" }),
		quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
		note: Type.Optional(NoteSchema),
		cwd: Type.String({ description: "Explicit absolute worker working directory chosen by the router from the user's request and current directory context." }),
		mode: Type.Union([Type.Literal("write"), Type.Literal("readonly")]),
		scope: Type.Optional(
			Type.Array(Type.String(), { description: "paths this task will write; overlap only warns" }),
		),
		dependsOn: Type.Optional(Type.Array(Type.String())),
	});
	type Params = Static<typeof schema>;
	return {
		name: "task_dispatch",
		label: "派发任务",
		description: "Create and dispatch a task. Quotes are required; write-scope overlap only returns a warning.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const quotes = freezeQuotes(host, params.quotes);
				const title = params.title.trim();
				if (!title) return fail("TITLE_REQUIRED: 标题不能为空");
				if ([...title].length > 40) return fail("TITLE_TOO_LONG: 标题超过 40 字");
				if (countWords(params.note ?? "") > 30) return fail("NOTE_TOO_LONG: 备注超过 30 个词");
				const dispatchKey = JSON.stringify([[...new Set(quotes.map((quote) => quote.messageId))].sort(), title]);
				const duplicate = host.store.list().find((task) => task.dispatchKey === dispatchKey && Date.now() - task.createdAt >= 0 && Date.now() - task.createdAt < 60000);
				if (duplicate) return result(JSON.stringify({ ...dispatchState(duplicate), reused: true }), { taskId: duplicate.id, reused: true });
				if (!params.cwd || !isAbsolute(params.cwd)) return fail("CWD_REQUIRED: router 必须明确指定 worker 的绝对工作目录");
				const base = host.workspaceDir;
				const cwd = normalizePath(params.cwd, base);
				if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return fail(`CWD_NOT_FOUND: ${cwd}`);
				const dependsOn = params.dependsOn ?? [];
				for (const id of dependsOn) {
					if (!host.store.get(id)) return fail(`DEP_NOT_FOUND: ${id} 不存在`);
				}
				if (detectCycle(host.store, dependsOn, new Set())) return fail("DEP_CYCLE: 依赖成环");
				const scope = resolveScope(params.scope, cwd);
				const task = host.store.create({
					dispatchKey,
					title,
					quotes,
					note: params.note?.trim(),
					cwd,
					scope,
					mode: params.mode,
					dependsOn,
					autoApprove: host.autoApprove(),
				});
				const taskId = task.task.id;
				ensureDir(task.task.outputDir);
				const warnings = task.warnings.map(
					(warning) =>
						`${warning.withTaskId} 正在写 ${warning.paths.join("、")}，与本任务 scope 重叠（仍会并行，请确认是否需要串行）`,
				);
				host.tick();
				return result(
					JSON.stringify({
						...dispatchState(task.task),
						warnings,
					}),
					{ taskId, warnings: warnings.length },
				);
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function approveTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({ taskId: Type.String(), quotes: Type.Array(QuoteRefSchema, { minItems: 1 }) });
	type Params = Static<typeof schema>;
	return {
		name: "task_approve",
		label: "批准任务",
		description: "Approve a pending task on the user's explicit instruction. Quotes are required.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				const quotes = freezeQuotes(host, params.quotes);
				host.store.approve(
					params.taskId,
					"main",
					quotes.map((quote) => quote.messageId),
				);
				host.tick();
				return result(
					JSON.stringify({
						taskId: params.taskId,
						status: taskView(task).status,
						approval: "approved",
						basis: quotes.map((quote) => quote.messageId),
					}),
				);
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function updateTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({
		taskId: Type.String(),
		quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
		title: Type.Optional(Type.String()),
		note: Type.Optional(NoteSchema),
		cwd: Type.Optional(Type.String()),
		mode: Type.Optional(Type.Union([Type.Literal("write"), Type.Literal("readonly")])),
		scope: Type.Optional(Type.Array(Type.String())),
		dependsOn: Type.Optional(Type.Array(Type.String())),
	});
	type Params = Static<typeof schema>;
	return {
		name: "task_update",
		label: "修改任务",
		description: "Edit a task that has not started. Quotes are required as the basis.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				freezeQuotes(host, params.quotes);
				checkNote(params.note);
				const patch: Parameters<TaskStore["update"]>[1] = {};
				if (params.title !== undefined) {
					if (!params.title.trim() || [...params.title.trim()].length > 40) return fail("TITLE_INVALID: 标题须为 1–40 字");
					patch.title = params.title.trim();
				}
				if (params.note !== undefined) patch.note = params.note;
				if (params.cwd !== undefined) {
					if (!isAbsolute(params.cwd)) return fail("CWD_REQUIRED: router 必须明确指定 worker 的绝对工作目录");
					const base = host.workspaceDir;
					const cwd = normalizePath(params.cwd, base);
					if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return fail(`CWD_NOT_FOUND: ${cwd}`);
					patch.cwd = cwd;
				}
				if (params.mode !== undefined) patch.mode = params.mode;
				if (params.scope !== undefined) patch.scope = resolveScope(params.scope, patch.cwd ?? task.cwd);
				if (params.dependsOn !== undefined) {
					for (const id of params.dependsOn) if (!host.store.get(id)) return fail(`DEP_NOT_FOUND: ${id}`);
					if (detectCycle(host.store, params.dependsOn, new Set([task.id]))) return fail("DEP_CYCLE: 依赖成环");
					patch.dependsOn = params.dependsOn;
				}
				const updated = host.store.update(params.taskId, patch);
				const warnings = host.store.warnOverlaps(params.taskId, "update");
				return result(
					JSON.stringify({ taskId: params.taskId, title: updated.title, status: taskView(updated).status, warnings }),
				);
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function steerTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({
		taskId: Type.String(),
		quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
		note: Type.Optional(NoteSchema),
	});
	type Params = Static<typeof schema>;
	return {
		name: "task_steer",
		label: "给任务追加指令",
		description: "Add the user's instruction to an open task. The worker picks it up before its next model call.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				const quotes = freezeQuotes(host, params.quotes);
				checkNote(params.note);
				host.store.steer(params.taskId, quotes, undefined, params.note);
				const delivery = host.deliverSteer(params.taskId, formatInput(quotes, params.note));
				return result(JSON.stringify({ taskId: params.taskId, delivery }));
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function answerTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({
		taskId: Type.String(),
		questionId: Type.String(),
		quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
		note: Type.Optional(NoteSchema),
	});
	type Params = Static<typeof schema>;
	return {
		name: "task_answer",
		label: "回答任务问题",
		description: "Answer the task's pending question. Quote the user's message as the basis.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				if (!task.attention) return fail("NO_QUESTION: 该任务没有待回答的问题");
				if (task.attention.id !== params.questionId || task.attention.answer) return fail("QUESTION_STALE: 问题已被回答或替换");
				const quotes = freezeQuotes(host, params.quotes);
				checkNote(params.note);
				const questionId = task.attention.id;
				const body = formatInput(quotes, params.note);
				host.store.answerAttention(
					params.taskId,
					questionId,
					body,
					"main",
					quotes.map((quote) => quote.messageId),
				);
				const delivery = host.deliverAnswer(params.taskId, body);
				return result(JSON.stringify({ taskId: params.taskId, questionId, delivery }));
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function resumeTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({
		taskId: Type.String(),
		quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
		note: Type.Optional(NoteSchema),
		mode: Type.Optional(Type.Union([Type.Literal("write"), Type.Literal("readonly")])),
		scope: Type.Optional(Type.Array(Type.String())),
	});
	type Params = Static<typeof schema>;
	return {
		name: "task_resume",
		label: "续接任务",
		description: "Continue an ended, interrupted or blocked task in the same session as a new run, subject to global approval.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				const quotes = freezeQuotes(host, params.quotes);
				checkNote(params.note);
				const scope = params.scope ? resolveScope(params.scope, task.cwd) : undefined;
				const nextRun = task.runs.length + 1;
				host.store.resume(params.taskId, { note: params.note, quotes, mode: params.mode, scope, autoApprove: host.autoApprove() });
				const warnings = host.store.warnOverlaps(params.taskId, "resume");
				host.tick();
				return result(JSON.stringify({ taskId: params.taskId, runN: nextRun, status: taskView(task).status, approval: task.approval.state, warnings }));
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function cancelTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({
		taskId: Type.String(),
		quotes: Type.Array(QuoteRefSchema, { minItems: 1 }),
		reason: Type.Optional(Type.String()),
	});
	type Params = Static<typeof schema>;
	return {
		name: "task_cancel",
		label: "取消任务",
		description: "Cancel a task on the user's explicit instruction. Quotes are required.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				if (task.ended && task.ended.outcome !== "cancelled") return fail("TASK_ENDED: 任务已结束，不能更改为取消");
				const quotes = freezeQuotes(host, params.quotes);
				host.store.cancelRunning(params.taskId, "main", { actor: "main", basis: quotes.map((quote) => quote.messageId) });
				host.abortWorker(params.taskId);
				host.tick();
				const affected = host.store.list().filter((item) => item.queue?.reason === "dependency_failed" && item.queue.holder === task.id)
					.map((item) => ({ taskId: item.id, status: "dependency_failed" }));
				return result(JSON.stringify({ taskId: params.taskId, outcome: "cancelled", affected, coverage: { jobs: "not_implemented" } }));
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function readTool(host: TaskToolHost): ToolDefinition {
	return {
		name: "task_read",
		label: "读取任务",
		description: "Read board/card/report/runs/files/timeline. Defaults to board without taskId, otherwise card. offset/limit page lists (20 by default, max 100). Never returns worker transcripts. Files includes observed file-tool access and shell cwd/command; shell effects remain unknown; see coverage for gaps.",
		parameters: TaskReadSchema,
		async execute(_toolCallId: string, params: TaskReadParams) {
			try {
				const view = params.view ?? (params.taskId ? "card" : "board");
				if (view === "board") {
					const board = host.board();
					const { items, ...paging } = page(board.tasks.map(({ toolCalls: _toolCalls, assistantMessages: _assistantMessages, ...card }) => card), params);
					return result(JSON.stringify({ tasks: items, active: board.active, limit: board.limit, ...paging }));
				}
				if (!params.taskId) return fail("TASK_NOT_FOUND: 该视图需要 taskId");
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				return result(JSON.stringify(readTask(host.store, task, params)));
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

/** Worker-side tools: report progress/questions/end states, and read only its own upstream tasks. */
export interface WorkerToolHost {
	report(
		state: ReportState,
		summary: string,
		question?: string | null,
		options?: string[],
	): { taskId: string; ended: boolean; notifiedMain: boolean; attentionId?: string; answer?: string };
	store: TaskStore;
	taskId: string;
	dependsOn: string[];
}

export function createWorkerTools(host: WorkerToolHost): ToolDefinition[] {
	const reportSchema = Type.Object({
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
	});
	type ReportParams = Static<typeof reportSchema>;
	const report: ToolDefinition = {
		name: "task_report",
		label: "汇报",
		description:
			"Report to the supervisor. ready/failed/dropped end the task; blocked asks the user; progress keeps working.",
		parameters: reportSchema,
		async execute(_toolCallId: string, params: ReportParams) {
			try {
				if (params.options && typeof params.question !== "string") return fail("OPTIONS_INVALID: options 仅在 question 为字符串时有效");
				const outcome = host.report(params.state, params.summary, params.question, params.options);
				const note =
					params.state === "ready"
						? "任务已结束为完成。不要再调用工具，直接用一句话收尾。"
						: params.state === "blocked"
							? "已上报阻塞；本轮结束时不再继续调用工具。"
							: params.state === "failed" || params.state === "dropped"
								? "任务已结束。不要再调用工具。"
								: "已记录进展，继续工作。";
				return result(JSON.stringify({ ...outcome, recorded: true, taskEnded: outcome.ended }), { note });
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
	const read: ToolDefinition = {
		name: "task_read",
		label: "读取任务",
		description: "Read card/report/runs/files/timeline for your task (default) or direct upstream tasks, with offset/limit paging. Board and unrelated tasks are not visible. Files records observed file-tool access; shell effects and other gaps are explicit in coverage.",
		parameters: TaskReadSchema,
		async execute(_toolCallId: string, params: TaskReadParams) {
			try {
				if (params.view === "board") return fail("NOT_VISIBLE: worker 不能读取全局任务板");
				const target = params.taskId ?? host.taskId;
				if (target !== host.taskId && !host.dependsOn.includes(target)) {
					return fail("NOT_VISIBLE: 该任务不在你的可见范围");
				}
				const task = host.store.get(target);
				if (!task) return fail(`TASK_NOT_FOUND: ${target}`);
				return result(JSON.stringify(readTask(host.store, task, params)));
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
	return [report, read];
}

function formatInput(quotes: Quote[], note = ""): string {
	const said = quotes.map((quote) => `[${quote.messageId}]\n> ${quote.text.replace(/\n/g, "\n> ")}`).join("\n\n");
	return note ? `${said}\n\nRouting note: ${note}` : said;
}

function detectCycle(store: TaskStore, ids: string[], seen: Set<string>): boolean {
	for (const id of ids) {
		if (seen.has(id)) return true;
		const task = store.get(id);
		if (!task) continue;
		seen.add(id);
		if (detectCycle(store, task.dependsOn, seen)) return true;
		seen.delete(id);
	}
	return false;
}

function countWords(text: string): number {
	if (!text.trim()) return 0;
	try {
		return [...new Intl.Segmenter("zh", { granularity: "word" }).segment(text)].filter((part) => part.isWordLike)
			.length;
	} catch {
		return text.trim().split(/\s+/).length;
	}
}

function messageOf(error: unknown): string {
	if (error instanceof TaskError) return `${error.code}: ${error.message}`;
	return error instanceof Error ? error.message : String(error);
}
