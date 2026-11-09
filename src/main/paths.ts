// Rally's on-disk layout (docs/superagent/04 section 1). Pure path math; ensureRallyDirs creates them.

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RallyPaths } from "../shared/ipc.ts";

/** Resolve all Rally paths under the given home directory. */
export function resolveRallyPaths(home = homedir()): RallyPaths {
	const rallyHome = join(home, ".rally");
	const agentDir = join(rallyHome, "agent");
	const sessionsDir = join(agentDir, "sessions");
	const stateDir = join(rallyHome, "state");
	return {
		home: rallyHome,
		agentDir,
		mainCwd: join(agentDir, "main"),
		sessionsDir,
		sessionsMainDir: join(sessionsDir, "main"),
		sessionsTasksDir: join(sessionsDir, "tasks"),
		modelsFile: join(agentDir, "rally-models.json"),
		stateDir,
		eventsFile: join(stateDir, "events-0001.jsonl"),
		snapshotFile: join(stateDir, "snapshot.json"),
		auditFile: join(stateDir, "audit.jsonl"),
		jobsDir: join(stateDir, "jobs"),
		memoryFile: join(rallyHome, "memory", "MEMORY.md"),
		workspaceDir: join(home, "rally"),
	};
}

/** Create the directories Rally writes into. The default workspace is created lazily by tasks. */
export function ensureRallyDirs(paths: RallyPaths): void {
	for (const dir of [
		paths.agentDir,
		paths.mainCwd,
		paths.sessionsDir,
		paths.sessionsMainDir,
		paths.sessionsTasksDir,
		paths.stateDir,
		paths.jobsDir,
		dirname(paths.memoryFile),
	]) {
		mkdirSync(dir, { recursive: true });
	}
}
