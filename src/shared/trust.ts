export interface ProjectTrustEntry {
	path: string;
	decision: boolean | null;
	inheritedFrom?: string;
}

export interface ProjectTrustState { projects: ProjectTrustEntry[] }
