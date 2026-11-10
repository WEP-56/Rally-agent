import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ProjectTrustStore, SettingsManager } from "@rally/coding-agent";
import type { ProjectTrustState } from "../shared/trust.ts";

export function projectSettings(cwd: string, agentDir: string, loadProject: boolean): SettingsManager {
	return SettingsManager.create(cwd, agentDir, {
		projectTrusted: loadProject && new ProjectTrustStore(agentDir).get(cwd) === true,
	});
}

export function projectTrustState(agentDir: string, knownProjects: string[]): ProjectTrustState {
	const store = new ProjectTrustStore(agentDir);
	const paths = [...store.list().map((entry) => entry.path), ...knownProjects];
	const seen = new Set<string>();
	return { projects: paths.flatMap((path) => {
		const canonical = existsSync(path) ? realpathSync(path) : path;
		const key = process.platform === "win32" ? canonical.toLowerCase() : canonical;
		if (seen.has(key)) return [];
		seen.add(key);
		const entry = store.getEntry(canonical);
		const savedKey = entry && (process.platform === "win32" ? entry.path.toLowerCase() : entry.path);
		return [{ path: canonical, decision: entry?.decision ?? null,
			inheritedFrom: entry && savedKey !== key ? entry.path : undefined }];
	}) };
}

export function setProjectTrust(agentDir: string, path: string, trusted: boolean): void {
	if (typeof path !== "string" || !isAbsolute(path) || typeof trusted !== "boolean") throw new Error("无效的项目信任设置");
	// Revocation must also work for a saved directory that has been moved or deleted.
	if (trusted && (!existsSync(path) || !statSync(path).isDirectory())) throw new Error("请选择存在的项目目录");
	new ProjectTrustStore(agentDir).set(path, trusted);
}
