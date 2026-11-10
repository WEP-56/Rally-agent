// Separate process: shutdown must still finish if a third-party callback blocks the main event loop.
import { processIdentity, stopProcessTree } from "./supervisor/process-identity.ts";

if (!process.send) throw new Error("SHUTDOWN_GUARD_REQUIRES_IPC");
const ownerPid = process.ppid;
let cancelled = false;
let armed = false;
let terminating = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const cancel = () => { if (terminating) return; cancelled = true; clearTimeout(timer); process.exit(0); };
process.on("disconnect", cancel);
process.on("message", (message: { type?: string; timeoutMs?: number }) => {
	if (message?.type === "cancel") { cancel(); return; }
	if (message?.type !== "arm" || armed || !Number.isSafeInteger(message.timeoutMs) || message.timeoutMs! < 1 || message.timeoutMs! > 300000) return;
	armed = true;
	const deadline = performance.now() + message.timeoutMs!;
	void processIdentity(ownerPid).then(owner => {
		if (cancelled || !owner) { cancel(); return; }
		timer = setTimeout(() => {
			terminating = true;
			// Keep going after IPC disconnect once termination started. The parent may exit
			// while taskkill is traversing the descendants, including this guard itself.
			process.removeListener("disconnect", cancel);
			process.stderr.write("RALLY_SHUTDOWN_TIMEOUT: terminating the verified application tree\n");
			void stopProcessTree(owner, 0).then(() => process.exit(1), error => { console.error(error); process.exit(1); });
		}, Math.max(1, deadline - performance.now()));
		process.send?.({ type: "armed" });
	}).catch(error => { console.error(error); process.exit(1); });
});
