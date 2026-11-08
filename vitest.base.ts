import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Shared vitest config for the vendored Pi packages: workspace imports resolve to source, so tests need no build.
export const workspaceSourcePaths = {
	telemetryIndex: fileURLToPath(new URL("./packages/telemetry/src/index.ts", import.meta.url)),
	telemetryTesting: fileURLToPath(new URL("./packages/telemetry/src/testing/index.ts", import.meta.url)),
	mcpIndex: fileURLToPath(new URL("./packages/mcp/src/index.ts", import.meta.url)),
	mcpOAuth: fileURLToPath(new URL("./packages/mcp/src/oauth/index.ts", import.meta.url)),
	mcpTesting: fileURLToPath(new URL("./packages/mcp/src/testing/index.ts", import.meta.url)),
	aiIndex: fileURLToPath(new URL("./packages/ai/src/index.ts", import.meta.url)),
	aiCompat: fileURLToPath(new URL("./packages/ai/src/compat.ts", import.meta.url)),
	aiModels: fileURLToPath(new URL("./packages/ai/src/models.ts", import.meta.url)),
	aiOAuth: fileURLToPath(new URL("./packages/ai/src/oauth.ts", import.meta.url)),
	aiApi: fileURLToPath(new URL("./packages/ai/src/api", import.meta.url)),
	aiProviders: fileURLToPath(new URL("./packages/ai/src/providers", import.meta.url)),
	aiUtils: fileURLToPath(new URL("./packages/ai/src/utils", import.meta.url)),
	agentIndex: fileURLToPath(new URL("./packages/agent/src/index.ts", import.meta.url)),
	codemodeIndex: fileURLToPath(new URL("./packages/codemode/src/index.ts", import.meta.url)),
	codemodeDeclarations: fileURLToPath(new URL("./packages/codemode/src/declarations.ts", import.meta.url)),
	codemodeSource: fileURLToPath(new URL("./packages/codemode/src/source.ts", import.meta.url)),
	codingAgentIndex: fileURLToPath(new URL("./packages/coding-agent/src/index.ts", import.meta.url)),
	tuiIndex: fileURLToPath(new URL("./packages/tui/src/index.ts", import.meta.url)),
} as const;

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^@rally\/telemetry$/, replacement: workspaceSourcePaths.telemetryIndex },
			{ find: /^@rally\/telemetry\/testing$/, replacement: workspaceSourcePaths.telemetryTesting },
			{ find: /^@rally\/mcp$/, replacement: workspaceSourcePaths.mcpIndex },
			{ find: /^@rally\/mcp\/oauth$/, replacement: workspaceSourcePaths.mcpOAuth },
			{ find: /^@rally\/mcp\/testing$/, replacement: workspaceSourcePaths.mcpTesting },
			{ find: /^@rally\/ai$/, replacement: workspaceSourcePaths.aiIndex },
			{ find: /^@rally\/ai\/compat$/, replacement: workspaceSourcePaths.aiCompat },
			{ find: /^@rally\/ai\/models$/, replacement: workspaceSourcePaths.aiModels },
			{ find: /^@rally\/ai\/oauth$/, replacement: workspaceSourcePaths.aiOAuth },
			{
				find: /^@rally\/ai\/utils\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiUtils}/$1.ts`,
			},
			{
				find: /^@rally\/ai\/api\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiApi}/$1.ts`,
			},
			{
				find: /^@rally\/ai\/providers\/(.+)$/,
				replacement: `${workspaceSourcePaths.aiProviders}/$1.ts`,
			},
			{ find: /^@rally\/agent-core$/, replacement: workspaceSourcePaths.agentIndex },
			{ find: /^@rally\/codemode$/, replacement: workspaceSourcePaths.codemodeIndex },
			{ find: /^@rally\/codemode\/declarations$/, replacement: workspaceSourcePaths.codemodeDeclarations },
			{ find: /^@rally\/codemode\/source$/, replacement: workspaceSourcePaths.codemodeSource },
			{ find: /^@rally\/tui$/, replacement: workspaceSourcePaths.tuiIndex },
		],
	},
});
