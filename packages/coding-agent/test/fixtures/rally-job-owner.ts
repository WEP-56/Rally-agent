import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { ProcessRegistry } from "../../../../src/main/supervisor/process-registry.ts";
import { JobManager } from "../../../../src/main/supervisor/jobs.ts";

const paths = resolveRallyPaths(process.argv[2]); ensureRallyDirs(paths);
mkdirSync(paths.workspaceDir, { recursive: true });
const lock = new StateDirectoryLock(paths.stateDir);
const events = new EventLog(paths.eventsFile, undefined, () => lock.assertHeld());
const store = new TaskStore(events, paths.workspaceDir, () => {});
const processes = new ProcessRegistry(paths.stateDir, { assertWritable: () => lock.assertHeld() });
const jobs = new JobManager({ store, processes, directory: paths.jobsDir, settingsFile: join(paths.agentDir, "settings.json"), foregroundSeconds: 0.02,
	onDone: (job, text) => { store.jobDone(job, text); }, onBusyChange: () => {}, onError: error => process.send?.({ type: "error", error: String(error) }) });
const task = store.create({ title: "crash job", quotes: [], cwd: paths.workspaceDir, scope: [], mode: "write", dependsOn: [], autoApprove: true }).task;
const run = store.startRun(task.id, "dispatch", "fixture");
const result = await jobs.execute(task, run, "bash", "offline fixture", { executable: process.execPath, args: [fileURLToPath(new URL("./rally-job.cjs", import.meta.url)), join(process.argv[2], "never-release.json")], cwd: task.cwd, env: process.env });
process.send?.({ type: "ready", taskId: task.id, result });
