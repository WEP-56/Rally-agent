import { homedir } from "node:os";
import { ExternalWorkerSession, type ExternalExecutor } from "./supervisor/external-worker-session.ts";

export class RoleAgentCatalog {
	async models(executor: ExternalExecutor) {
		const session = await ExternalWorkerSession.start({ executor, cwd: homedir(), mode: "readonly" });
		try { return session.models; }
		finally { await session.close(); }
	}
}
