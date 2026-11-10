import { managedModelConfigValue } from "./model-config-value.ts";
// Supervisor assembly: EventLog + task facts + scheduler + worker sessions + relay (docs 01 §4).
// The single writer is this process; renderers only mirror what it broadcasts.

import type { ChatEvent, RallyPaths, TaskEvent } from "../../shared/ipc.ts";
import type { WorkspaceState } from "../../shared/workspace.ts";
import { type QuoteRef, type ReportState, type Task, type TaskBoard, type TaskRun, taskView } from "../../shared/task.ts";
import { ModelStore } from "../model-store.ts";
import { WorkspaceStore } from "../workspace-store.ts";
import { MemoryStore } from "../memory-store.ts";
import { createMemoryTools } from "./memory-tools.ts";
import { createChatSearchTool } from "./chat-search.ts";
import { rallyState } from "./rally-state.ts";
import { CapabilityCatalog } from "./capability-catalog.ts";
import { createRouterReadTools } from "./router-tools.ts";
import { EventLog } from "./event-log.ts";
import { MainAgent } from "./main-agent.ts";
import { Relay } from "./relay.ts";
import { Scheduler } from "./scheduler.ts";
import { TaskStore } from "./task-store.ts";
import { TaskSnapshot } from "./task-snapshot.ts";
import { StateDirectoryLock } from "./state-lock.ts";
import { createMainTaskTools, createWorkerTools, type TaskToolHost, type WorkerToolHost } from "./tools.ts";
import { type ReportResult, WorkerManager } from "./worker.ts";
import { GateService } from "./gates.ts";
import { AuditLog } from "./audit.ts";
import { createGateTools } from "./gate-tools.ts";
import { join } from "node:path";
import { createGitInspectTool } from "./git-inspect.ts";
import { managedGitRunner } from "./git-runner.ts";
import { createGithubReadTool } from "./github-tool.ts";
import { managedGithubRunner } from "./github-runner.ts";
import { NetworkRunner } from "./network-runner.ts";
import { createFetchPageTool } from "./network-tools.ts";
import { ProcessRegistry } from "./process-registry.ts";
import { JobManager } from "./jobs.ts";
import { ServiceManager } from "./services.ts";
import type { ServicesState } from "../../shared/services.ts";

export interface SupervisorOptions {
	/** Arm the application's independent shutdown deadline before startup cleanup. */
	onStartupFailure?(error: unknown): void | Promise<void>;
	/** Event rotation threshold. Defaults to 20 MiB; injectable for offline recovery tests. */
	eventSegmentBytes?: number;
	mainSegmentBytes?: number;
	mainSegmentCompactions?: number;
	jobForegroundSeconds?: number;
	jobStopGraceMs?: number;
	serviceReadyMs?: number;
	serviceStopGraceMs?: number;
	watchdogNow?: () => number;
	emitServices?(state: ServicesState): void;
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
	readonly snapshot: TaskSnapshot;
	readonly models: ModelStore;
	readonly workspace: WorkspaceStore;
	readonly memory: MemoryStore;
	readonly main: MainAgent;
	readonly workers: WorkerManager;
	readonly relay: Relay;
	readonly scheduler: Scheduler;
	readonly gates: GateService;
	readonly audit: AuditLog;
	readonly processes: ProcessRegistry;
	readonly network = new NetworkRunner();
	readonly jobs: JobManager;
	readonly services: ServiceManager;

	private readonly options: SupervisorOptions;
	private readonly stateLock: StateDirectoryLock;
	private autoApprove = false;
	private disposed = false;
	private disposal?: Promise<void>;

	constructor(paths: RallyPaths, options: SupervisorOptions) {
		this.paths = paths;
		this.options = options;
		this.stateLock = new StateDirectoryLock(paths.stateDir);
		let events: EventLog | undefined;
		let snapshot: TaskSnapshot | undefined;
		try {
			this.events = events = new EventLog(paths.eventsFile, options.eventSegmentBytes, () => this.stateLock.assertHeld());
			this.processes = new ProcessRegistry(paths.stateDir, {
				assertWritable: () => this.events.assertWritable(),
				onStopped: (entry, reason, result) => this.events.append("process_stopped", { ...entry, reason, result }),
			});
			this.audit = new AuditLog(paths.auditFile, this.events);
			this.memory = new MemoryStore(paths.home, paths.memoryFile, this.events, this.audit);
			this.workspace = new WorkspaceStore(paths.home, paths.workspaceDir);
			const catalog = new CapabilityCatalog(paths.agentDir, () => [paths.mainCwd, this.workspace.base(), ...this.workspace.state().recentProjects]);
			const approval = this.events.ofKind("approval_mode").at(-1);
			this.autoApprove = approval?.data.enabled === true;
			this.snapshot = snapshot = new TaskSnapshot(paths.snapshotFile, this.events, (message) => this.main?.addSystemLine(message));
			this.store = new TaskStore(this.events, () => this.workspace.state().defaultWorkspace, (task, kind) => this.onStoreChange(task, kind), this.audit, this.snapshot.replay());
			this.jobs = new JobManager({ store: this.store, processes: this.processes, directory: paths.jobsDir, settingsFile: join(paths.agentDir, "settings.json"), foregroundSeconds: options.jobForegroundSeconds, stopGraceMs: options.jobStopGraceMs,
				onDone: (job, text) => {
					const input = this.store.jobDone(job, text);
					if (input && !this.disposed) this.workers.deliver(job.taskId, text, input.id);
				},
				onBusyChange: () => { if (!this.disposed) { this.workers?.jobsChanged(); this.scheduler?.tick(); } },
				onActivity: taskId => this.workers?.noteActivity(taskId),
				onError: error => console.error("Rally job lifecycle failed", error),
			});
			this.services = new ServiceManager({ store: this.store, processes: this.processes, events: this.events, audit: this.audit, directory: paths.jobsDir,
				readyMs: options.serviceReadyMs, stopGraceMs: options.serviceStopGraceMs,
				onChange: state => options.emitServices?.(state),
				onUserStop: service => { if (!this.disposed) this.main.addSystemLine(`已停止本地服务 ${service.name}（${service.id}，${service.taskId}）。`); },
				onError: error => console.error("Rally service lifecycle failed", error),
			});
			this.models = new ModelStore(paths.modelsFile, managedModelConfigValue(this.processes, paths.agentDir));
			this.gates = new GateService({ store: this.store, audit: this.audit, events: this.events,
				quote: (ref) => this.main.quote(ref), requested: () => this.relay.captureSources(),
				notice: () => this.relay.captureSources() });
			this.main = new MainAgent(paths, this.events, options.emitChat, {
				models: this.models,
				segmentBytes: options.mainSegmentBytes,
				segmentCompactions: options.mainSegmentCompactions,
				taskState: () => rallyState(this.store, this.workers.streamingCount(), this.scheduler.limit, this.autoApprove),
				capabilities: () => catalog.context(),
				customTools: [createChatSearchTool((params) => this.main.search(params)), ...createMemoryTools(this.memory, (ref) => this.main.quote(ref), () => !this.disposed), ...createRouterReadTools(() => this.workspace.base(), this.processes, () => catalog.skillPaths), createGitInspectTool(() => this.workspace.base(), join(paths.stateDir, "tool-output", "main"), managedGitRunner(this.processes)), createGithubReadTool(() => this.workspace.base(), join(paths.stateDir, "tool-output", "main"), managedGithubRunner(this.processes)), createFetchPageTool(this.network), ...createMainTaskTools(this.host()), ...createGateTools(this.gates, this.store)],
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
				network: this.network,
				paths,
				store: this.store,
				models: this.models,
				gates: this.gates,
				audit: this.audit,
				processes: this.processes,
				jobs: this.jobs,
				services: this.services,
				watchdogNow: options.watchdogNow,
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
				pendingIds: () => this.workers.pendingIds(),
				wake: taskId => this.workers.wake(taskId),
				start: (task, run) => this.startRun(task, run),
				onDependencyFailed: () => this.relay.captureSources(),
			});
		} catch (error) {
			// No sessions start in the constructor. Drop partial timers before unlocking.
			try { snapshot?.dispose(false); } finally { events?.close(); this.stateLock.release(); }
			throw error;
		}
	}

	async start(): Promise<void> {
		if (this.disposed) return;
		try {
			await this.processes.recover();
			if (this.disposed) return;
			this.jobs.recover();
			this.services.recover();
			await this.main.start();
			if (this.disposed) return;
			if (this.events.warnings.length) this.main.addSystemLine(`事件恢复跳过 ${this.events.warnings.length} 条损坏记录，原文件已保留。${this.events.warnings.slice(0, 3).join("；")}`);
			if (this.snapshot.warning) this.main.addSystemLine(this.snapshot.warning);
			this.recoverInterrupted();
			this.relay.start();
			this.scheduler.tick();
		} catch (error) {
			// The application arms its independent deadline before cleanup can await a stuck session.
			const failures: unknown[] = [error];
			try { await this.options.onStartupFailure?.(error); } catch (preparation) { failures.push(preparation); }
			try { await this.dispose(); } catch (cleanup) { failures.push(cleanup); }
			if (failures.length > 1) throw new AggregateError(failures, "Rally startup and cleanup failed");
			throw error;
		}
	}

	dispose(pendingRequests?: Promise<void>): Promise<void> {
		if (this.disposal) return this.disposal;
		this.disposed = true;
		this.disposal = this.close(pendingRequests);
		return this.disposal;
	}

	private async close(pendingRequests?: Promise<void>): Promise<void> {
		const errors: unknown[] = [];
		for (const stop of [() => this.scheduler.dispose(), () => this.relay.dispose(), () => this.gates.dispose()]) {
			try { stop(); } catch (error) { errors.push(error); }
		}
		// allSettled prevents an early rejection from releasing the lock while another session still closes.
		const results = await Promise.allSettled([
			pendingRequests,
			Promise.resolve().then(() => this.jobs.dispose()),
			Promise.resolve().then(() => this.services.dispose()),
			Promise.resolve().then(() => this.processes.dispose()),
			Promise.resolve().then(() => this.network.dispose()),
			Promise.resolve().then(() => this.workers.dispose()),
			Promise.resolve().then(() => this.main.dispose()),
		]);
		errors.push(...results.flatMap(result => result.status === "rejected" ? [result.reason] : []));
		try { this.snapshot.dispose(); } catch (error) { errors.push(error); }
		this.events.close();
		// If cleanup is uncertain, retain ownership until process exit releases the OS lock.
		if (errors.length) throw new AggregateError(errors, "Rally shutdown failed; state lock retained until exit");
		this.stateLock.release();
	}

	board(): TaskBoard {
		return { ...this.store.board(this.workers.streamingCount(), this.scheduler.limit), autoApprove: this.autoApprove };
	}

	archive(taskId: string, archived: boolean): TaskBoard {
		if (typeof archived !== "boolean") throw new Error("无效的归档操作");
		this.store.archive(taskId, archived);
		const board = this.board();
		this.options.emitTask({ type: "snapshot", board });
		return board;
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
		if (kind === "task_ended") void this.jobs?.killTask(task.id).catch(error => console.error("Task job cleanup failed", error));
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
				return this.workers.abort(taskId);
			},
			killJobs: taskId => this.jobs.killTask(taskId),
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
