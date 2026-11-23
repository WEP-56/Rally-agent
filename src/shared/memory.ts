/** The notebook Rally keeps about its user: three Markdown files under ~/.rally/memory. */
export const MEMORY_FILES = {
	USER: { name: "USER.md", budget: 3000 },
	PREFERENCES: { name: "PREFERENCES.md", budget: 4500 },
	RECENT: { name: "RECENT.md", budget: 4500 },
} as const;
export type MemoryFileKey = keyof typeof MEMORY_FILES;
export const MEMORY_FILE_KEYS = Object.keys(MEMORY_FILES) as MemoryFileKey[];

export interface MemoryFileState {
	key: MemoryFileKey;
	path: string;
	exists: boolean;
	bytes: number;
	/** UTF-8 byte budget; writes that would exceed it are rejected. */
	budget: number;
}
export interface MemoryState {
	dir: string;
	files: MemoryFileState[];
	error?: string;
}
