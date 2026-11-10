import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A process-lifetime OS file lock. The database carries no application state.
 * Never unlink it: a second inode would let two processes acquire different locks.
 * An exclusive transaction survives a stalled event loop and is released on process death.
 */
export class StateDirectoryLock {
	readonly file: string;
	private readonly database: DatabaseSync;
	private released = false;

	constructor(directory: string) {
		mkdirSync(directory, { recursive: true });
		this.file = join(realpathSync(directory), "writer-lock.sqlite");
		const database = new DatabaseSync(this.file, { timeout: 0, allowExtension: false });
		try {
			// Use rollback mode so BEGIN EXCLUSIVE acquires the file lock immediately.
			// No heartbeat or stale-file deletion: SQLite/OS owns recovery after a crash.
			database.exec("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE;");
		} catch (error) {
			database.close();
			const code = error && typeof error === "object" && "errcode" in error ? Number(error.errcode) & 0xff : 0;
			if (code === 5 || code === 6) throw new Error(`STATE_DIRECTORY_LOCKED: 该状态目录已由另一个 Rally 实例使用：${directory}`, { cause: error });
			throw new Error(`STATE_DIRECTORY_LOCK_FAILED: 无法锁定状态目录：${directory}`, { cause: error });
		}
		this.database = database;
	}

	assertHeld(): void {
		if (this.released || !this.database.isTransaction) throw new Error("STATE_DIRECTORY_UNLOCKED: 状态目录锁已释放，不能继续写入");
	}

	release(): void {
		if (this.released) return;
		this.database.close();
		this.released = true;
	}
}
