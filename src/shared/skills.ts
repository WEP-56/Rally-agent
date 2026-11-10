export interface SkillEntry {
	path: string;
	name: string;
	description: string;
	enabled: boolean;
	projects: string[];
}

export interface SkillsState {
	skills: SkillEntry[];
	diagnostics: string[];
}
