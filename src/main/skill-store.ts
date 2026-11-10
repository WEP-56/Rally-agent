import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DefaultResourceLoader, loadSkillsFromDir, type Skill } from "@rally/coding-agent";
import type { SkillsState } from "../shared/skills.ts";
import { projectSettings } from "./project-trust.ts";

interface SkillPreferences { version: 1; paths: string[]; disabled: string[] }

/** UI preferences apply to future worker sessions. Imported directories stay in place. */
export class SkillStore {
	private readonly file: string;
	constructor(agentDir: string) {
		this.agentDir = agentDir;
		this.file = join(agentDir, "rally-skills.json");
	}
	private readonly agentDir: string;

	private read(): SkillPreferences {
		if (!existsSync(this.file)) return { version: 1, paths: [], disabled: [] };
		const value: unknown = JSON.parse(readFileSync(this.file, "utf8"));
		if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
			!("paths" in value) || !Array.isArray(value.paths) || !value.paths.every((path) => typeof path === "string" && isAbsolute(path)) ||
			!("disabled" in value) || !Array.isArray(value.disabled) || !value.disabled.every((path) => typeof path === "string" && isAbsolute(path))) {
			throw new Error("Skills 配置无效，请检查 rally-skills.json");
		}
		return { version: 1, paths: value.paths, disabled: value.disabled };
	}
	private save(value: SkillPreferences): void {
		writeFileSync(`${this.file}.tmp`, JSON.stringify(value, null, 2), "utf8");
		renameSync(`${this.file}.tmp`, this.file);
	}
	loaderOptions() {
		const preferences = this.read();
		return {
			additionalSkillPaths: preferences.paths,
			skillsOverride: <T extends { skills: Skill[] }>(base: T): T => ({ ...base,
				skills: base.skills.filter((skill) => !preferences.disabled.includes(skillKey(skill.filePath))),
			}),
		};
	}
	async state(projects: string[]): Promise<SkillsState> {
		const preferences = this.read();
		const entries = new Map<string, SkillsState["skills"][number]>();
		const diagnostics: string[] = [];
		for (const cwd of new Set(projects)) {
			if (!existsSync(cwd)) { diagnostics.push(`目录不可用：${cwd}`); continue; }
			const loader = new DefaultResourceLoader({ cwd, agentDir: this.agentDir,
				settingsManager: projectSettings(cwd, this.agentDir, true),
				noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
				systemPrompt: "", appendSystemPrompt: [], additionalSkillPaths: preferences.paths });
			await loader.reload();
			const loaded = loader.getSkills();
			for (const skill of loaded.skills) {
				const key = skillKey(skill.filePath);
				const entry = entries.get(key) ?? { path: skill.filePath, name: skill.name, description: skill.description,
					enabled: !preferences.disabled.includes(key), projects: [] };
				entry.projects.push(cwd);
				entries.set(key, entry);
			}
			diagnostics.push(...loaded.diagnostics.map((item) => `${item.path}: ${item.message}`));
		}
		return { skills: [...entries.values()], diagnostics: [...new Set(diagnostics)] };
	}
	importDirectory(path: string): void {
		if (typeof path !== "string" || !isAbsolute(path)) throw new Error("请选择 skills 的绝对目录");
		const loaded = loadSkillsFromDir({ dir: path, source: "path" });
		if (!loaded.skills.length) throw new Error("目录中未发现有效 skill（需要 SKILL.md 和 description）");
		const preferences = this.read();
		const canonical = realpathSync(path);
		if (!preferences.paths.includes(canonical)) preferences.paths.push(canonical);
		this.save(preferences);
	}
	async setEnabled(path: string, enabled: boolean, projects: string[]): Promise<void> {
		if (typeof path !== "string" || !isAbsolute(path) || typeof enabled !== "boolean") throw new Error("无效的 skill 设置");
		const key = skillKey(path);
		const state = await this.state(projects);
		if (!state.skills.some((skill) => skillKey(skill.path) === key)) throw new Error("Skill 已不存在，请刷新列表");
		const preferences = this.read();
		preferences.disabled = preferences.disabled.filter((item) => item !== key);
		if (!enabled) preferences.disabled.push(key);
		this.save(preferences);
	}
}

function skillKey(path: string): string {
	const canonical = existsSync(path) ? realpathSync(path) : resolve(path);
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}
