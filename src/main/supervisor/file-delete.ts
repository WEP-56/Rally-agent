import { execFile } from "node:child_process";
import { lstat, readdir, readlink, realpath, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { withFileMutationQueue, type ToolDefinition } from "@rally/coding-agent";
import { Type, type Static } from "typebox";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { GateService } from "./gates.ts";
import type { TaskStore } from "./task-store.ts";
import { FileVersions, type FileVersion } from "./file-versions.ts";
import { canonicalTarget, containsPath, resolveToolPath } from "./file-paths.ts";

const execFileAsync = promisify(execFile);

async function git(dir: string, args: string[], signal?: AbortSignal): Promise<string> {
	const { stdout } = await execFileAsync("git", ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", dir, ...args], {
		encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024, signal,
		env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_DIR: undefined, GIT_COMMON_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined },
	});
	return stdout;
}
const schema = Type.Object({
	paths: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Literal paths, relative to the task cwd or absolute; no globs. Symlinks are removed without following their targets." }),
	recursive: Type.Optional(Type.Boolean({ description: "Include directory contents. Default false." })),
	dryRun: Type.Optional(Type.Boolean({ description: "Preview only by default. false requests deletion; Rally obtains approval when required." })),
});
type DeleteInput = Static<typeof schema>;
interface DeletePreview { matched: number; totalBytes: number; preview: string[]; uncommitted: string[]; outsideCwd: string[] }
interface DeleteResult { deleted: number; failed: { path: string; error: string }[] }
interface DeleteNode {
	path: string;
	kind: "file" | "directory" | "link";
	dev: number;
	ino: number;
	size: number;
	mtimeMs: number;
	ctimeMs: number;
	link?: string;
	version?: FileVersion;
}
interface DeletePlan { roots: string[]; nodes: DeleteNode[] }
interface DeleteHost {
	task: Task;
	run: TaskRun;
	store: TaskStore;
	gates: GateService;
	versions: FileVersions;
	isActive(): boolean;
}

export function createFileDeleteTool(host: DeleteHost): ToolDefinition<typeof schema, DeletePreview | DeleteResult> {
	return {
		name: "file_delete", label: "删除文件", parameters: schema,
		description: "Preview file/directory deletion (default dryRun=true), including bytes, uncommitted files and paths outside cwd. Real deletion checks read versions and waits for an irreversible-action gate except for task output or verified task-created files. Never bypass a refusal with shell.",
		execute: async (id, params, signal) => {
			const input: DeleteInput = structuredClone(params);
			assertActive(host, signal);
			if (!Array.isArray(input.paths) || !input.paths.length || input.paths.some((path) => typeof path !== "string" || !path.trim() || path.includes("\0"))) throw new Error("PATH_REQUIRED: 请提供非空文件路径清单");
			const requested = input.paths.map((path) => resolveToolPath(path, host.task.cwd));
			const result: DeleteResult = { deleted: 0, failed: [] };
			try {
				const plan = await planDeletion(requested, input.recursive === true, host.versions, signal);
				const output = canonicalTarget(host.task.outputDir);
				if (input.dryRun === false && host.task.mode === "readonly" && plan.nodes.some((node) => !containsPath(output, node.path))) {
					throw new Error("READONLY_TASK: 只读任务只能删除本任务产出目录内的文件");
				}
				const cwd = canonicalTarget(host.task.cwd);
				const preview: DeletePreview = {
					matched: plan.nodes.length,
					totalBytes: plan.nodes.reduce((sum, node) => sum + (node.kind === "file" ? node.size : 0), 0),
					preview: plan.nodes.slice(0, 50).map((node) => node.path),
					uncommitted: await uncommittedPaths(plan, input.recursive === true, signal),
					outsideCwd: plan.nodes.filter((node) => !containsPath(cwd, node.path)).map((node) => node.path),
				};
				assertActive(host, signal);
				if (input.dryRun !== false) return outputResult(preview);
				await assertReadVersions(plan, requested, host.versions, signal);
				const created = host.store.access(host.task.id).filter((entry) => entry.kind === "fs_write" && entry.created);
				const exempt = plan.nodes.every((node) => containsPath(output, node.path)) || plan.nodes.every((node) =>
					node.kind === "file" && node.version && host.versions.isCreated(node.version)
					&& created.some((entry) => { try { return samePath(canonicalTarget(entry.target), node.path); } catch { return false; } }));
				if (!exempt) {
					const decision = await host.gates.request(host.task, host.run.id, id, "file_delete", {
						paths: [...plan.roots], recursive: input.recursive === true, dryRun: false,
						manifest: plan.nodes, ...preview,
					}, {
						action: `删除 ${preview.matched} 个文件系统条目（文件共 ${preview.totalBytes} 字节）；含 ${preview.uncommitted.length} 项未提交改动、${preview.outsideCwd.length} 项 cwd 外目标。`,
						scope: plan.nodes.map((node) => node.path),
						alternative: "保留文件；使用 dryRun 查看影响，或缩小 paths 后重新请求。",
					}, signal);
					if (decision.value !== "allow") throw new Error(`GATE_DENIED: ${decision.reason}`);
				}
				assertActive(host, signal);
				// Re-scan every root before making any change. Approval never expands to new children.
				const current = await planDeletion(requested, input.recursive === true, host.versions, signal);
				if (!samePlan(plan, current)) throw new Error("STALE_FILE: 删除目标在预览或批准期间变化，请重新检查并发起请求");
				await assertReadVersions(plan, requested, host.versions, signal);
				for (const [index, node] of plan.nodes.entries()) {
					try {
						await withFileMutationQueue(node.path, async () => {
							assertActive(host, signal);
							await assertNode(node, plan, host.versions, signal);
							if (host.task.mode === "readonly" && !containsPath(canonicalTarget(host.task.outputDir), await entryPath(node.path))) throw new Error("READONLY_TASK: 删除目标已离开产出目录");
							assertActive(host, signal);
							// No recursive rm: rmdir refuses children added after the final check.
							if (node.kind === "directory") await rmdir(node.path);
							else await unlink(node.path);
							result.deleted++;
							host.versions.recordDeletion(node.path, node.kind === "link");
							host.store.recordAccess(host.task.id, { toolCallId: `${host.run.id}:${id}`, runId: host.run.id, tool: "file_delete", kind: "fs_delete", at: Date.now(), target: node.path });
						});
					} catch (error) {
						result.failed.push({ path: node.path, error: errorText(error) });
						// Stop after an error, including persistence failure; report every skipped target.
						for (const skipped of plan.nodes.slice(index + 1)) result.failed.push({ path: skipped.path, error: "NOT_ATTEMPTED: 前一项失败，未继续删除" });
						break;
					}
				}
				return outputResult(result);
			} catch (error) {
				if (input.dryRun !== false) throw error;
				result.failed.push(...requested.map((path) => ({ path, error: errorText(error) })));
				return outputResult(result);
			}
		},
	};
}

function outputResult(data: DeletePreview | DeleteResult) {
	return { content: [{ type: "text" as const, text: JSON.stringify(data) }], details: data,
		...("failed" in data && data.failed.length ? { isError: true } : {}) };
}

function assertActive(host: DeleteHost, signal?: AbortSignal): void {
	signal?.throwIfAborted();
	if (!host.isActive() || host.task.ended || host.run.endedAt) throw new Error("TASK_ENDED: 任务或运行已结束");
}

function samePath(a: string, b: string): boolean { return relative(a, b) === ""; }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

/** Resolve ancestors, never the final link. Removing a link must not delete its destination. */
async function entryPath(path: string): Promise<string> {
	if (samePath(resolve(path), parse(resolve(path)).root)) throw new Error("DELETE_ROOT: 不能删除文件系统根目录");
	return join(await realpath(dirname(path)), basename(path));
}

async function snapshot(path: string, versions: FileVersions, signal?: AbortSignal): Promise<DeleteNode> {
	signal?.throwIfAborted();
	const info = await lstat(path);
	const kind = info.isSymbolicLink() ? "link" : info.isDirectory() ? "directory" : info.isFile() ? "file" : undefined;
	if (!kind) throw new Error(`UNSUPPORTED_FILE: 不能删除特殊文件：${path}`);
	const node: DeleteNode = { path, kind, dev: info.dev, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs };
	if (kind === "link") node.link = await readlink(path);
	if (kind === "file") node.version = await versions.capture(path, signal);
	return node;
}

async function planDeletion(paths: string[], recursive: boolean, versions: FileVersions, signal?: AbortSignal): Promise<DeletePlan> {
	const roots: string[] = [];
	for (const path of paths) {
		const root = await entryPath(path);
		if (!roots.some((other) => samePath(other, root))) roots.push(root);
	}
	const nodes = new Map<string, DeleteNode>();
	async function visit(path: string): Promise<void> {
		const key = process.platform === "win32" ? path.toLowerCase() : path;
		if (nodes.has(key)) return;
		const node = await snapshot(path, versions, signal);
		if (node.kind === "directory") {
			const names = (await readdir(path)).sort();
			if (!recursive && names.length) throw new Error(`RECURSIVE_REQUIRED: 非空目录需要 recursive=true：${path}`);
			for (const name of names) await visit(join(path, name));
			if (!sameNode(node, await snapshot(path, versions, signal))) throw new Error(`STALE_FILE: 目录在扫描期间变化：${path}`);
		}
		nodes.set(key, node); // Children before their parent; empty directory deletion is last.
	}
	for (const root of roots) await visit(root);
	return { roots, nodes: [...nodes.values()].sort((a, b) => b.path.split(/[\\/]/).length - a.path.split(/[\\/]/).length || a.path.localeCompare(b.path)) };
}

function sameNode(a: DeleteNode, b: DeleteNode): boolean {
	return samePath(a.path, b.path) && a.kind === b.kind && a.dev === b.dev && a.ino === b.ino
		&& a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.link === b.link && a.version?.hash === b.version?.hash;
}

function samePlan(a: DeletePlan, b: DeletePlan): boolean {
	return a.roots.length === b.roots.length && a.roots.every((path, i) => samePath(path, b.roots[i]))
		&& a.nodes.length === b.nodes.length && a.nodes.every((node, i) => sameNode(node, b.nodes[i]));
}

async function assertReadVersions(plan: DeletePlan, requested: string[], versions: FileVersions, signal?: AbortSignal): Promise<void> {
	// Preserve lexical aliases too: a path read through a junction may have been retargeted.
	for (const path of requested) {
		const root = await entryPath(path);
		for (const node of plan.nodes) if (node.kind !== "directory" && containsPath(root, node.path)) {
			await versions.assertFresh(resolve(path, relative(root, node.path)), signal);
		}
	}
	for (const node of plan.nodes) if (node.kind !== "directory") await versions.assertFresh(node.path, signal, node.version);
}

async function assertNode(node: DeleteNode, plan: DeletePlan, versions: FileVersions, signal?: AbortSignal): Promise<void> {
	if (!samePath(await entryPath(node.path), node.path)) throw new Error(`STALE_FILE: 删除路径发生改指：${node.path}`);
	// Directory mtimes change as we remove children; identity must still match.
	for (const parent of plan.nodes.filter((item) => item.kind === "directory" && containsPath(item.path, node.path))) {
		const info = await lstat(parent.path);
		if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== parent.dev || info.ino !== parent.ino) throw new Error(`STALE_FILE: 目录已被替换：${parent.path}`);
	}
	if (node.kind !== "directory") {
		if (!sameNode(node, await snapshot(node.path, versions, signal))) throw new Error(`STALE_FILE: 删除目标已变化：${node.path}`);
		await versions.assertFresh(node.path, signal, node.version);
	}
}

/** Check every affected repository, including worktrees and nested repositories, with literal paths. */
async function uncommittedPaths(plan: DeletePlan, recursive: boolean, signal?: AbortSignal): Promise<string[]> {
	const repos = new Set<string>();
	const visited = new Map<string, string | undefined>();
	async function repository(dir: string): Promise<string | undefined> {
		if (visited.has(dir)) return visited.get(dir);
		const marker = await lstat(join(dir, ".git")).then(() => true, (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
			throw error;
		});
		const parent = dirname(dir);
		let found: string | undefined;
		if (marker) {
			try { found = (await git(dir, ["rev-parse", "--show-toplevel"], signal)).trim(); }
			catch (error) {
				// An unrelated empty .git directory in an ancestor is not a repository.
				if (!error || typeof error !== "object" || !("stderr" in error) || !/^fatal: not a git repository/m.test(String(error.stderr))) throw error;
			}
		}
		if (!found && parent !== dir) found = await repository(parent);
		visited.set(dir, found);
		return found;
	}
	for (const node of plan.nodes) {
		signal?.throwIfAborted();
		const repo = await repository(node.kind === "directory" ? node.path : dirname(node.path));
		if (repo) repos.add(repo);
	}
	const dirty = new Set<string>();
	for (const repo of repos) {
		const stdout = await git(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"], signal);
		const entries = stdout.split("\0");
		for (let i = 0; i < entries.length; i++) {
			const item = entries[i]; if (!item) continue;
			const names = [item.slice(3)];
			if (/[RC]/.test(item.slice(0, 2)) && entries[i + 1]) names.push(entries[++i]);
			for (const name of names) {
				const path = resolve(repo, name);
				if (plan.roots.some((root) => samePath(root, path) || (recursive && containsPath(root, path)))) dirty.add(path);
			}
		}
	}
	return [...dirty].sort();
}
