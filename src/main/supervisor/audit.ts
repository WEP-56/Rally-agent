import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EventLog } from "./event-log.ts";

/** Separate append-only audit. Persist before allowing any controlled action. */
export class AuditLog {
	private readonly file: string;
	private readonly events: EventLog;
	constructor(file: string, events: EventLog) {
		this.file = file;
		this.events = events;
		mkdirSync(dirname(file), { recursive: true });
	}
	append(kind: "gate" | "external" | "approve" | "answer" | "cancel" | "memory", data: Record<string, unknown>): void {
		const entry = { ...data, ts: Date.now(), kind };
		appendFileSync(this.file, `${JSON.stringify(entry)}\n`, "utf8");
		this.events.append("audit_appended", entry);
	}
}
