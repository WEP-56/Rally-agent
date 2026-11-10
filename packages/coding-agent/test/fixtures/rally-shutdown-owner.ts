import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";
import { ApplicationShutdown } from "../../../../src/main/application-shutdown.ts";
import { ProcessShutdownGuard } from "../../../../src/main/shutdown-guard.ts";

const paths = resolveRallyPaths(process.argv[2]); ensureRallyDirs(paths);
const mode = process.argv[3];
const send = (message: unknown) => new Promise<void>((resolve, reject) => process.send?.(message, error => error ? reject(error) : resolve()));
const shutdown = new ApplicationShutdown({
	guard: new ProcessShutdownGuard(process.argv[4]), timeoutMs: mode === "normal" ? 12000 : 1500,
	close: () => supervisor.dispose(), exit: code => process.exit(code), report: error => console.error(error),
});
const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {}, onStartupFailure: async () => {
	await shutdown.prepare(); await send({ type: "armed" }); void shutdown.run(true);
} });
const task = supervisor.store.create({ title: "Shutdown recovery", cwd: paths.workspaceDir, mode: "write", scope: [], dependsOn: [], autoApprove: false, quotes: [] }).task;
supervisor.store.startRun(task.id, "dispatch", "fixture");
let output = ""; let ready!: (value: { root: number; leaf: number }) => void;
const tree = new Promise<{ root: number; leaf: number }>(resolve => { ready = resolve; });
void supervisor.processes.run({ executable: process.execPath, args: [fileURLToPath(new URL("./rally-process-tree.cjs", import.meta.url))], cwd: paths.workspaceDir, env: process.env }, { kind: "mcp", taskId: task.id }, {
	onStdout: text => { output += text; if (output.includes("\n")) ready(JSON.parse(output)); }, onStderr: () => {},
}).catch(() => {});
const pids = await tree;
if (mode === "block" || mode === "startup") supervisor.main.dispose = () => { for (;;) { /* deliberate third-party synchronous deadlock */ } };
else if (mode === "hang") supervisor.main.dispose = () => new Promise<void>(() => {});
if (mode === "startup") supervisor.main.start = async () => { throw new Error("fixture startup failure"); };
process.on("message", async command => {
	if (command !== "shutdown") return;
	if (mode === "startup") { void supervisor.start().catch(() => {}); return; }
	await shutdown.prepare(); await send({ type: "armed" }); void shutdown.run();
});
await send({ type: "ready", taskId: task.id, pids, entries: JSON.parse(readFileSync(supervisor.processes.file, "utf8")).processes });
