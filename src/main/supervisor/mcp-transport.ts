import { managedConfigCommand } from "./config-command.ts";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveConfigValueOrThrow, type McpConfigValueResolver, type McpTransportFactory } from "@rally/coding-agent";
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
		const resolved = value.startsWith("!") ? await managedConfigCommand(registry, { kind: "mcp", taskId }, cwd, value.slice(1), signal)
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

function expandHome(value: string): string {
	if (value === "~") return homedir();
	return value.startsWith("~/") || (process.platform === "win32" && value.startsWith("~\\")) ? join(homedir(), value.slice(2)) : value;
}
