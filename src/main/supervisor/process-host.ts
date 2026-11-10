// Separate build entry. No command is launched before the parent durably registers this host.
import { spawn } from "node:child_process";
import crossSpawn from "cross-spawn";

export interface ProcessCommand { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; stdin?: string; interactive?: boolean; windowsShim?: boolean; windowsVerbatimArguments?: boolean }
export interface ProcessCompletion { type: "completed"; exitCode: number; error?: string }
export interface ProcessStarted { type: "started" }

if (!process.send) throw new Error("PROCESS_HOST_REQUIRES_IPC");
let started = false;
// Keep the root alive until its owner kills the whole tree, even after a hook detaches
// or Rally crashes. The durable registry can then still verify and find the root.
const keepAlive = setInterval(() => {}, 60000);
process.on("SIGTERM", () => {});
process.on("disconnect", () => { if (!started) { clearInterval(keepAlive); process.exit(0); } });
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
process.once("message", (message: ProcessCommand) => {
	if (!message || typeof message.executable !== "string" || !Array.isArray(message.args) || typeof message.cwd !== "string" || !message.env) process.exit(2);
	started = true;
	const launch = message.windowsShim ? crossSpawn : spawn;
	const child = launch(message.executable, message.args, { cwd: message.cwd, env: message.env, shell: false, windowsHide: true, windowsVerbatimArguments: message.windowsVerbatimArguments, stdio: [message.interactive || message.stdin !== undefined ? "pipe" : "ignore", "pipe", "pipe"] });
	if (child.stdin) {
		child.stdin.on("error", () => {});
		if (message.interactive) process.stdin.pipe(child.stdin); else child.stdin.end(message.stdin);
	}
	child.once("spawn", () => { if (process.connected) process.send?.({ type: "started" } satisfies ProcessStarted, () => {}); });
	child.stdout!.pipe(process.stdout, { end: false });
	child.stderr!.pipe(process.stderr, { end: false });
	process.on("disconnect", () => {
		child.stdout!.unpipe(process.stdout); child.stderr!.unpipe(process.stderr);
		child.stdout!.resume(); child.stderr!.resume();
	});
	let failure: string | undefined;
	child.once("error", error => { failure = error.message; });
	child.once("close", (code, signal) => {
		const result: ProcessCompletion = { type: "completed", exitCode: code ?? (signal ? 130 : 1), ...(failure ? { error: failure } : {}) };
		if (process.connected) process.send?.(result, () => {});
	});
});
