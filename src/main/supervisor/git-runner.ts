import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface GitResult { exitCode: number; output: string; fullOutputPath?: string }
export interface GitRunOptions { signal?: AbortSignal; outputDir: string; readonly?: boolean; metadata?: boolean }
export type GitRunner = (cwd: string, args: readonly string[], options: GitRunOptions) => Promise<GitResult>;

/** Noninteractive argv execution; hooks remain enabled for worker mutations. */
export const runGit: GitRunner = async (cwd, args, options) => {
	options.signal?.throwIfAborted();
	const env = { ...process.env };
	// The explicit cwd is authoritative, including in linked worktrees.
	for (const name of Object.keys(env)) {
		if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|PREFIX|NAMESPACE|SHALLOW_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CEILING_DIRECTORIES|DISCOVERY_ACROSS_FILESYSTEM|CONFIG(?:_.*)?|TRACE.*)$/i.test(name)) delete env[name];
	}
	Object.assign(env, { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_PAGER: "cat", PAGER: "cat", GIT_EDITOR: "false", GIT_SEQUENCE_EDITOR: "false", GIT_MERGE_AUTOEDIT: "no" });
	const prefix = ["--no-pager"];
	if (options.readonly) {
		env.GIT_OPTIONAL_LOCKS = "0";
		env.GIT_NO_LAZY_FETCH = "1";
		// Trace2 config is read before command-line config, so disable targets via env.
		Object.assign(env, { GIT_TRACE2: "0", GIT_TRACE2_EVENT: "0", GIT_TRACE2_PERF: "0" });
		prefix.push("--no-optional-locks");
		for (const config of ["core.fsmonitor=false", "core.untrackedCache=false", "diff.autoRefreshIndex=false", "log.showSignature=false",
			// Pretty-format signature placeholders must not execute a configured signer.
			"gpg.program=", "gpg.openpgp.program=", "gpg.x509.program=", "gpg.ssh.program="]) prefix.push("-c", config);
	}
	const child = spawn("git", [...prefix, ...args], { cwd, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
	let head = ""; let tail = ""; let count = 0; let file: number | undefined; let fullOutputPath: string | undefined;
	let storageError: unknown;
	let termination: Promise<void> | undefined;
	const stop = () => { if (child.pid && !termination) termination = stopTree(child.pid); };
	const output = (chunk: string) => {
		if (storageError) return;
		try {
			if (options.metadata) {
				if (count + chunk.length > 16 * 1024 * 1024) throw new Error("GIT_METADATA_TOO_LARGE: 仓库元数据超出核对上限");
				head += chunk; count += chunk.length; return;
			}
			if (file === undefined && count + chunk.length > 30000) {
				mkdirSync(options.outputDir, { recursive: true });
				fullOutputPath = join(options.outputDir, `git-${randomUUID()}.log`);
				file = openSync(fullOutputPath, "wx", 0o600);
				writeFileSync(file, head);
				head = (head + chunk).slice(0, 14000);
			}
			if (file !== undefined) writeFileSync(file, chunk);
			else head += chunk;
			tail = (tail + chunk).slice(-14000);
			count += chunk.length;
		} catch (error) { storageError = error; stop(); }
	};
	child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
	child.stdout.on("data", output);
	// Machine-readable probes must not parse warnings as config/ref/URL data.
	child.stderr.on("data", options.metadata ? () => {} : output);
	options.signal?.addEventListener("abort", stop, { once: true });
	if (options.signal?.aborted) stop();
	try {
		const exitCode = await new Promise<number>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => resolve(code ?? (signal ? 130 : 1)));
		});
		if (termination) await termination;
		if (storageError) throw storageError;
		if (options.signal?.aborted) throw new Error("GIT_ABORTED: Git 调用已取消");
		return { exitCode, output: fullOutputPath ? `${head}\n…（输出已截断；用 read 读取完整日志：${fullOutputPath}）…\n${tail}` : head, ...(fullOutputPath ? { fullOutputPath } : {}) };
	} finally {
		options.signal?.removeEventListener("abort", stop);
		if (file !== undefined) closeSync(file);
	}
};

/** Only the process tree created for this invocation is eligible for cancellation. */
async function stopTree(pid: number): Promise<void> {
	if (process.platform !== "win32") {
		try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ } }
		return;
	}
	await new Promise<void>((resolve) => {
		const killer = spawn(join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/F", "/T", "/PID", String(pid)], { windowsHide: true, stdio: "ignore" });
		killer.once("error", () => { try { process.kill(pid); } catch { /* already exited */ } resolve(); });
		killer.once("close", () => resolve());
	});
}
