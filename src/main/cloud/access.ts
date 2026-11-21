import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const digest = (s: string) => createHash("sha256").update(s).digest();
export const newKey = () => randomBytes(32).toString("base64url");
export class AccessStore {
	readonly db: DatabaseSync;
	readonly instance: string;
	private readonly admin: Buffer;
	constructor(file: string, adminKey: string) {
		if (adminKey.length < 32) throw new Error("管理密钥过短");
		this.admin = digest(adminKey);
		this.db = new DatabaseSync(file);
		this.db.exec(`CREATE TABLE IF NOT EXISTS instance(id TEXT PRIMARY KEY, pairing INTEGER NOT NULL DEFAULT 1);
		CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL, invite BLOB UNIQUE, token BLOB UNIQUE, seen INTEGER, created INTEGER NOT NULL)`);
		if (!this.db.prepare("SELECT id FROM instance").get())
			this.db.prepare("INSERT INTO instance(id) VALUES(?)").run(randomUUID());
		this.instance = String(this.db.prepare("SELECT id FROM instance").get()!.id);
	}
	isAdmin(key: string) {
		return timingSafeEqual(this.admin, digest(key));
	}
	status() {
		return {
			instance: this.instance,
			pairing: !!this.db.prepare("SELECT pairing FROM instance").get()!.pairing,
			devices: this.db
				.prepare("SELECT id,name,seen,created,token IS NOT NULL AS paired FROM devices ORDER BY created DESC")
				.all(),
		};
	}
	setPairing(on: boolean) {
		this.db.prepare("UPDATE instance SET pairing=?").run(Number(on));
	}
	issue(name: string) {
		if (!name.trim() || name.length > 80) throw new Error("请填写设备名称（最多 80 字）");
		const key = newKey();
		this.db
			.prepare("INSERT INTO devices(id,name,invite,created) VALUES(?,?,?,?)")
			.run(randomUUID(), name.trim(), digest(key), Date.now());
		return key;
	}
	pair(key: string) {
		const token = newKey();
		const result = this.db
			.prepare("UPDATE devices SET invite=NULL,token=?,seen=? WHERE invite=? AND (SELECT pairing FROM instance)=1")
			.run(digest(token), Date.now(), digest(key));
		return result.changes ? { token, instance: this.instance, protocol: 1 } : null;
	}
	authenticate(key: string) {
		const row = this.db.prepare("SELECT id,seen FROM devices WHERE token=?").get(digest(key));
		if (!row) return null;
		if (Date.now() - Number(row.seen) > 15000)
			this.db.prepare("UPDATE devices SET seen=? WHERE id=?").run(Date.now(), row.id);
		return String(row.id);
	}
	revoke(id: string) {
		this.db.prepare("DELETE FROM devices WHERE id=?").run(id);
	}
	hasDevice(id: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM devices WHERE id=? AND token IS NOT NULL").get(id)); }
}
