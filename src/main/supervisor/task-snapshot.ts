import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { EventLog, LoggedEvent } from "./event-log.ts";

interface SnapshotPayload { version: 1; snapshotSeq: number; prefixHash: string; records: LoggedEvent[] }
interface SnapshotFile extends SnapshotPayload { checksum: string }

/** A compact TaskStore replay cache built exclusively from committed events, never live UI state. */
export class TaskSnapshot {
	readonly loadedSeq: number;
	warning?: string;
	private readonly file: string;
	private readonly events: EventLog;
	private readonly records = new Map<string, LoggedEvent>();
	private appliedSeq = 0;
	private savedSeq = 0;
	private queued = false;
	private disposed = false;
	private readonly timer: NodeJS.Timeout;
	private readonly unsubscribe: () => void;
	private readonly warn?: (message: string) => void;

	constructor(file: string, events: EventLog, warn?: (message: string) => void) {
		this.file = file; this.events = events; this.warn = warn;
		this.restore(); this.loadedSeq = this.savedSeq;
		this.unsubscribe = events.onAppend(() => {
			if (events.lastSeq() - this.savedSeq < 200 || this.queued || this.disposed) return;
			this.queued = true;
			queueMicrotask(() => { this.queued = false; if (!this.disposed) this.flush(); });
		});
		this.timer = setInterval(() => this.flush(), 30_000); this.timer.unref();
	}

	/** Latest task snapshots + final tool/message versions + accesses, followed by the uncached tail. */
	replay(): readonly LoggedEvent[] {
		return [...structuredClone([...this.records.values()]).sort((a, b) => a.seq - b.seq), ...this.events.after(this.appliedSeq)];
	}

	flush(): boolean {
		if (this.disposed) return false;
		if (this.events.lastSeq() === this.savedSeq) return true;
		try {
			this.events.assertWritable();
			for (const event of this.events.after(this.appliedSeq)) {
				const key = projectionKey(event);
				if (key) retain(this.records, key, structuredClone(event));
				this.appliedSeq = event.seq;
			}
			const payload: SnapshotPayload = { version: 1, snapshotSeq: this.appliedSeq, prefixHash: this.events.prefixHash(this.appliedSeq)!,
				records: [...this.records.values()].sort((a, b) => a.seq - b.seq) };
			atomicSave(this.file, { ...payload, checksum: checksum(payload) });
			this.savedSeq = this.appliedSeq; this.warning = undefined; return true;
		} catch (error) { this.report(`任务快照保存失败，事件日志仍为恢复依据：${String(error)}`); return false; }
	}

	dispose(save = true): void {
		if (this.disposed) return;
		this.unsubscribe(); clearInterval(this.timer);
		try { if (save) this.flush(); } finally { this.disposed = true; }
	}

	private restore(): void {
		if (!existsSync(this.file)) return;
		try {
			const value: unknown = JSON.parse(readFileSync(this.file, "utf8"));
			if (!value || typeof value !== "object") throw new Error("invalid envelope");
			const saved = value as SnapshotFile;
			const { version, snapshotSeq, prefixHash, records } = saved;
			if (version !== 1 || !Number.isSafeInteger(snapshotSeq) || snapshotSeq < 0 || snapshotSeq > this.events.lastSeq() ||
				prefixHash !== this.events.prefixHash(snapshotSeq) || !Array.isArray(records) || saved.checksum !== checksum({ version, snapshotSeq, prefixHash, records })) throw new Error("version, sequence, history or checksum mismatch");
			let previous = 0; const restored = new Map<string, LoggedEvent>();
			for (const record of records) {
				if (!record || !Number.isSafeInteger(record.seq) || record.seq <= previous || record.seq > snapshotSeq || !record.data) throw new Error("invalid record sequence");
				const key = projectionKey(record);
				if (!key || (restored.has(key) && (!orderedRecord(record) || restored.has(`${key}:first`)))) throw new Error("invalid projection record");
				retain(restored, key, record); previous = record.seq;
			}
			for (const [key, record] of restored) this.records.set(key, record);
			this.appliedSeq = snapshotSeq; this.savedSeq = snapshotSeq;
		} catch (error) { this.report(`任务快照不可用，已回退完整事件重放：${String(error)}`); }
	}
	private report(message: string): void {
		if (this.warning === message) return;
		this.warning = message; this.warn?.(message);
	}
}

function orderedRecord(event: LoggedEvent): boolean { return event.kind === "assistant_message" || event.kind === "tool_activity"; }
function retain(records: Map<string, LoggedEvent>, key: string, event: LoggedEvent): void {
	// Replay upserts preserve first-seen order even when an older message/tool finishes later.
	const prior = records.get(key);
	if (prior && orderedRecord(event) && !records.has(`${key}:first`)) records.set(`${key}:first`, prior);
	records.set(key, event);
}

/** Mirror TaskStore replay precedence. Each retained record contains the complete latest value. */
function projectionKey(event: LoggedEvent): string | undefined {
	const { data, kind } = event;
	if (kind === "access_recorded" && typeof data.taskId === "string" && data.access) {
		const access = data.access as { toolCallId: string; kind: string; target: string };
		return JSON.stringify(["access", data.taskId, access.toolCallId, access.kind, access.target]);
	}
	if (kind === "assistant_message" && typeof data.taskId === "string" && data.message) return JSON.stringify(["message", data.taskId, (data.message as { id: string }).id]);
	if (kind === "tool_activity" && typeof data.taskId === "string" && data.call) return JSON.stringify(["tool", data.taskId, (data.call as { id: string }).id]);
	const task = data.task as { id?: string; runs?: unknown[] } | undefined;
	if (task && typeof task.id === "string" && Array.isArray(task.runs)) return JSON.stringify(["task", task.id]);
	return undefined;
}
function checksum(payload: SnapshotPayload): string { return createHash("sha256").update(JSON.stringify(payload)).digest("hex"); }
function atomicSave(file: string, content: SnapshotFile): void {
	mkdirSync(dirname(file), { recursive: true });
	const temporary = `${file}.${randomUUID()}.tmp`; let fd: number | undefined;
	try {
		fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, `${JSON.stringify(content)}\n`, "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined;
		renameSync(temporary, file);
	} finally {
		if (fd !== undefined) closeSync(fd);
		try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	}
}
