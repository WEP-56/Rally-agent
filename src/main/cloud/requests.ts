import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PublicError } from "./http.ts";

/** A lost acknowledgement must never submit the same chat message twice, even after restart. */
export class ChatRequests {
	readonly db: DatabaseSync;
	private pending = new Map<string, Promise<void>>();
	constructor(file: string) {
		this.db = new DatabaseSync(file);
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, hash TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)",
		);
		if (!this.db.prepare("PRAGMA table_info(requests)").all().some(column => column.name === "durable")) {
			this.db.exec("ALTER TABLE requests ADD COLUMN durable INTEGER NOT NULL DEFAULT 0");
		}
	}
	async run(device: unknown, id: unknown, args: unknown[], action: () => Promise<void>, durable = false): Promise<void> {
		if (typeof device !== "string" || typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
			throw new PublicError("消息缺少有效请求编号");
		const key = `${device}:${id}`;
		const hash = createHash("sha256").update(JSON.stringify(args)).digest("hex");
		const old = this.db.prepare("SELECT hash,done,durable FROM requests WHERE id=?").get(key);
		if (old) {
			if (old.hash !== hash) throw new PublicError("请求编号不能重复用于不同消息", 409);
			if (old.done) return;
			const active = this.pending.get(key);
			if (active) return active;
			if (!durable || !old.durable) throw new PublicError("上次发送被中断，请先核对聊天记录；如需再次发送，请修改消息", 409);
		}
		if (!old) this.db.prepare("INSERT INTO requests(id,hash,durable) VALUES(?,?,?)").run(key, hash, durable ? 1 : 0);
		const result = Promise.resolve()
			.then(action)
			.then(() => {
				this.db.prepare("UPDATE requests SET done=1 WHERE id=?").run(key);
			});
		this.pending.set(key, result);
		try {
			await result;
		} finally {
			this.pending.delete(key);
		}
	}
}
