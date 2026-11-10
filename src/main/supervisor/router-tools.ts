import { createFindToolDefinition, createGrepToolDefinition, createLsToolDefinition, createReadToolDefinition, type ToolDefinition } from "@rally/coding-agent";
import type { Static, TSchema } from "typebox";
import type { ProcessRegistry } from "./process-registry.ts";
import { managedSearchExecution } from "./search-process.ts";

/** Rebuild at execution time so relative paths follow the default workspace without recreating the session. */
export function createRouterReadTools(base: () => string, processes: ProcessRegistry): ToolDefinition[] {
	const execution = managedSearchExecution(processes, base);
	return [dynamic(createReadToolDefinition, base), dynamic(cwd => createGrepToolDefinition(cwd, { execution }), base), dynamic(cwd => createFindToolDefinition(cwd, { execution }), base), dynamic(createLsToolDefinition, base)];
}

function dynamic<P extends TSchema, R, S>(factory: (cwd: string) => ToolDefinition<P, R, S>, base: () => string): ToolDefinition {
	const tool = factory(base());
	return { name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters,
		promptSnippet: tool.promptSnippet, promptGuidelines: tool.promptGuidelines,
		execute: (id, params, signal, onUpdate, ctx) => {
			const cwd = base();
			return factory(cwd).execute(id, params as Static<P>, signal, onUpdate, { ...ctx, cwd });
		} };
}
