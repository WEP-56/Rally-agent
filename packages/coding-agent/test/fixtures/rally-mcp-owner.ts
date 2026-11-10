import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpClient } from "@rally/mcp";
import { resolveRallyPaths } from "../../../../src/main/paths.ts";
import { ManagedStdioTransport } from "../../../../src/main/supervisor/mcp-transport.ts";
import { ProcessRegistry } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";

const paths = resolveRallyPaths(process.argv[2]); const lock = new StateDirectoryLock(paths.stateDir);
const registry = new ProcessRegistry(paths.stateDir, { assertWritable: () => lock.assertHeld(), graceMs: 50, hostPath: process.argv[3] });
const transport = new ManagedStdioTransport(registry, "T-mcp", { executable: process.execPath,
	args: [fileURLToPath(new URL("./rally-mcp-process.cjs", import.meta.url)), join(process.argv[2], "mcp.json"), registry.file, "tree"], cwd: process.argv[2], env: process.env });
const client = new McpClient({ name: "fixture", version: "1" }); await client.connect(transport);
process.send?.({ type: "ready" });
