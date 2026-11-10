import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getShellConfig, resolveConfigValueOrThrow, type McpConfigValueResolver, type McpTransportFactory } from "@rally/coding-agent";
import { PipeTransport, StreamableHttpTransport, type McpPipe, type McpPipeHandlers } from "@rally/mcp";
import type { ProcessCommand } from "./process-host.ts";
import type { ManagedProcess, ProcessRegistry } from "./process-registry.ts";

/** Keep Pi's wire protocol/OAuth behavior; own stdio and configuration commands in Rally's registry. */
export function managedMcpTransport(registry: ProcessRegistry, taskId: string): McpTransportFactory {
	const resolveValue = managedMcpConfigValue(registry, taskId);
	return async (entry, cwd, authProvider, signal) => {
		const config = entry.config;
		const settingSignal = signal ?? new AbortController().signal;
		const resolveValues = async (values?: Record<string, string>) => {
			const result: Record<string, string> = {};
			for (const [key, value] of Object.entries(values ?? {})) {
				signal?.throwIfAborted();
				result[key] = await resolveValue(value, `MCP server "${entry.name}" value "${key}"`, cwd, settingSignal);
			}
			return result;
		};
		if ("url" in config) return new StreamableHttpTransport({ url: config.url, headers: await resolveValues(config.headers), authProvider });
		const env = { ...process.env, ...await resolveValues(config.env) };
		signal?.throwIfAborted();
		return new ManagedStdioTransport(registry, taskId, {
			executable: expandHome(config.command), args: (config.args ?? []).map(expandHome),
			cwd: resolve(cwd, expandHome(config.cwd ?? ".")), env, windowsShim: true,
		});
	};
}

export function managedMcpConfigValue(registry: ProcessRegistry, taskId: string): McpConfigValueResolver {
	return async (value, description, cwd, signal) => {
		signal.throwIfAborted();
		const resolved = value.startsWith("!") ? await commandValue(registry, taskId, cwd, value.slice(1), signal)
			: resolveConfigValueOrThrow(value, description);
		signal.throwIfAborted();
		return resolved;
	};
}

/** PipeTransport owns framing; this wrapper also waits for cancellation during open(). */
export class ManagedStdioTransport extends PipeTransport {
	private readonly control: { process?: ManagedProcess; opening?: Promise<McpPipe>; ready: boolean; controller: AbortController };
	private closing?: Promise<void>;
	constructor(registry: ProcessRegistry, taskId: string, command: ProcessCommand) {
		const control: ManagedStdioTransport["control"] = { ready: false, controller: new AbortController() };
		const open = async (handlers: McpPipeHandlers): Promise<McpPipe> => {
			const child = registry.open(command, { kind: "mcp", taskId }, {
				signal: control.controller.signal,
				onStdout: text => handlers.onStdout(Buffer.from(text)), onStderr: text => handlers.onStderr(Buffer.from(text)),
			});
			control.process = child;
			const input = await child.ready; control.ready = true;
			return { write: data => input.write(data), closeStdin: () => input.end(), close: () => child.close(), exited: child.exited };
		};
		super({ open: handlers => control.opening = open(handlers), closeTimeoutMs: 500 });
		this.control = control;
	}
	override close(): Promise<void> {
		if (this.closing) return this.closing;
		if (!this.control.ready) this.control.controller.abort();
		this.closing = (async () => {
			await super.close();
			await this.control.opening?.catch(() => {});
			await this.control.process?.exited.catch(() => {});
		})();
		return this.closing;
	}
}

async function commandValue(registry: ProcessRegistry, taskId: string, cwd: string, command: string, signal?: AbortSignal): Promise<string> {
	const invocation = configCommand(cwd, command); let output = "";
	let outputBytes = 0; let overflow = false;
	const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
	try {
		const code = await registry.run(invocation, { kind: "mcp", taskId }, {
			signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
			onStdout: text => {
				if (overflow) return;
				outputBytes += Buffer.byteLength(text);
				if (outputBytes > 1024 * 1024) { overflow = true; throw new Error("MCP_CONFIG_OUTPUT_LIMIT"); }
				output += text;
			},
			onStderr: () => {}, abortGraceMs: () => controller.signal.aborted ? 0 : 5000,
		});
		if (code !== 0 || !output.trim()) throw new Error("MCP_CONFIG_COMMAND_FAILED: 配置取值命令失败或输出为空");
		return output.trim();
	} finally { clearTimeout(timer); }
}

/** Match Pi's configuration command shell selection, with asynchronous owned execution. */
function configCommand(cwd: string, command: string): ProcessCommand {
	const env = { ...process.env };
	if (process.platform !== "win32") return { executable: "/bin/sh", args: ["-c", command], cwd, env };
	try {
		const config = getShellConfig();
		return { executable: config.shell, args: config.commandTransport === "stdin" ? [...config.args] : [...config.args, command],
			...(config.commandTransport === "stdin" ? { stdin: command } : {}), cwd, env };
	} catch {
		return { executable: process.env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${command}"`], windowsVerbatimArguments: true, cwd, env };
	}
}

function expandHome(value: string): string {
	if (value === "~") return homedir();
	return value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\")) ? join(homedir(), value.slice(2)) : value;
}
