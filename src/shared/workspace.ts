/** Router directory preferences. Each task stores its own explicit cwd. */
export interface WorkspaceState {
	recentProjects: string[];
	defaultWorkspace: string;
}

export interface WorkspacePatch {
	defaultWorkspace?: string;
}
