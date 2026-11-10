import { createCodemodeExtension, createMcpExtension, createToolSearchExtension, type ExtensionFactory, type ToolDefinition } from "@rally/coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { join } from "node:path";
import { McpStore } from "../mcp-store.ts";
import type { Task, TaskRun } from "../../shared/task.ts";
import type { GateService } from "./gates.ts";
import type { AuditLog } from "./audit.ts";

interface McpHost {
	gates: GateService;
	audit: AuditLog;
	external(tool: string): void;
}

/** Only these built-in extensions are enabled; project extension code stays disabled. */
export function workerMcpExtensions(agentDir: string, task: Task, run: TaskRun, isActive: () => boolean, host: McpHost): { extensions: ExtensionFactory[]; extensionTools: string[] } {
	const preferences = new McpStore(agentDir);
	const loaded = preferences.forProject(task.cwd);
	const exposures = new Set(loaded.servers.filter((entry) => entry.config.enabled !== false).flatMap((entry) => [entry.config.exposure ?? "direct", ...Object.values(entry.config.toolExposure ?? {})]));
	const extensionTools = ["mcp__*", "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"];
	if (exposures.has("codemode")) extensionTools.push("codemode");
	if (exposures.has("deferred")) extensionTools.push("tool_search");
	const mcp = createMcpExtension({
		loadConfig: () => ({ ...loaded, servers: loaded.servers.map((entry) => ({ ...entry, config: { ...entry.config, exposure: entry.config.exposure ?? "direct" } })) }),
		logPath: join(agentDir, "mcp.log"),
	});
	return { extensionTools, extensions: [
		(pi) => {
			pi.on("tool_call", async (event, ctx) => {
				if (!isActive()) return { block: true, reason: "TASK_ENDED: The task or run has ended." };
				if (!event.toolName.startsWith("mcp__")) return;
				const input = event.input as Record<string, unknown>;
				try {
					const tier = preferences.tier(event.toolName);
					const args = input.arguments;
					if (!args || typeof args !== "object" || Array.isArray(args)) return { block: true, reason: "MCP_ARGUMENTS_REQUIRED: Put the server's parameters in arguments." };
					const approvedArgs = structuredClone(args) as Record<string, unknown>;
					if (tier === "irreversible") {
						const decision = await host.gates.request(task, run.id, event.toolCallId, event.toolName, approvedArgs, input.approval, ctx.signal);
						if (decision.value !== "allow") return { block: true, reason: `GATE_DENIED: ${decision.reason}` };
						if (!isActive() || ctx.signal?.aborted) return { block: true, reason: "TASK_ENDED: The task or run has ended." };
					} else if (tier === "external") {
						host.audit.append("external", { taskId: task.id, runId: run.id, toolCallId: event.toolCallId, action: event.toolName, cwd: task.cwd, target: approvedArgs, result: "attempt" });
						host.external(event.toolName);
					}
					// Pin exactly the reviewed server arguments, including nested values.
					input.arguments = approvedArgs;
				} catch (error) {
					const code = error instanceof Error && "code" in error ? `${String(error.code)}: ` : "";
					return { block: true, reason: `${code}${error instanceof Error ? error.message : String(error)}` };
				}
			});
		},
		createCodemodeExtension({ models: false }),
		createToolSearchExtension(),
		(pi) => mcp({ ...pi, registerTool: (tool) => {
			if (!tool.name.startsWith("mcp__")) { pi.registerTool(tool); return; }
			preferences.recordTool(tool.name);
			pi.registerTool(wrapMcpTool(tool));
		} }),
	] };
}

/** Preserve arbitrary server schemas; host approval metadata never becomes a server argument. */
function wrapMcpTool<P extends TSchema, D, S>(tool: ToolDefinition<P, D, S>): ToolDefinition<TSchema, D> {
	return {
		name: tool.name, label: tool.label, description: `${tool.description}\nRally: pass server parameters in arguments. For an irreversible action include approval describing the action, affected scope and alternative. Rally supplies cwd and waits for authorization.`,
		exposure: tool.exposure, namespace: tool.namespace, annotations: tool.annotations, outputSchema: tool.outputSchema,
		defaultActive: tool.defaultActive, executionMode: tool.executionMode,
		parameters: Type.Object({ arguments: tool.parameters, approval: Type.Optional(Type.Object({
			action: Type.String({ minLength: 1 }), scope: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }), alternative: Type.String({ minLength: 1 }),
		})) }),
		execute: (id, params, signal, onUpdate, ctx) => tool.execute(id, (params as { arguments: Static<P> }).arguments, signal, onUpdate, ctx),
	};
}
