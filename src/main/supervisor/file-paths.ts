import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function resolveToolPath(input: string, cwd: string): string {
	let path = input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ").replace(/^@/, "");
	if (/^~([\\/]|$)/.test(path)) path = join(homedir(), path.slice(1));
	return resolve(cwd, path);
}

/** Resolve the closest existing ancestor too, so junctions cannot escape the output directory. */
export function canonicalTarget(path: string): string {
	if (existsSync(path)) return realpathSync(path);
	try {
		if (lstatSync(path).isSymbolicLink()) throw new Error("不能写入悬空符号链接");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const parent = dirname(path);
	if (parent === path) return path;
	return resolve(canonicalTarget(parent), relative(parent, path));
}

export function containsPath(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

export function withinOutput(output: string, path: string): boolean {
	return containsPath(canonicalTarget(output), canonicalTarget(path));
}
