import { fileURLToPath } from "node:url";
import { resolveRallyPaths } from "../../../../src/main/paths.ts";
import { ProcessRegistry } from "../../../../src/main/supervisor/process-registry.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";

const paths = resolveRallyPaths(process.argv[2]);
const lock = new StateDirectoryLock(paths.stateDir);
const registry = new ProcessRegistry(paths.stateDir, { assertWritable: () => lock.assertHeld(), graceMs: 50, hostPath: process.argv[3] });
let output = "";
void registry.run({ executable: process.execPath, args: [fileURLToPath(new URL("./rally-process-tree.cjs", import.meta.url))], cwd: process.argv[2], env: process.env }, { kind: "git", taskId: "fixture-owner" }, {
	onStdout: data => { output += data; if (output.includes("\n")) process.send?.({ type: "ready", ...JSON.parse(output.trim()) }); },
	onStderr: () => {},
}).catch(error => process.send?.({ type: "failed", error: String(error) }));
