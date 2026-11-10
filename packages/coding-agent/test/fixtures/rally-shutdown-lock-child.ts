import type { AgentSession } from "../../src/index.ts";
import { ensureRallyDirs, resolveRallyPaths } from "../../../../src/main/paths.ts";
import { Supervisor } from "../../../../src/main/supervisor/index.ts";

const paths = resolveRallyPaths(process.argv[2]);
ensureRallyDirs(paths);
const supervisor = new Supervisor(paths, { emitChat: () => {}, emitTask: () => {} });
await supervisor.start();
const session = (supervisor.main as unknown as { session: AgentSession }).session;
session.abort = async () => { throw new Error("fixture abort failure"); };
process.on("message", async command => {
	if (command !== "shutdown-failure") return;
	try {
		await supervisor.dispose();
		process.send?.({ type: "unexpected-success" });
	} catch (error) { process.send?.({ type: "failed", error: String(error) }); }
});
process.send?.({ type: "ready" });
