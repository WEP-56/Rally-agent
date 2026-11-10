import type { GateDescription, TaskGate } from "../../shared/gate.ts";
import type { QuoteRef, Task } from "../../shared/task.ts";
import type { AuditLog } from "./audit.ts";
import type { EventLog } from "./event-log.ts";
import { TaskError, type TaskStore } from "./task-store.ts";

interface GateOptions {
	store: TaskStore;
	audit: AuditLog;
	events: EventLog;
	quote(ref: QuoteRef): { messageId: string } | null;
	requested(task: Task, gate: TaskGate): void;
	notice(text: string): void;
}
interface WaitingGate {
	taskId: string;
	gate: TaskGate;
	resolve(decision: NonNullable<TaskGate["decision"]>): void;
	timer: NodeJS.Timeout;
	unsubscribe(): void;
}

export class GateService {
	private readonly options: GateOptions;
	private readonly pending = new Map<string, WaitingGate>();
	private nextId = 1;
	private disposed = false;
	constructor(options: GateOptions) {
		this.options = options;
		for (const task of options.store.list()) for (const gate of task.gates ?? []) {
			this.nextId = Math.max(this.nextId, Number(gate.id.slice(2)) + 1 || 1);
			if (!gate.decision) this.record(task.id, gate, "deny", "system", [], "Rally restarted; approval must be requested again.");
		}
	}

	request(task: Task, runId: string, toolCallId: string, tool: string, args: Record<string, unknown>, description: unknown, signal?: AbortSignal, executionCwd = task.cwd): Promise<NonNullable<TaskGate["decision"]>> {
		const run = task.runs.find((item) => item.id === runId);
		if (this.disposed || task.ended || !run || run.endedAt || signal?.aborted) throw new TaskError("TASK_ENDED", "任务或运行已结束");
		if (task.gates?.some((gate) => !gate.decision)) throw new TaskError("GATE_PENDING", "请先等待当前内门决定，再申请其他不可逆动作");
		const fields = gateDescription(description);
		const gate: TaskGate = { ...fields, id: `G-${this.nextId++}`, runId, toolCallId, tool, cwd: executionCwd,
			arguments: structuredClone(args), requestedAt: Date.now(), expiresAt: Date.now() + 120_000 };
		return new Promise((resolve, reject) => {
			const aborted = () => this.closeTask(task.id, "Task or tool call was cancelled.");
			const timer = setTimeout(() => this.timeout(gate.id), 120_000);
			timer.unref();
			this.pending.set(gate.id, { taskId: task.id, gate, resolve, timer, unsubscribe: () => signal?.removeEventListener("abort", aborted) });
			signal?.addEventListener("abort", aborted, { once: true });
			try {
				this.options.store.recordGate(task.id, gate, "gate_requested");
				this.options.requested(task, structuredClone(gate));
			} catch (error) {
				this.remove(gate.id);
				reject(error);
			}
		});
	}

	decide(id: string, value: "allow" | "deny", actor: "main" | "user", refs: QuoteRef[] = [], reason: string): void {
		const waiting = this.current(id);
		if (actor === "user" && !waiting.gate.escalatedAt) throw new TaskError("GATE_NOT_ESCALATED", "该请求尚未转交用户");
		if (value !== "allow" && value !== "deny") throw new TaskError("DECISION_INVALID", "无效的内门决定");
		if (typeof reason !== "string" || !reason.trim()) throw new TaskError("REASON_REQUIRED", "请说明决定依据");
		const basis: string[] = [];
		if (actor === "main" && value === "allow") {
			if (!refs.length) throw new TaskError("QUOTE_REQUIRED", "放行必须引用覆盖动作与范围的用户原话");
			for (const ref of refs) {
				const quote = this.options.quote(ref);
				if (!quote) throw new TaskError("QUOTE_INVALID", `引用 ${ref.id} 不存在或不是用户原话`);
				basis.push(quote.messageId);
			}
		}
		this.finish(waiting, value, actor, [...new Set(basis)], reason);
		if (actor === "user") this.options.notice(`用户${value === "allow" ? "允许" : "拒绝"}了 ${id}（${waiting.taskId}）。`);
	}

	escalate(taskId: string, id: string): void {
		const waiting = this.current(id);
		if (waiting.taskId !== taskId) throw new TaskError("GATE_STALE", "请求不属于该任务");
		if (waiting.gate.escalatedAt) return;
		waiting.gate.escalatedAt = Date.now();
		waiting.gate.expiresAt = Date.now() + 600_000;
		clearTimeout(waiting.timer);
		waiting.timer = setTimeout(() => this.timeout(id), 600_000);
		waiting.timer.unref();
		this.options.store.recordGate(taskId, waiting.gate, "gate_escalated");
	}

	/** Only gates actually delivered in the settled main-agent turn are eligible for fallback. */
	fallback(ids: readonly string[]): void {
		for (const id of ids) {
			const waiting = this.pending.get(id);
			if (waiting && !waiting.gate.escalatedAt) {
				try { this.escalate(waiting.taskId, id); } catch (error) { console.error("Gate fallback failed", error); }
			}
		}
	}

	closeTask(taskId: string, reason: string): void {
		for (const waiting of [...this.pending.values()]) if (waiting.taskId === taskId) this.denySystem(waiting, reason);
	}
	dispose(): void {
		this.disposed = true;
		for (const waiting of [...this.pending.values()]) this.denySystem(waiting, "Rally is shutting down.");
	}

	private current(id: string): WaitingGate {
		const waiting = this.pending.get(id);
		if (waiting && Date.now() >= waiting.gate.expiresAt) this.timeout(id);
		if (!waiting || !this.pending.has(id)) throw new TaskError("GATE_STALE", "内门已决定或已超时");
		const task = this.options.store.get(waiting.taskId);
		if (!task || task.ended || task.runs.find((run) => run.id === waiting.gate.runId)?.endedAt) {
			this.denySystem(waiting, "Task or run ended.");
			throw new TaskError("GATE_STALE", "任务或运行已结束");
		}
		return waiting;
	}
	private timeout(id: string): void {
		const waiting = this.pending.get(id);
		if (!waiting) return;
		this.denySystem(waiting, "GATE_TIMEOUT: Approval timed out.");
		try { this.options.events.append("gate_timeout", { taskId: waiting.taskId, gateId: id }); }
		catch (error) { console.error("Gate timeout log failed", error); }
	}
	private denySystem(waiting: WaitingGate, reason: string): void {
		try { this.finish(waiting, "deny", "system", [], reason); }
		catch (error) {
			// Failed persistence must never turn into permission or leave a tool waiting forever.
			console.error("Gate denial persistence failed", error);
			this.remove(waiting.gate.id);
			waiting.resolve({ value: "deny", actor: "system", basis: [], reason: "GATE_STORAGE_ERROR", at: Date.now() });
		}
	}
	private finish(waiting: WaitingGate, value: "allow" | "deny", actor: "main" | "user" | "system", basis: string[], reason: string): void {
		const gate = this.record(waiting.taskId, waiting.gate, value, actor, basis, reason);
		this.remove(gate.id);
		waiting.resolve(gate.decision!);
	}
	private record(taskId: string, source: TaskGate, value: "allow" | "deny", actor: "main" | "user" | "system", basis: string[], reason: string): TaskGate {
		const gate = { ...source, decision: { value, actor, basis, reason, at: Date.now() } };
		this.options.audit.append("gate", { taskId, runId: gate.runId, gateId: gate.id, toolCallId: gate.toolCallId, tool: gate.tool,
			action: gate.action, cwd: gate.cwd, scope: gate.scope, decision: value, actor, basis, reason });
		this.options.store.recordGate(taskId, gate, "gate_decided");
		return gate;
	}
	private remove(id: string): void {
		const waiting = this.pending.get(id);
		if (!waiting) return;
		clearTimeout(waiting.timer);
		waiting.unsubscribe();
		this.pending.delete(id);
	}
}

function gateDescription(value: unknown): GateDescription {
	if (!value || typeof value !== "object") throw new TaskError("GATE_CONTEXT_REQUIRED", "Supply approval with action, scope and alternative; cwd and tool are provided by Rally.");
	const description = value as Partial<GateDescription>;
	if (typeof description.action !== "string" || !description.action.trim() || typeof description.alternative !== "string" || !description.alternative.trim() ||
		!Array.isArray(description.scope) || !description.scope.length || !description.scope.every((path) => typeof path === "string" && path.trim())) {
		throw new TaskError("GATE_CONTEXT_REQUIRED", "Supply nonempty action, scope and alternative.");
	}
	return { action: description.action, scope: [...description.scope], alternative: description.alternative };
}
