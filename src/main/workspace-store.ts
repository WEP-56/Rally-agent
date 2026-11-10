import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { WorkspacePatch, WorkspaceState } from "../shared/workspace.ts";

/** Only the main conversation's default workspace is configurable. Worker directories are historical facts. */
export class WorkspaceStore {
	private value: WorkspaceState;
	private readonly file: string;

	constructor(rallyHome: string, defaultWorkspace: string) {
		this.file = join(rallyHome, "workspace.json");
		let saved: Partial<WorkspaceState> = {};
		if (existsSync(this.file)) saved = JSON.parse(readFileSync(this.file, "utf8"));
		this.value = {
			defaultWorkspace: this.directory(saved.defaultWorkspace ?? defaultWorkspace, true),
			recentProjects: Array.isArray(saved.recentProjects) ? saved.recentProjects.filter((path): path is string => typeof path === "string" && isAbsolute(path)).slice(0, 10) : [],
		};
	}

	state(): WorkspaceState {
		return structuredClone(this.value);
	}

	base(): string {
		return this.value.defaultWorkspace;
	}

	update(patch: WorkspacePatch): WorkspaceState {
		if (Object.keys(patch).some((key) => key !== "defaultWorkspace")) throw new Error("只可设置主对话默认工作区");
		const next = this.state();
		if (patch.defaultWorkspace !== undefined) next.defaultWorkspace = this.directory(patch.defaultWorkspace, true);
		return this.persist(next);
	}

	/** Recorded only when a worker actually starts; never used to choose a task cwd. */
	recordProject(path: string): WorkspaceState {
		const directory = this.directory(path, false);
		if (this.value.recentProjects[0]?.toLowerCase() === directory.toLowerCase()) return this.state();
		return this.persist({ ...this.state(), recentProjects: [directory, ...this.value.recentProjects.filter((item) => item.toLowerCase() !== directory.toLowerCase())].slice(0, 10) });
	}

	private persist(next: WorkspaceState): WorkspaceState {
		mkdirSync(dirname(this.file), { recursive: true });
		writeFileSync(`${this.file}.tmp`, `${JSON.stringify({ version: 1, ...next }, null, 2)}\n`);
		renameSync(`${this.file}.tmp`, this.file);
		this.value = next;
		return this.state();
	}

	private directory(path: string, create: boolean): string {
		if (typeof path !== "string" || !path.trim() || !isAbsolute(path)) throw new Error("目录必须是绝对路径");
		const absolute = resolve(path);
		if (create) mkdirSync(absolute, { recursive: true });
		if (!existsSync(absolute) || !statSync(absolute).isDirectory()) throw new Error(`目录不存在或不是文件夹：${absolute}`);
		const canonical = realpathSync.native(absolute);
		if (create) for (const name of ["notes", "reports", "repo"]) mkdirSync(join(canonical, name), { recursive: true });
		return canonical;
	}
}
