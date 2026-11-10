import { createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, type ToolDefinition } from "@rally/coding-agent";
import type { Static, TSchema } from "typebox";
import type { ProcessRegistry } from "./process-registry.ts";
import { managedSearchExecution } from "./search-process.ts";
import { basename } from "node:path";
import { assertNotSkillBody } from "./capability-catalog.ts";

/** Rebuild at execution time so relative paths follow the default workspace without recreating the session. */
export function createRouterReadTools(base: () => string, processes: ProcessRegistry, skillPaths: () => readonly string[] = () => []): ToolDefinition[] {
	const execution = managedSearchExecution(processes, base);
	const grepExecution = { ...execution, spawn: (executable: string, args: string[], cwd?: string) => {
		const separator = args.indexOf("--");
		const exclusions = [...new Set(["SKILL.md", ...skillPaths().map(path => basename(path))])].flatMap(name => ["--iglob", `!${name.replace(/[?*\[\]{}]/g, character => `\\${character}`)}`]);
		return execution.spawn(executable, [...args.slice(0, separator), ...exclusions, ...args.slice(separator)], cwd);
	} };
	return [dynamic(createReadToolDefinition, base, skillPaths), dynamic(cwd => createGrepToolDefinition(cwd, { execution: grepExecution }), base, skillPaths), dynamic(cwd => createFindToolDefinition(cwd, { execution }), base), dynamic(createLsToolDefinition, base)];
}

function dynamic<P extends TSchema, R, S>(factory: (cwd: string) => ToolDefinition<P, R, S>, base: () => string, skillPaths?: () => readonly string[]): ToolDefinition {
	const tool = factory(base());
	return { name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters,
		promptSnippet: tool.promptSnippet, promptGuidelines: tool.promptGuidelines,
		execute: (id, params, signal, onUpdate, ctx) => {
			const cwd = base();
			if (skillPaths && params && typeof params === "object" && "path" in params && typeof params.path === "string") assertNotSkillBody(params.path, cwd, skillPaths());
			return factory(cwd).execute(id, params as Static<P>, signal, onUpdate, { ...ctx, cwd });
		} };
}
