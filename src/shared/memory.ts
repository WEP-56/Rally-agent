export interface MemoryState {
	path: string;
	exists: boolean;
	bytes: number;
	entries: number;
	estimatedTokens: number;
	overBudget: boolean;
	error?: string;
}
