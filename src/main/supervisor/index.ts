// Supervisor assembly: EventLog + task facts + scheduler + worker sessions + relay (docs 01 §4).
// The single writer is this process; renderers only mirror what it broadcasts.

import type { ChatEvent, RallyPaths, TaskEvent } from "../../shared/ipc.ts";
import { type QuoteRef, type ReportState, type Task, type TaskBoard, type TaskRun, taskView } from "../../shared/task.ts";
import { ModelStore } from "../model-store.ts";
import { EventLog } from "./event-log.ts";
import { MainAgent } from "./main-agent.ts";
import { Relay } from "./relay.ts";
import { Scheduler } from "./scheduler.ts";
import { TaskStore } from "./task-store.ts";
import { ensureDir } from "./task-store.ts";
import { createMainTaskTools, createWorkerTools, type TaskToolHost, type WorkerToolHost } from "./tools.ts";
import { type ReportResult, WorkerManager } from "./worker.ts";

export interface SupervisorOptions {
	emitChat(event: ChatEvent): void;
	emitTask(event: TaskEvent): void;
	/** Slot limit; settings will drive this later (docs 04 §3.2). */
	limit?: number;
}

export class Supervisor {
	readonly paths: RallyPaths;
	readonly events: EventLog;
	readonly store: TaskStore;
	readonly models: ModelStore;
	readonly main: MainAgent;
	readonly workers: WorkerManager;
	readonly relay: Relay;
	readonly scheduler: Scheduler;

	private readonly options: SupervisorOptions;
	private autoApprove = false;
	private disposed = false;

	constructor(paths: RallyPaths, options: SupervisorOptions) {
		this.paths = paths;
		this.options = options;
		this.events = new EventLog(paths.eventsFile);
		ensureDir(paths.workspaceDir);
		const approval = this.events.ofKind("approval_mode").at(-1);
		this.autoApprove = approval?.data.enabled === true;
		this.store = new TaskStore(this.events, paths.workspaceDir, (task, kind) => this.onStoreChange(task, kind));
		this.models = new ModelStore(paths.modelsFile);
		this.main = new MainAgent(paths, this.events, options.emitChat, {
			models: this.models,
			customTools: createMainTaskTools(this.host()),
		});
		this.relay = new Relay(this.main, this.events);
		this.workers = new WorkerManager({
			paths,
			store: this.store,
			models: this.models,
			createTools: (task) => createWorkerTools(this.workerHost(task)),
			report: (task, runId, state, summary, question, answers) =>
				this.onWorkerReport(task, runId, state, summary, question, answers),
			onBusyChange: () => { if (!this.disposed) this.scheduler.tick(); },
		});
		this.scheduler = new Scheduler({
			store: this.store,
			events: this.events,
			limit: options.limit,
			activeIds: () => this.workers.streamingIds(),
			wakePending: (available) => this.workers.wakePending(available),
			start: (task, run) => this.startRun(task, run),
			onDependencyFailed: (task, upstreamId) => {
				const upstream = this.store.get(upstreamId);
				if (upstream) this.relay.enqueue({ kind: "dependency_failed", task, upstream });
			},
		});
	}

	async start(): Promise<void> {
		await this.main.start();
		const interrupted = this.recoverInterrupted();
		this.scheduler.tick();
		if (interrupted.length > 0) this.relay.enqueue({ kind: "interrupted", tasks: interrupted });
	}

	dispose(): void {
		this.disposed = true;
		this.scheduler.dispose();
		this.relay.dispose();
		this.workers.dispose();
		this.main.dispose();
	}

	board(): TaskBoard {
		return { ...this.store.board(this.workers.streamingCount(), this.scheduler.limit), autoApprove: this.autoApprove };
	}

	setAutoApprove(enabled: boolean): TaskBoard {
		this.autoApprove = enabled;
		this.events.append("approval_mode", { enabled });
		const board = this.board();
		this.options.emitTask({ type: "snapshot", board });
		return board;
	}

	/** Button approval: the user clicked, so no quote is involved (docs 01 §4.1 step 4). */
	approve(taskId: string): TaskBoard {
		this.store.approve(taskId, "button", ["button"]);
		this.relay.notice(`用户已批准 ${taskId}。`);
		this.scheduler.tick();
		return this.board();
	}

	/** Button cancel: a direct control action, but it still ends the task as cancelled. */
	cancel(taskId: string): TaskBoard {
		void this.workers.abort(taskId);
		this.store.cancelRunning(taskId, "main");
		this.scheduler.tick();
		return this.board();
	}

	private onStoreChange(task: Task, kind: string): void {
		this.options.emitTask({ type: "task", task: taskView(task) });
		if (kind === "task_created" || kind === "task_approved" || kind === "task_updated" || kind === "task_ended")
			this.scheduler?.tick();
	}

	private async startRun(task: Task, run: TaskRun): Promise<void> {
		if (this.disposed) return;
		try {
			await this.workers.start(task, run);
		} catch (error) {
			if (this.disposed || task.ended || run.endedAt) return;
			const message = error instanceof Error ? error.message : String(error);
			this.store.report(task.id, run.id, "failed", message);
			this.relay.enqueue({
				kind: "worker_report",
				task: this.store.get(task.id) ?? task,
				state: "failed",
				summary: message,
			});
			this.scheduler.tick();
		}
	}

	private onWorkerReport(
		task: Task,
		runId: string,
		state: ReportState,
		summary: string,
		question?: string,
		options?: string[],
	): ReportResult {
		const result = this.store.report(task.id, runId, state, summary, question, options);
		this.workers.noteReport(task.id, state);
		if (result.attention) {
			this.relay.enqueue({ kind: "worker_question", task: result.task, attention: result.attention });
		} else if (state === "ready" || state === "blocked" || state === "failed" || state === "dropped") {
			this.relay.enqueue({ kind: "worker_report", task: result.task, state, summary });
		}
		this.scheduler.tick();
		return { taskId: task.id, ended: result.ended, attentionId: result.attention?.id };
	}

	private recoverInterrupted(): Task[] {
		const interrupted: Task[] = [];
		for (const task of this.store.list()) {
			if (task.ended) continue;
			const open = task.runs.find((run) => !run.endedAt);
			if (!open) continue;
			this.store.endRunInterrupted(task.id, "interrupted");
			interrupted.push(this.store.get(task.id) ?? task);
		}
		return interrupted;
	}

	private host(): TaskToolHost {
		return {
			store: this.store,
			workspaceDir: this.paths.workspaceDir,
			currentProject: () => null,
			autoApprove: () => this.autoApprove,
			quote: (ref: QuoteRef) => this.main.quote(ref),
			tick: () => this.scheduler.tick(),
			deliverSteer: (taskId: string, text: string) => {
				this.workers.deliver(taskId, text, this.latestInput(taskId));
			},
			deliverAnswer: (taskId: string, text: string) => {
				this.workers.deliver(taskId, text, this.latestInput(taskId));
			},
			abortWorker: (taskId: string) => {
				void this.workers.abort(taskId);
			},
			board: () => this.board(),
		};
	}

	private workerHost(task: Task): WorkerToolHost {
		return {
			store: this.store,
			taskId: task.id,
			dependsOn: task.dependsOn,
			report: (state: ReportState, summary: string, question?: string, options?: string[]) => {
				const run = task.runs[task.runs.length - 1];
				if (!run) throw new TaskErrorLike("RUN_NOT_FOUND", "任务还没有运行");
				const result = this.onWorkerReport(task, run.id, state, summary, question, options);
				return { taskId: result.taskId, ended: result.ended, attentionId: result.attentionId };
			},
		};
	}

	private latestInput(taskId: string): string | undefined {
		const task = this.store.get(taskId);
		const pending = task?.inputs.filter((input) => !input.deliveredAt);
		return pending?.[pending.length - 1]?.id;
	}
}

/** Small local error so worker tools keep the same code-style failures as TaskError. */
export class TaskErrorLike extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(`${code}: ${message}`);
		this.code = code;
	}
}
