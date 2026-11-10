import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProcessRegistry } from "./process-registry.ts";

export interface GithubResult { exitCode: number; output: string; fullOutputPath?: string }
export interface GithubRunOptions { signal?: AbortSignal; outputDir: string; stdin?: string; metadata?: boolean }
export type GithubRunner = (cwd: string, args: readonly string[], options: GithubRunOptions) => Promise<GithubResult>;

/** Always owned by the application; no shell and no detached unregistered CLI path. */
export function managedGithubRunner(processes: ProcessRegistry, taskId?: string): GithubRunner {
	return async (cwd, args, options) => {
		options.signal?.throwIfAborted();
		const env = { ...process.env };
		for (const key of Object.keys(env)) {
			// cwd / explicit --repo determine the target. Keep gh's existing credentials.
			if (/^(?:GH_REPO|GH_HOST|GH_DEBUG|GH_FORCE_TTY|GIT_(?:DIR|WORK_TREE|COMMON_DIR|CONFIG(?:_.*)?|TRACE.*))$/i.test(key)) delete env[key];
		}
		Object.assign(env, { GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", PAGER: "cat", GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1", NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" });
		const controller = new AbortController();
		const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
		let head = ""; let tail = ""; let stderr = ""; let count = 0;
		let file: number | undefined; let fullOutputPath: string | undefined; let storageError: unknown;
		const output = (chunk: string, errorStream = false) => {
			if (storageError) return;
			try {
				if (options.metadata) {
					if (count + chunk.length > 1024 * 1024) throw new Error("GITHUB_METADATA_TOO_LARGE: 仓库元数据超过上限");
					if (errorStream) stderr += chunk; else head += chunk;
					count += chunk.length; return;
				}
				if (file === undefined && count + chunk.length > 30000) {
					mkdirSync(options.outputDir, { recursive: true });
					fullOutputPath = join(options.outputDir, `github-${randomUUID()}.log`);
					file = openSync(fullOutputPath, "wx", 0o600); writeFileSync(file, head);
					head = (head + chunk).slice(0, 14000);
				}
				if (file !== undefined) writeFileSync(file, chunk); else head += chunk;
				tail = (tail + chunk).slice(-14000); count += chunk.length;
			} catch (error) { storageError = error; controller.abort(); }
		};
		try {
			const exitCode = await processes.run({ executable: "gh", args: [...args], cwd, env, stdin: options.stdin }, { kind: "github", taskId }, { signal, onStdout: chunk => output(chunk), onStderr: chunk => output(chunk, true) });
			if (storageError) throw storageError;
			options.signal?.throwIfAborted();
			return { exitCode, output: options.metadata && exitCode !== 0 ? stderr || head : fullOutputPath ? `${head}\n…（输出已截断；用 read 读取完整日志：${fullOutputPath}）…\n${tail}` : head, ...(fullOutputPath ? { fullOutputPath } : {}) };
		} catch (error) {
			if (storageError) throw storageError;
			if (options.signal?.aborted) throw new Error("GITHUB_ABORTED: 调用已取消；创建/评论可能已生效，请查询后再决定是否重试", { cause: error });
			throw error;
		} finally { if (file !== undefined) closeSync(file); }
	};
}
