// Main-agent task tools (docs 02 §2.2) and worker report tools (docs 02 §3.9).
// Validation lives here; the store only records facts.

import { existsSync, statSync } from "node:fs";
import type { AgentToolResult, ToolDefinition } from "@rally/coding-agent";
import { type Static, Type } from "typebox";
import type { Quote, QuoteRef, ReportState, TaskBoard } from "../../shared/task.ts";
import { taskView } from "../../shared/task.ts";
import { ensureDir, normalizePath, resolveScope, TaskError, type TaskStore } from "./task-store.ts";

/** What task tools may ask the supervisor to do. Keeps the tools free of Pi/Electron imports. */
export interface TaskToolHost {
	readonly store: TaskStore;
	readonly workspaceDir: string;
	currentProject(): string | null;
	autoApprove(): boolean;
	quote(ref: QuoteRef): Quote | null;
	tick(): void;
	deliverSteer(taskId: string, text: string): void;
	deliverAnswer(taskId: string, text: string): void;
	abortWorker(taskId: string): void;
	board(): TaskBoard;
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
		cwd: Type.Optional(Type.String({ description: "working directory; defaults to the current project" })),
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
				const base = host.currentProject() ?? host.workspaceDir;
				const cwd = normalizePath(params.cwd ?? base, base);
				if (!existsSync(cwd) || !statSync(cwd).isDirectory()) return fail(`CWD_NOT_FOUND: ${cwd}`);
				const dependsOn = params.dependsOn ?? [];
				for (const id of dependsOn) {
					if (!host.store.get(id)) return fail(`DEP_NOT_FOUND: ${id} 不存在`);
				}
				if (detectCycle(host.store, dependsOn, new Set())) return fail("DEP_CYCLE: 依赖成环");
				const scope = resolveScope(params.scope, cwd);
				const task = host.store.create({
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
				const view = taskView(task.task);
				const warnings = task.warnings.map(
					(warning) =>
						`${warning.withTaskId} 正在写 ${warning.paths.join("、")}，与本任务 scope 重叠（仍会并行，请确认是否需要串行）`,
				);
				host.tick();
				return result(
					JSON.stringify({
						taskId,
						status: view.status,
						approval: host.autoApprove() ? "approved" : "pending",
						outputDir: task.task.outputDir,
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
					const base = host.currentProject() ?? host.workspaceDir;
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
				return result(
					JSON.stringify({ taskId: params.taskId, title: updated.title, status: taskView(updated).status }),
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
				host.deliverSteer(params.taskId, formatInput(quotes, params.note));
				return result(JSON.stringify({ taskId: params.taskId, state: task.ended ? "ended" : "steered" }));
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
				if (task.attention.id !== params.questionId) return fail("QUESTION_STALE: 问题已被替换");
				const quotes = freezeQuotes(host, params.quotes);
				checkNote(params.note);
				const questionId = task.attention.id;
				const body = formatInput(quotes, params.note);
				host.store.answerAttention(
					params.taskId,
					body,
					"main",
					quotes.map((quote) => quote.messageId),
				);
				host.deliverAnswer(params.taskId, body);
				return result(JSON.stringify({ taskId: params.taskId, questionId }));
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
				host.tick();
				return result(JSON.stringify({ taskId: params.taskId, run: nextRun, approval: task.approval.state }));
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
				freezeQuotes(host, params.quotes);
				host.abortWorker(params.taskId);
				host.store.cancelRunning(params.taskId, "main");
				host.tick();
				return result(JSON.stringify({ taskId: params.taskId, state: "cancelled" }));
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
}

function readTool(host: TaskToolHost): ToolDefinition {
	const schema = Type.Object({
		taskId: Type.Optional(Type.String()),
		view: Type.Object({
			card: Type.Optional(Type.Boolean()),
			report: Type.Optional(Type.Boolean()),
			runs: Type.Optional(Type.Boolean()),
			otherTasks: Type.Optional(Type.Boolean()),
			files: Type.Optional(Type.Boolean()),
		}),
		limit: Type.Optional(Type.Number()),
	});
	type Params = Static<typeof schema>;
	return {
		name: "task_read",
		label: "读取任务",
		description: "Read task state, the last worker report, runs, or the whole board.",
		parameters: schema,
		async execute(_toolCallId: string, params: Params) {
			try {
				const view = params.view;
				if (view.otherTasks) {
					const board = host.board();
					const limit = Math.max(1, Math.min(params.limit ?? 10, 30));
					return result(
						JSON.stringify({ tasks: board.tasks.slice(0, limit), active: board.active, limit: board.limit }),
					);
				}
				if (!params.taskId) return fail("TASK_NOT_FOUND: 需要 taskId 或 view.otherTasks");
				const task = host.store.get(params.taskId);
				if (!task) return fail(`TASK_NOT_FOUND: ${params.taskId}`);
				const payload: Record<string, unknown> = {};
				if (view.card !== false) payload.card = taskView(task);
				if (view.card !== false) {
					payload.note = task.note;
					payload.scope = task.scope;
					payload.outputDir = task.outputDir;
				}
				if (view.report) {
					const lastRun = task.runs[task.runs.length - 1];
					payload.report = lastRun?.lastReport ?? null;
					payload.changedFiles = task.changedFiles ?? [];
				}
				if (view.runs)
					payload.runs = task.runs.map((run) => ({
						id: run.id,
						n: run.n,
						trigger: run.trigger,
						startedAt: run.startedAt,
						endedAt: run.endedAt,
						endReason: run.endReason,
					}));
				if (view.files) payload.changedFiles = task.changedFiles ?? [];
				return result(JSON.stringify(payload));
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
		question?: string,
		options?: string[],
	): { taskId: string; ended: boolean; attentionId?: string };
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
		question: Type.Optional(Type.String()),
		options: Type.Optional(Type.Array(Type.String())),
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
				const outcome = host.report(params.state, params.summary, params.question, params.options);
				const note =
					params.state === "ready"
						? "任务已结束为完成。不要再调用工具，直接用一句话收尾。"
						: params.state === "blocked"
							? "已上报阻塞；本轮结束时不再继续调用工具。"
							: params.state === "failed" || params.state === "dropped"
								? "任务已结束。不要再调用工具。"
								: "已记录进展，继续工作。";
				return result(JSON.stringify(outcome), { note });
			} catch (error) {
				return fail(messageOf(error));
			}
		},
	};
	const readSchema = Type.Object({
		taskId: Type.Optional(Type.String()),
		view: Type.Object({
			card: Type.Optional(Type.Boolean()),
			report: Type.Optional(Type.Boolean()),
			upstream: Type.Optional(Type.Boolean()),
			files: Type.Optional(Type.Boolean()),
		}),
	});
	type ReadParams = Static<typeof readSchema>;
	const read: ToolDefinition = {
		name: "task_read",
		label: "读取任务",
		description: "Read your own task, or the tasks you depend on. Other tasks are not visible.",
		parameters: readSchema,
		async execute(_toolCallId: string, params: ReadParams) {
			try {
				const target = params.taskId ?? host.taskId;
				if (target !== host.taskId && !host.dependsOn.includes(target)) {
					return fail("NOT_VISIBLE: 该任务不在你的可见范围");
				}
				const task = host.store.get(target);
				if (!task) return fail(`TASK_NOT_FOUND: ${target}`);
				const payload: Record<string, unknown> = {};
				if (params.view.card !== false) payload.card = taskView(task);
				if (params.view.report) {
					const lastRun = task.runs[task.runs.length - 1];
					payload.report = lastRun?.lastReport ?? null;
				}
				if (params.view.upstream) {
					payload.upstream = host.dependsOn.map((id) => {
						const upstream = host.store.get(id);
						return upstream
							? { card: taskView(upstream), report: upstream.runs[upstream.runs.length - 1]?.lastReport ?? null }
							: { id, missing: true };
					});
				}
				if (params.view.files) payload.changedFiles = task.changedFiles ?? [];
				return result(JSON.stringify(payload));
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
