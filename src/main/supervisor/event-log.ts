// Append-only event log: the single source of truth for the supervisor (docs 04 section 1 / 6).
// One writer (the main process) assigns a monotonic seq before every append; renderers only read.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Event kinds the supervisor can append (docs 01 §7). Payloads stay loose; task snapshots ride along. */
export type EventKind =
	| "chat_message"
	| "chat_reset"
	| "chat_compacted"
	| "approval_mode"
	| "model_select"
	| "task_created"
	| "task_approved"
	| "task_updated"
	| "task_scope_overlap"
	| "task_queued"
	| "task_dequeued"
	| "run_started"
	| "run_ended"
	| "task_input"
	| "input_delivered"
	| "input_read"
	| "task_report"
	| "task_ended"
	| "task_files_changed"
	| "attention_opened"
	| "attention_escalated"
	| "attention_answered"
	| "gate_requested"
	| "gate_escalated"
	| "gate_decided"
	| "relay_enqueued"
	| "relay_delivered"
	| "notice_enqueued"
	| "capacity"
	| "waiting"
	| "stop"
	| "job_started"
	| "job_backgrounded"
	| "job_exited"
	| "service_started"
	| "service_exited"
	| "service_stopped"
	| "access_recorded"
	| "audit_appended"
	| "memory_changed"
	| "usage_updated";

/** A persisted event. `data` stays loosely typed until the task schema lands in M1-B. */
export interface LoggedEvent {
	seq: number;
	at: number;
	kind: EventKind;
	data: Record<string, unknown>;
}

export class EventLog {
	private seq = 0;
	private readonly entries: LoggedEvent[] = [];
	private readonly file: string;

	constructor(file: string) {
		this.file = file;
		mkdirSync(dirname(file), { recursive: true });
		this.load();
	}

	/** Append one event and return it. Synchronous so seq order matches disk order. */
	append(kind: EventKind, data: Record<string, unknown>): LoggedEvent {
		const event: LoggedEvent = { seq: ++this.seq, at: Date.now(), kind, data: structuredClone(data) };
		this.entries.push(event);
		appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
		return event;
	}

	/** All events, in seq order. */
	all(): readonly LoggedEvent[] {
		return this.entries;
	}

	/** All events of one kind, in seq order. */
	ofKind(kind: EventKind): readonly LoggedEvent[] {
		return this.entries.filter((event) => event.kind === kind);
	}

	private load(): void {
		if (!existsSync(this.file)) return;
		const text = readFileSync(this.file, "utf8");
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line) as LoggedEvent;
				if (typeof event.seq !== "number" || typeof event.kind !== "string") continue;
				this.entries.push(event);
				this.seq = Math.max(this.seq, event.seq);
			} catch {
				// A torn line from an interrupted write: skip it and keep going.
			}
		}
	}
}
