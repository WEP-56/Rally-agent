import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { resolveRallyPaths, ensureRallyDirs } from "../../../../src/main/paths.ts";
import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";
import { EventLog } from "../../../../src/main/supervisor/event-log.ts";
import { TaskStore } from "../../../../src/main/supervisor/task-store.ts";
import { ProcessRegistry } from "../../../../src/main/supervisor/process-registry.ts";
import { ServiceManager } from "../../../../src/main/supervisor/services.ts";
import { AuditLog } from "../../../../src/main/supervisor/audit.ts";

const paths = resolveRallyPaths(process.argv[2]); ensureRallyDirs(paths); mkdirSync(paths.workspaceDir, { recursive: true });
const lock = new StateDirectoryLock(paths.stateDir);
const events = new EventLog(paths.eventsFile, undefined, () => lock.assertHeld());
const store = new TaskStore(events, paths.workspaceDir, () => {});
const processes = new ProcessRegistry(paths.stateDir, { assertWritable: () => lock.assertHeld() });
const services = new ServiceManager({ store, processes, events, audit: new AuditLog(paths.auditFile, events), directory: paths.jobsDir, readyMs: 8000,
	onChange: () => {}, onUserStop: () => {}, onError: error => process.send?.({ type: "error", error: String(error) }) });
const task = store.create({ title: "crash service", quotes: [], cwd: paths.workspaceDir, scope: [], mode: "write", dependsOn: [], autoApprove: true }).task;
const run = store.startRun(task.id, "dispatch", "fixture");
const result = await services.start(task, run, { name: "crash http", command: "offline fixture" }, undefined, {
	executable: process.execPath, args: [fileURLToPath(new URL("./rally-service.cjs", import.meta.url))], cwd: task.cwd, env: process.env,
});
process.send?.({ type: "ready", taskId: task.id, result });
