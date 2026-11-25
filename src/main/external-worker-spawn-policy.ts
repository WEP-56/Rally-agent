import type { SpawnOptions } from "node:child_process";

/** Codex ACP starts codex.exe itself, so the host's windowsHide flag does not reach that child. */
export function hideCodexConsole(command: string, options: SpawnOptions | undefined, platform: string): SpawnOptions | undefined {
	const executable = command.split(/[\\/]/u).at(-1)?.toLowerCase();
	if (platform !== "win32" || (executable !== "codex.exe" && executable !== "codex")) return options;
	return { ...options, windowsHide: true };
}
