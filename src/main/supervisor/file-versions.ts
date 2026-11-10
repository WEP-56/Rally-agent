import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	createEditToolDefinition,
	createLocalReadOperations,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ReadOperations,
	type SessionManager,
} from "@rally/coding-agent";

const ENTRY_TYPE = "rally-file-version-v1";
const DELETE_ENTRY_TYPE = "rally-file-deleted-v1";

interface FileStamp {
	path: string;
	realPath: string;
	mtimeMs: number;
	size: number;
	dev: number;
	ino: number;
}

export interface FileVersion extends FileStamp {
	hash: string;
	/** Identity of a file actually created by this task, retained only while that identity survives. */
	created?: boolean;
}

/** Per-session optimistic checks, not ownership or a lock. Shell/external changes remain possible. */
export class FileVersions {
	private readonly aliases = new Map<string, string>();
	private readonly versions = new Map<string, FileVersion>();
	private readonly session: SessionManager;

	constructor(session: SessionManager) {
		this.session = session;
		for (const entry of session.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE && isVersion(entry.data)) this.remember(entry.data);
			if (entry.type === "custom" && entry.customType === DELETE_ENTRY_TYPE && entry.data && typeof entry.data === "object" && "path" in entry.data && typeof entry.data.path === "string") {
				this.forget(entry.data.path, "link" in entry.data && entry.data.link === true);
			}
		}
	}

	private remember(version: FileVersion): void {
		this.aliases.set(version.path, version.realPath);
		this.versions.set(version.realPath, version);
	}

	record(version: FileVersion): void {
		const prior = this.versions.get(version.realPath);
		const saved = { ...version, created: version.created === true || (version.created === undefined && prior?.created === true && sameVersion(prior, version)) };
		this.session.appendCustomEntry(ENTRY_TYPE, saved);
		this.remember(saved);
	}

	isCreated(version: FileVersion): boolean {
		const prior = this.versions.get(version.realPath);
		return prior?.created === true && sameVersion(prior, version);
	}

	recordDeletion(path: string, link: boolean): void {
		this.session.appendCustomEntry(DELETE_ENTRY_TYPE, { path: key(path), link });
		this.forget(key(path), link);
	}

	private forget(path: string, link: boolean): void {
		if (!link) {
			this.versions.delete(path);
			for (const [alias, target] of this.aliases) if (target === path) this.aliases.delete(alias);
		}
		this.aliases.delete(path);
	}

	/** Inspect current bytes without pretending the model has read them. */
	async capture(path: string, signal?: AbortSignal): Promise<FileVersion> {
		let current: FileVersion | undefined;
		const operations = this.readOperations((version) => { current = version; });
		for await (const _chunk of operations.createReadStream!(path, { signal })) { /* Stream the fingerprint only. */ }
		signal?.throwIfAborted();
		if (!current) throw stale(path);
		return current;
	}

	/** Capture the bytes actually consumed by Pi, including bytes outside a requested line range. */
	readOperations(observed: (version: FileVersion) => void): ReadOperations {
		const local = createLocalReadOperations();
		return {
			...local,
			readFile: async (path) => {
				const before = await stamp(path);
				const buffer = await local.readFile(path);
				if (!sameStamp(before, await stamp(path))) throw stale(path);
				observed({ ...before, hash: digest(buffer) });
				return buffer;
			},
			createReadStream: async function* (path, options) {
				const before = await stamp(path);
				const hash = createHash("sha256");
				for await (const chunk of local.createReadStream!(path, options)) {
					hash.update(chunk);
					yield chunk;
				}
				options.signal?.throwIfAborted();
				if (!sameStamp(before, await stamp(path))) throw stale(path);
				observed({ ...before, hash: hash.digest("hex") });
			},
		};
	}

	/** Shared by write/edit/file_delete. Missing/retargeted previously read files are stale too. */
	async assertFresh(path: string, signal?: AbortSignal, source?: FileVersion): Promise<void> {
		signal?.throwIfAborted();
		const lexical = key(path);
		let canonical: string;
		try {
			canonical = key(await realpath(path));
		} catch (error) {
			if (this.aliases.has(lexical) || this.versions.has(lexical) || source) throw stale(path);
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		const known = this.versions.get(this.aliases.get(lexical) ?? canonical);
		if (!known && !source) return; // New or never-read files retain Pi's normal write behavior.
		try {
			const current = await this.capture(path, signal);
			if ((known && !sameVersion(known, current)) || (source && !sameVersion(source, current))) throw stale(path);
		} catch (error) {
			signal?.throwIfAborted();
			if ((error as NodeJS.ErrnoException).code === "ENOENT") throw stale(path);
			throw error;
		}
	}

	/** Store our intended bytes, never adopt a concurrent writer's content as our new baseline. */
	async recordWrite(path: string, content: string, created = false): Promise<void> {
		const current = await stamp(path);
		const prior = this.versions.get(current.realPath);
		const ours = created || (prior?.created === true && prior.dev === current.dev && prior.ino === current.ino);
		this.record({ ...current, hash: digest(Buffer.from(content, "utf8")), created: ours });
	}
}

/** Pi still owns path resolution, edit matching, streaming, aborts and its existing mutation queue. */
export function createVersionedFileTools(cwd: string, versions: FileVersions, assertWritable: (path: string) => void) {
	const read = createReadToolDefinition(cwd);
	const write = createWriteToolDefinition(cwd);
	const edit = createEditToolDefinition(cwd);
	return [
		{ ...read, execute: async (...args: Parameters<typeof read.execute>) => {
			let observed: FileVersion | undefined;
			const result = await createReadToolDefinition(cwd, {
				operations: versions.readOperations((version) => { observed = version; }),
			}).execute(...args);
			args[2]?.throwIfAborted();
			if (!result.isError && observed) versions.record(observed);
			return result;
		} },
		{ ...write, execute: (...args: Parameters<typeof write.execute>) => {
			const signal = args[2];
			return createWriteToolDefinition(cwd, { operations: {
				mkdir: async (dir) => { signal?.throwIfAborted(); assertWritable(dir); await mkdir(dir, { recursive: true }); },
				writeFile: async (path, content) => {
					await versions.assertFresh(path, signal);
					let created = await lstat(path).then(() => false, (error: NodeJS.ErrnoException) => {
						if (error.code === "ENOENT") return true;
						throw error;
					});
					signal?.throwIfAborted(); assertWritable(path);
					try { await writeFile(path, content, { encoding: "utf8", flag: created ? "wx" : "w" }); }
					catch (error) {
						if (!created || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
						// A competing creator won. Never claim its file as our own for the delete exception.
						created = false;
						await versions.assertFresh(path, signal);
						signal?.throwIfAborted(); assertWritable(path);
						await writeFile(path, content, "utf8");
					}
					await versions.recordWrite(path, content, created);
				},
			} }).execute(...args);
		} },
		{ ...edit, execute: (...args: Parameters<typeof edit.execute>) => {
			const signal = args[2];
			let source: FileVersion | undefined;
			return createEditToolDefinition(cwd, { operations: {
				access: async (path) => {
					await versions.assertFresh(path, signal);
					await access(path, constants.R_OK | constants.W_OK);
				},
				readFile: async (path) => {
					const before = await stamp(path);
					const buffer = await readFile(path, { signal });
					if (!sameStamp(before, await stamp(path))) throw stale(path);
					source = { ...before, hash: digest(buffer) };
					return buffer;
				},
				writeFile: async (path, content) => {
					await versions.assertFresh(path, signal, source);
					signal?.throwIfAborted(); assertWritable(path);
					await writeFile(path, content, "utf8");
					await versions.recordWrite(path, content);
				},
			} }).execute(...args);
		} },
	] as const;
}

function key(path: string): string {
	const absolute = resolve(path);
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

async function stamp(path: string): Promise<FileStamp> {
	const canonical = key(await realpath(path));
	const info: Stats = await stat(path);
	return { path: key(path), realPath: canonical, mtimeMs: info.mtimeMs, size: info.size, dev: info.dev, ino: info.ino };
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
	return a.realPath === b.realPath && a.mtimeMs === b.mtimeMs && a.size === b.size && a.dev === b.dev && a.ino === b.ino;
}

function sameVersion(a: FileVersion, b: FileVersion): boolean {
	return sameStamp(a, b) && a.hash === b.hash;
}

function digest(buffer: Buffer): string { return createHash("sha256").update(buffer).digest("hex"); }

function stale(path: string): Error {
	return new Error(`STALE_FILE: 文件在你读取后被修改，请重新读取：${path}`);
}

function isVersion(value: unknown): value is FileVersion {
	if (!value || typeof value !== "object") return false;
	const data = value as Record<string, unknown>;
	return typeof data.path === "string" && typeof data.realPath === "string" && typeof data.hash === "string"
		&& /^[a-f0-9]{64}$/.test(data.hash) && [data.mtimeMs, data.size, data.dev, data.ino].every((item) => typeof item === "number" && Number.isFinite(item));
}
