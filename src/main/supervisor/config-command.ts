import { getShellConfig } from "@rally/coding-agent";
import type { ProcessCommand } from "./process-host.ts";
import type { ProcessOwner, ProcessRegistry } from "./process-registry.ts";

export async function managedConfigCommand(registry: ProcessRegistry, owner: ProcessOwner, cwd: string, command: string, signal?: AbortSignal): Promise<string> {
	const invocation = configCommand(cwd, command); let output = "";
	let outputBytes = 0; let overflow = false;
	const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
	try {
		const code = await registry.run(invocation, owner, {
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
