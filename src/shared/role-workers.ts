export type RoleWorkerExecutor = "rally" | "claude-code" | "codex";

export interface RoleWorkerProfile {
	id: string;
	name: string;
	avatar: string | null;
	summary: string;
	personality: string;
	workstyle: string;
	model?: { provider: string; model: string };
	executor?: RoleWorkerExecutor;
	externalModel?: string;
	recommendedSkills: string[];
	createdAt: number;
	updatedAt: number;
}

export interface RoleWorkerDraft {
	id: string;
	name: string;
	avatar: string | null;
	summary: string;
	personality: string;
	workstyle: string;
	model?: { provider: string; model: string };
	executor?: RoleWorkerExecutor;
	externalModel?: string;
	recommendedSkills: string[];
}

export interface ExternalAgentModel {
	id: string;
	name: string;
}

export const ROLE_WORKER_LIMITS = {
	count: 40,
	name: 40,
	summary: 500,
	personality: 4000,
	workstyle: 4000,
	recommendedSkills: 20,
} as const;
