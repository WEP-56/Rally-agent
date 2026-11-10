// M0 smoke check: create an in-memory Pi session under ~/.rally/agent, list its tools, and verify nothing was written to ~/.pi.

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, createAgentSession, getAgentDir, SessionManager, VERSION } from "@rally/coding-agent";
import type { RallyPaths } from "../shared/ipc.ts";

/** Result printed as JSON by `RALLY_SMOKE=1`. */
export interface SmokeResult {
	ok: boolean;
	piVersion: string;
	configDirName: string;
	agentDir: string;
	model: string | null;
	modelFallbackMessage: string | null;
	activeTools: string[];
	allTools: string[];
	piDirWrites: string[];
	error?: string;
}

/** Run the smoke check. Never throws; failures are reported in the result. */
export async function runSmoke(paths: RallyPaths): Promise<SmokeResult> {
	const startedAt = Date.now();
	const piDir = join(homedir(), ".pi");
	const result: SmokeResult = {
		ok: false,
		piVersion: VERSION,
		configDirName: CONFIG_DIR_NAME,
		agentDir: getAgentDir(),
		model: null,
		modelFallbackMessage: null,
		activeTools: [],
		allTools: [],
		piDirWrites: [],
	};
	try {
		const { session, modelFallbackMessage } = await createAgentSession({
			cwd: paths.mainCwd,
			agentDir: paths.agentDir,
			sessionManager: SessionManager.inMemory(paths.mainCwd),
			tools: ["read", "grep", "find", "ls"],
		});
		result.model = session.model ? `${session.model.provider}/${session.model.id}` : null;
		result.modelFallbackMessage = modelFallbackMessage ?? null;
		result.activeTools = session.getActiveToolNames();
		result.allTools = session.getAllTools().map((tool) => tool.name);
		session.dispose();
	} catch (error) {
		result.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
	}
	result.piDirWrites = listWritesSince(piDir, startedAt);
	result.ok =
		result.error === undefined &&
		result.configDirName === ".rally" &&
		result.agentDir === paths.agentDir &&
		result.activeTools.length > 0 &&
		result.piDirWrites.length === 0;
	return result;
}

// ~/.pi may belong to a real Pi install, so only report files touched during this run.
function listWritesSince(dir: string, since: number): string[] {
	if (!existsSync(dir)) return [];
	const touched: string[] = [];
	for (const entry of readdirSync(dir, { recursive: true, encoding: "utf-8" })) {
		const full = join(dir, entry);
		try {
			if (statSync(full).mtimeMs >= since) touched.push(full);
		} catch {
			// Removed while walking.
		}
	}
	return touched;
}
