// Append-only event log: the single source of truth for the supervisor (docs 04 section 1 / 6).
// One writer (the main process) assigns a monotonic seq before every append; renderers only read.

import { appendFileSync, closeSync, existsSync, fstatSync, ftruncateSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";

/** Event kinds the supervisor can append (docs 01 §7). Payloads stay loose; task snapshots ride along. */
export type EventKind =
	| "chat_message"
	| "chat_reset"
	| "chat_compacted"
	| "segment_rotated"
	| "process_stopped"
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
	| "run_stall_retry"
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
	| "gate_timeout"
	| "external_action"
	| "relay_enqueued"
	| "relay_delivered"
	| "relay_started"
	| "relay_failed"
	| "relay_discarded"
	| "notice_enqueued"
	| "capacity"
	| "waiting"
	| "stop"
	| "job_started"
	| "job_backgrounded"
	| "job_exited"
	| "service_started"
	| "service_updated"
	| "service_exited"
	| "service_stopped"
	| "access_recorded"
	| "audit_appended"
	| "memory_changed"
	| "usage_updated"
	| "tool_activity"
	| "assistant_message";

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
	private file: string;
	private bytes = 0;
	private segment = 1;
	private readonly firstFile: string;
	private readonly prefix: string;
	private readonly maxSegmentBytes: number;
	private poisoned = false;
	private closed = false;
	private readonly beforeWrite?: () => void;
	private readonly hashes: string[] = [createHash("sha256").update("").digest("hex")];
	private readonly listeners = new Set<() => void>();
	/** Recovery diagnostics: malformed/torn lines are preserved on disk, never replayed. */
	readonly warnings: string[] = [];

	constructor(file: string, maxSegmentBytes = 20 * 1024 * 1024, beforeWrite?: () => void) {
		if (!Number.isSafeInteger(maxSegmentBytes) || maxSegmentBytes < 1) throw new Error("EVENT_SEGMENT_SIZE_INVALID");
		this.beforeWrite = beforeWrite;
		this.assertWritable();
		this.file = file; this.firstFile = file; this.maxSegmentBytes = maxSegmentBytes;
		this.prefix = basename(file).replace(/(?:-0001)?\.jsonl$/, "");
		mkdirSync(dirname(file), { recursive: true });
		this.load();
	}

	/** Append one event and return it. Synchronous so seq order matches disk order. */
	append(kind: EventKind, data: Record<string, unknown>): LoggedEvent {
		this.assertWritable();
		if (this.bytes > 0 && (!existsSync(this.file) || statSync(this.file).size !== this.bytes)) throw new Error("EVENT_LOG_CHANGED: 当前事件文件被删除或改动");
		const event: LoggedEvent = { seq: this.seq + 1, at: Date.now(), kind, data: structuredClone(data) };
		const content = Buffer.from(`${JSON.stringify(event)}\n`, "utf8");
		if (this.bytes > 0 && this.bytes + content.length > this.maxSegmentBytes) {
			// Never rename or overwrite history. Exclusive creation detects another writer/collision.
			const next = this.segmentFile(this.segment + 1);
			const fd = openSync(next, "wx", 0o600); closeSync(fd);
			this.file = next; this.segment++; this.bytes = 0;
		}
		// r+ with explicit offsets permits truncating a failed partial write on Windows.
		const fd = openSync(this.file, existsSync(this.file) ? "r+" : "wx+", 0o600);
		try {
			if (fstatSync(fd).size !== this.bytes) throw new Error("EVENT_LOG_CHANGED: 事件文件已被其他写者改动");
			try {
				let written = 0;
				while (written < content.length) {
					const count = writeSync(fd, content, written, content.length - written, this.bytes + written);
					if (!count) throw new Error("EVENT_WRITE_INCOMPLETE");
					written += count;
				}
			} catch (error) {
				// A live retry must not append to a partial JSON record left by a short/failed write.
				try { ftruncateSync(fd, this.bytes); } catch { this.poisoned = true; }
				throw error;
			}
		} finally { closeSync(fd); }
		this.bytes += content.length;
		this.seq = event.seq;
		this.entries.push(event);
		this.hashes.push(eventHash(this.hashes.at(-1)!, event));
		for (const listener of this.listeners) {
			try { listener(); } catch (error) { console.error("Event observer failed", error); }
		}
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

	/** Active path is diagnostic only; callers should read all()/ofKind() across segments. */
	activeFile(): string { return this.file; }
	lastSeq(): number { return this.seq; }
	after(seq: number): readonly LoggedEvent[] { return this.entries.slice(seq); }
	prefixHash(seq: number): string | undefined { return this.hashes[seq]; }
	onAppend(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	/** Disk writers sharing this lifetime must check before changing their own files. */
	assertWritable(): void {
		if (this.closed) throw new Error("EVENT_LOG_CLOSED: 状态写入已关闭");
		if (this.poisoned) throw new Error("EVENT_LOG_RECOVERY_REQUIRED: 写入回滚失败，请重启后检查事件流");
		this.beforeWrite?.();
	}
	close(): void { this.closed = true; this.listeners.clear(); }
	private segmentFile(n: number): string {
		return n === 1 ? this.firstFile : join(dirname(this.firstFile), `${this.prefix}-${String(n).padStart(4, "0")}.jsonl`);
	}

	private load(): void {
		const names = readdirSync(dirname(this.firstFile));
		const segments = names.flatMap(name => {
			if (name === basename(this.firstFile)) return [1];
			if (!name.startsWith(`${this.prefix}-`) || !name.endsWith(".jsonl")) return [];
			const number = name.slice(this.prefix.length + 1, -6);
			if (!/^\d{4,}$/.test(number)) return [];
			const n = Number(number);
			if (!Number.isSafeInteger(n) || n < 2 || basename(this.segmentFile(n)) !== name) throw new Error(`EVENT_SEGMENT_INVALID: ${name}`);
			return [n];
		}).sort((a, b) => a - b);
		for (let index = 0; index < segments.length; index++) {
			const n = segments[index];
			if (n !== index + 1) throw new Error(`EVENT_SEGMENT_MISSING: ${this.segmentFile(index + 1)}`);
			const file = this.segmentFile(n);
			const data = readFileSync(file);
			const lines: Buffer[] = [];
			let start = 0;
			for (let end = data.indexOf(10); end !== -1; end = data.indexOf(10, start)) {
				lines.push(data.subarray(start, end)); start = end + 1;
			}
			lines.push(data.subarray(start));
			for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
				const line = lines[lineIndex];
				if (!line.length) continue;
				let parsed: unknown;
				try { const text = new TextDecoder("utf-8", { fatal: true }).decode(line); if (!text.trim()) continue; parsed = JSON.parse(text); }
				catch {
					// Also accepts torn tails separated by the legacy loader on an earlier restart.
					this.warnings.push(`${file}:${lineIndex + 1}: skipped malformed event record`);
					continue;
				}
				if (!validEvent(parsed)) throw new Error(`EVENT_RECORD_INVALID: ${file}:${lineIndex + 1}`);
				if (parsed.seq !== this.seq + 1) throw new Error(`EVENT_SEQUENCE_INVALID: ${file}:${lineIndex + 1}, expected ${this.seq + 1}, got ${parsed.seq}`);
				this.entries.push(parsed); this.seq = parsed.seq;
				this.hashes.push(eventHash(this.hashes.at(-1)!, parsed));
			}
			this.segment = n; this.file = file;
		}
		if (!segments.length) return;
		// Preserve old segments byte-for-byte; only repair the current append target's tail.
		const tail = readFileSync(this.file);
		if (tail.length && tail[tail.length - 1] !== 10) appendFileSync(this.file, "\n", "utf8");
		this.bytes = statSync(this.file).size;
	}
}

function eventHash(previous: string, event: LoggedEvent): string {
	return createHash("sha256").update(previous).update(JSON.stringify(event)).digest("hex");
}

function validEvent(value: unknown): value is LoggedEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<LoggedEvent>;
	return Number.isSafeInteger(event.seq) && event.seq! > 0 && typeof event.at === "number" && Number.isFinite(event.at) &&
		typeof event.kind === "string" && !!event.kind && !!event.data && typeof event.data === "object" && !Array.isArray(event.data);
}
