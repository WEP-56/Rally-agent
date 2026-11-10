import { EventEmitter } from "node:events";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { getBinDir, type SearchExecution, type SearchProcess } from "@rally/coding-agent";
import type { ProcessRegistry } from "./process-registry.ts";

export function managedSearchExecution(registry: ProcessRegistry, base: () => string, taskId?: string): SearchExecution {
	return {
		resolveTool: async (tool, signal) => {
			signal?.throwIfAborted();
			const suffix = process.platform === "win32" ? ".exe" : "";
			const names = tool === "fd" ? ["fd", "fdfind"] : ["rg"];
			// A filesystem lookup avoids running an unowned --version probe in the main process.
			const paths = [join(getBinDir(), `${tool}${suffix}`), ...(process.env.PATH ?? "").split(delimiter)
				.filter(Boolean).flatMap(directory => names.map(name => join(directory.replace(/^"|"$/g, ""), `${name}${suffix}`)))];
			for (const path of paths) { try { if (statSync(path).isFile()) { accessSync(path, constants.X_OK); return path; } } catch {} }
			const host = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./search-tool-host.ts" : "./search-tool-host.js", import.meta.url));
			let output = "";
			const code = await registry.run({ executable: process.execPath, args: [host, tool], cwd: base(), env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } }, { kind: "search", taskId }, {
				signal, onStdout: text => { output += text; if (output.length > 65536) throw new Error("SEARCH_RESOLVER_OUTPUT_LIMIT"); }, onStderr: () => {},
			});
			if (code !== 0) throw new Error("SEARCH_TOOL_UNAVAILABLE: 搜索工具准备失败");
			const result: unknown = JSON.parse(output);
			return result && typeof result === "object" && "path" in result && typeof result.path === "string" ? result.path : undefined;
		},
		spawn: (executable, args, cwd) => new ManagedSearchProcess(registry, executable, args, cwd ?? base(), taskId),
	};
}

class ManagedSearchProcess extends EventEmitter implements SearchProcess {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly controller = new AbortController();
	killed = false;
	constructor(registry: ProcessRegistry, executable: string, args: string[], cwd: string, taskId?: string) {
		super();
		const run = registry.run({ executable, args, cwd, env: { ...process.env } }, { kind: "search", taskId }, {
			signal: this.controller.signal,
			onStdout: text => { this.stdout.write(text); }, onStderr: text => { this.stderr.write(text); },
		});
		void run.then(code => this.end(code), error => this.end(130, this.killed && !registry.failed ? undefined : error));
	}
	kill(): boolean { if (this.killed) return false; this.killed = true; this.controller.abort(); return true; }
	private async end(code: number, error?: unknown): Promise<void> {
		this.stdout.end(); this.stderr.end();
		await Promise.all([finished(this.stdout), finished(this.stderr)]);
		if (error) this.emit("error", error instanceof Error ? error : new Error(String(error)));
		this.emit("close", code);
	}
}
