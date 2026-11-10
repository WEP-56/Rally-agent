// Supervisor assembly: EventLog + task facts + scheduler + worker sessions + relay (docs 01 §4).
// The single writer is this process; renderers only mirror what it broadcasts.

import type { ChatEvent, RallyPaths, TaskEvent } from "../../shared/ipc.ts";
import type { WorkspaceState } from "../../shared/workspace.ts";
import { type QuoteRef, type ReportState, type Task, type TaskBoard, type TaskRun, taskView } from "../../shared/task.ts";
import { ModelStore } from "../model-store.ts";
import { WorkspaceStore } from "../workspace-store.ts";
import { MemoryStore } from "../memory-store.ts";
import { createMemoryTools } from "./memory-tools.ts";
import { createRouterReadTools } from "./router-tools.ts";
import { EventLog } from "./event-log.ts";
import { MainAgent } from "./main-agent.ts";
import { Relay } from "./relay.ts";
import { Scheduler } from "./scheduler.ts";
import { TaskStore } from "./task-store.ts";
import { createMainTaskTools, createWorkerTools, type TaskToolHost, type WorkerToolHost } from "./tools.ts";
import { type ReportResult, WorkerManager } from "./worker.ts";
import { GateService } from "./gates.ts";
import { AuditLog } from "./audit.ts";
import { createGateTools } from "./gate-tools.ts";
import { join } from "node:path";
import { createGitInspectTool } from "./git-inspect.ts";

export interface SupervisorOptions {
	emitChat(event: ChatEvent): void;
	emitTask(event: TaskEvent): void;
	emitWorkspace?(state: WorkspaceState): void;
	/** Slot limit; settings will drive this later (docs 04 §3.2). */
	limit?: number;
}

export class Supervisor {
	readonly paths: RallyPaths;
	readonly events: EventLog;
	readonly store: TaskStore;
	readonly models: ModelStore;
	readonly workspace: WorkspaceStore;
	readonly memory: MemoryStore;
	readonly main: MainAgent;
	readonly workers: WorkerManager;
	readonly relay: Relay;
	readonly scheduler: Scheduler;
	readonly gates: GateService;
	readonly audit: AuditLog;

	private readonly options: SupervisorOptions;
	private autoApprove = false;
	private disposed = false;
	private disposal?: Promise<void>;

	constructor(paths: RallyPaths, options: SupervisorOptions) {
		this.paths = paths;
		this.options = options;
		this.events = new EventLog(paths.eventsFile);
		this.audit = new AuditLog(paths.auditFile, this.events);
		this.memory = new MemoryStore(paths.home, paths.memoryFile, this.events, this.audit);
		this.workspace = new WorkspaceStore(paths.home, paths.workspaceDir);
		const approval = this.events.ofKind("approval_mode").at(-1);
		this.autoApprove = approval?.data.enabled === true;
		this.store = new TaskStore(this.events, () => this.workspace.state().defaultWorkspace, (task, kind) => this.onStoreChange(task, kind), this.audit);
		this.models = new ModelStore(paths.modelsFile);
		this.gates = new GateService({ store: this.store, audit: this.audit, events: this.events,
			quote: (ref) => this.main.quote(ref), requested: () => this.relay.captureSources(),
			notice: () => this.relay.captureSources() });
		this.main = new MainAgent(paths, this.events, options.emitChat, {
			models: this.models,
			customTools: [...createMemoryTools(this.memory, (ref) => this.main.quote(ref), () => !this.disposed), ...createRouterReadTools(() => this.workspace.base()), createGitInspectTool(() => this.workspace.base(), join(paths.stateDir, "tool-output", "main")), ...createMainTaskTools(this.host()), ...createGateTools(this.gates, this.store)],
			memory: () => this.memory.context(),
			workspace: () => this.workspace.state(),
			onRelayRead: (ids) => this.relay.consumed(ids),
			onAvailable: () => this.relay?.available(),
			onSettled: (aborted) => {
				if (this.disposed) return;
				this.gates.fallback(this.relay.takeDeliveredGates());
				this.store.fallbackQuestions(this.relay.takeDeliveredQuestions());
				this.relay.settled(aborted);
			},
		});
		this.relay = new Relay(this.main, this.events, this.store);
		this.workers = new WorkerManager({
			paths,
			store: this.store,
			models: this.models,
			gates: this.gates,
			audit: this.audit,
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
			onDependencyFailed: () => this.relay.captureSources(),
		});
	}

	async start(): Promise<void> {
		await this.main.start();
		if (this.disposed) return;
		this.recoverInterrupted();
		this.relay.start();
		this.scheduler.tick();
	}

	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		this.scheduler.dispose();
		this.relay.dispose();
		this.gates.dispose();
		this.disposal = Promise.all([this.workers.dispose(), this.main.dispose()]).then(() => {});
		return this.disposal;
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
		this.store.approve(taskId, "button", []);
		this.scheduler.tick();
		return this.board();
	}

	/** Button cancel: a direct control action, but it still ends the task as cancelled. */
	cancel(taskId: string): TaskBoard {
		this.store.cancelRunning(taskId, "main", { actor: "user", basis: [] });
		void this.workers.abort(taskId);
		this.scheduler.tick();
		return this.board();
	}

	/** Buttons may return only one of this question's frozen options. */
	answerOption(taskId: string, questionId: string, option: string): TaskBoard {
		if (this.disposed) throw new TaskErrorLike("QUESTION_STALE", "Rally 正在关闭");
		this.store.answerAttention(taskId, questionId, option, "user", []);
		this.deliverInput(taskId, option);
		return this.board();
	}

	private onStoreChange(task: Task, kind: string): void {
		if (["task_report", "gate_requested", "task_queued", "task_approved", "attention_answered", "gate_decided"].includes(kind)) this.relay?.captureSources();
		if (kind === "task_ended") this.gates?.closeTask(task.id, "Task ended.");
		if (kind === "run_started") {
			try { const state = this.workspace.recordProject(task.cwd); this.options.emitWorkspace?.(state); }
			catch (error) { this.main.addSystemLine(`最近项目记录失败：${String(error)}`); }
		}
		this.options.emitTask({ type: "task", task: this.store.view(task) });
		if (kind === "task_created" || kind === "task_approved" || kind === "task_updated" || kind === "task_ended")
			this.scheduler?.tick();
	}

	private async startRun(task: Task, run: TaskRun): Promise<void> {
		if (this.disposed) return;
		try {
			const warnings = this.store.warnOverlaps(task.id, "start");
			if (warnings.length) this.main.addSystemLine(`${task.id} 写范围重叠：${warnings.map((item) => `${item.withTaskId} · ${item.paths.join("、")}`).join("；")}（仍会启动）`);
			await this.workers.start(task, run);
		} catch (error) {
			if (this.disposed || task.ended || run.endedAt) return;
			const message = error instanceof Error ? error.message : String(error);
			this.store.report(task.id, run.id, "failed", message);
			this.scheduler.tick();
		}
	}

	private onWorkerReport(
		task: Task,
		runId: string,
		state: ReportState,
		summary: string,
		question?: string | null,
		options?: string[],
	): ReportResult {
		const result = this.store.report(task.id, runId, state, summary, question, options);
		this.workers.noteReport(task.id, state);
		const notifiedMain = result.attentionOpened || (!result.attention && state !== "progress");
		this.scheduler.tick();
		return { taskId: task.id, ended: result.ended, notifiedMain, attentionId: result.attention?.id, answer: result.attention?.answer?.text };
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
		const workspace = this.workspace;
		return {
			store: this.store,
			get workspaceDir() { return workspace.state().defaultWorkspace; },
			autoApprove: () => this.autoApprove,
			quote: (ref: QuoteRef) => this.main.quote(ref),
			tick: () => this.scheduler.tick(),
			deliverSteer: (taskId: string, text: string) => {
				return this.deliverInput(taskId, text);
			},
			deliverAnswer: (taskId: string, text: string) => {
				return this.deliverInput(taskId, text);
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
			report: (state: ReportState, summary: string, question?: string | null, options?: string[]) => {
				const run = task.runs[task.runs.length - 1];
				if (!run) throw new TaskErrorLike("RUN_NOT_FOUND", "任务还没有运行");
				const result = this.onWorkerReport(task, run.id, state, summary, question, options);
				return result;
			},
		};
	}

	private latestInput(taskId: string): string | undefined {
		const task = this.store.get(taskId);
		const pending = task?.inputs.filter((input) => !input.deliveredAt);
		return pending?.[pending.length - 1]?.id;
	}

	private deliverInput(taskId: string, text: string) {
		const task = this.store.get(taskId);
		const inputId = this.latestInput(taskId);
		const firstMessage = !task?.runs.length;
		if (this.workers.deliver(taskId, text, inputId)) return "steered" as const;
		this.scheduler.tick();
		if (firstMessage) return "queued_with_first_message" as const;
		return task?.inputs.find((input) => input.id === inputId)?.deliveredAt ? "woke_worker" as const : "queued_for_worker" as const;
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
