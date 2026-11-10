// Task domain shared by the supervisor and the renderer (docs 01 section 2 / 3).
// Facts only: approval, runs, reports, attention, gates, endings. Display status is derived.
import type { ToolCall } from "./tools.ts";
import type { AssistantMessageView } from "./conversation.ts";
import type { TaskGate } from "./gate.ts";

export type TaskMode = "write" | "readonly";
export type ReportState = "progress" | "ready" | "blocked" | "failed" | "dropped";
export type TaskOutcome = "done" | "failed" | "dropped" | "cancelled";
export type QueueReason = "dependency_failed" | "dependency" | "capacity";

/** Frozen copy of a user message (or a confirmed main-agent proposal). */
export interface Quote {
	messageId: string;
	kind: "user" | "proposal";
	text: string;
	at: number;
	attachments?: { path: string; mime: string }[];
}

/** What the model passes to "needs a quote" tools. */
export interface QuoteRef {
	id: string;
	withProposal?: boolean;
}

export interface TaskRun {
	id: string;
	n: number;
	trigger: "dispatch" | "resume" | "recovery";
	model: string;
	startedAt: number;
	endedAt?: number;
	endReason?: "ready" | "failed" | "dropped" | "cancelled" | "interrupted" | "stalled" | "blocked";
	lastReport?: { state: ReportState; summary: string; at: number };
}

export type TaskInputKind = "steer" | "answer" | "resume" | "upstream" | "job_done" | "gate_result" | "nudge";

export interface TaskInput {
	id: string;
	kind: TaskInputKind;
	quotes?: Quote[];
	note?: string;
	body?: string;
	questionId?: string;
	at: number;
	deliveredAt?: number;
	readAt?: number;
}

export interface TaskAttention {
	id: string;
	question: string;
	options?: string[];
	runId: string;
	askedAt: number;
	escalatedAt?: number;
	answer?: { by: "main" | "user"; basis: string[]; text: string; at: number };
	closed?: { reason: "replaced" | "cleared" | "task_ended" | "run_ended"; at: number };
}

export interface TaskUsage {
	/** All input tokens, including cache reads and writes. */
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	costUsd?: number;
	/** Some requests have no price/billing data; costUsd then covers only known requests. */
	costIncomplete?: boolean;
	toolCalls: number;
}

/** Observed tool access, never inferred by parsing shell commands. */
export interface TaskAccess {
	toolCallId: string;
	runId: string;
	tool: string;
	at: number;
	kind: "fs_read" | "fs_write" | "fs_delete" | "shell" | "net";
	target: string;
	created?: boolean;
	command?: string;
	/** A Git repository scope is not an exact changed file. */
	coverage?: "command_scope";
	outcome?: "attempt";
}

export interface Task {
	id: string;
	title: string;
	quotes: Quote[];
	note?: string;
	cwd: string;
	/** Declared write paths (04 §2.2). Overlap only warns; it never queues or blocks. */
	scope: string[];
	mode: TaskMode;
	outputDir: string;
	dependsOn: string[];
	createdAt: number;
	updatedAt: number;
	approval: {
		state: "pending" | "approved" | "cancelled";
		by?: "auto" | "button" | "main";
		basis?: string[];
		at?: number;
	};
	runs: TaskRun[];
	inputs: TaskInput[];
	attention?: TaskAttention;
	attentionHistory?: TaskAttention[];
	gates?: TaskGate[];
	lastExternalAction?: { tool: string; at: number };
	ended?: { at: number; outcome: TaskOutcome; by: "worker" | "main" | "system"; reason?: string };
	usage: TaskUsage;
	/** Files touched by tools, collected from tool events (04 §2.2). */
	changedFiles?: string[];
	dispatchKey?: string;
	/** Derived queue facts, written by the scheduler. */
	queue?: { reason: QueueReason; holder?: string };
}

export interface TaskView {
	durationMs: number;
	assistantMessages?: AssistantMessageView[];
	toolCalls?: ToolCall[];
	id: string;
	title: string;
	status: TaskDisplayStatus;
	statusText: string;
	mode: TaskMode;
	cwd: string;
	scope: string[];
	quotes: Quote[];
	note?: string;
	createdAt: number;
	dependsOn: string[];
	updatedAt: number;
	approval: Task["approval"];
	queue?: Task["queue"];
	attention?: TaskAttention;
	attentionHistory?: TaskAttention[];
	gates?: TaskGate[];
	lastExternalAction?: Task["lastExternalAction"];
	lastReport?: { state: ReportState; summary: string; at: number };
	ended?: Task["ended"];
	changedFiles?: string[];
	usage: TaskUsage;
}

export type TaskDisplayStatus =
	| "cancelled"
	| "done"
	| "dropped"
	| "failed"
	| "needs_gate"
	| "needs_answer"
	| "interrupted"
	| "blocked"
	| "pending_approval"
	| "queued"
	| "running";

/** Tasks the board shows: open ones plus the most recent ended ones. */
export interface TaskBoard {
	tasks: TaskView[];
	/** Main-chat question records outlive the board's 20-ended-task window. */
	questions?: TaskQuestionView[];
	active: number;
	limit: number;
	autoApprove: boolean;
}

export interface TaskQuestionView {
	taskId: string;
	title: string;
	question: TaskAttention;
}

export function questionViews(task: Pick<Task, "id" | "title" | "attention" | "attentionHistory">): TaskQuestionView[] {
	return [...(task.attentionHistory ?? []), ...(task.attention ? [task.attention] : [])]
		.filter((question) => question.escalatedAt !== undefined || question.answer)
		.map((question) => ({ taskId: task.id, title: task.title, question }));
}

/** Derive the coarse status exactly as docs 01 section 3 orders the table. */
export function taskView(task: Task, now = Date.now()): TaskView {
	const lastRun = task.runs[task.runs.length - 1];
	const { status, statusText } = derive(task, lastRun, now);
	return {
		durationMs: task.runs.reduce((total, run) => total + Math.max(0, (run.endedAt ?? task.ended?.at ?? now) - run.startedAt), 0),
		id: task.id,
		title: task.title,
		status,
		statusText,
		mode: task.mode,
		cwd: task.cwd,
		scope: task.scope,
		quotes: task.quotes,
		note: task.note,
		dependsOn: task.dependsOn,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		approval: task.approval,
		queue: task.queue,
		gates: task.gates,
		lastExternalAction: task.lastExternalAction,
		attention: task.attention,
		attentionHistory: task.attentionHistory,
		lastReport: lastRun?.lastReport,
		ended: task.ended,
		changedFiles: task.changedFiles,
		usage: task.usage,
	};
}

function derive(
	task: Task,
	lastRun: TaskRun | undefined,
	now: number,
): { status: TaskDisplayStatus; statusText: string } {
	if (task.ended) {
		switch (task.ended.outcome) {
			case "cancelled":
				return { status: "cancelled", statusText: "已取消" };
			case "done":
				return { status: "done", statusText: `已完成 · ${clock(task.ended.at)}` };
			case "dropped":
				return { status: "dropped", statusText: "无需处理" };
			case "failed":
				return { status: "failed", statusText: "失败" };
		}
	}
	const gate = task.gates?.find((item) => !item.decision);
	if (gate) return { status: "needs_gate", statusText: `${gate.escalatedAt ? "等你确认" : "等待主 agent 确认"} · ${gate.id}` };
	if (task.attention?.escalatedAt && !task.attention.answer) {
		return { status: "needs_answer", statusText: `等你回答 · ${task.attention.id}` };
	}
	const hasResume = lastRun?.endedAt !== undefined && task.inputs.some((input) => input.kind === "resume" && input.at >= lastRun.endedAt!);
	if (lastRun?.endReason === "interrupted" && !hasResume) {
		return { status: "interrupted", statusText: "因 Rally 重启中断" };
	}
	if (lastRun?.lastReport?.state === "blocked" && !lastRun.endedAt) {
		const after = task.inputs.filter((input) => input.at > (lastRun.lastReport?.at ?? 0)).length;
		if (after === 0) return { status: "blocked", statusText: "受阻" };
	}
	if (task.approval.state === "pending") return { status: "pending_approval", statusText: "待批准" };
	if (task.queue) {
		const reason =
			task.queue.reason === "dependency_failed"
				? "上游失败"
				: task.queue.reason === "dependency"
					? "等待上游完成"
					: "等待空闲名额";
		return { status: "queued", statusText: `排队中 · ${reason}` };
	}
	const elapsed = lastRun && !lastRun.endedAt ? now - lastRun.startedAt : undefined;
	return {
		status: "running",
		statusText: elapsed === undefined ? "进行中" : `进行中 · ${Math.max(1, Math.round(elapsed / 60000))} 分钟`,
	};
}

function clock(at: number): string {
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
