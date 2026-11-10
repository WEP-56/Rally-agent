import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ShutdownGuard { arm(timeoutMs: number): Promise<void>; cancel(): Promise<void> }

/** A temporary child, armed only after a user/application exit request. No business state writer. */
export class ProcessShutdownGuard implements ShutdownGuard {
	private child?: ChildProcess;
	private closed?: Promise<void>;
	private arming?: Promise<void>;
	private cancellation?: Promise<void>;
	private readonly hostPath: string;
	constructor(hostPath = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./shutdown-guard-host.ts" : "./shutdown-guard-host.js", import.meta.url))) {
		this.hostPath = hostPath;
	}
	arm(timeoutMs: number): Promise<void> {
		if (this.arming) return this.arming;
		if (this.cancellation) return Promise.reject(new Error("SHUTDOWN_GUARD_CANCELLED"));
		const env = Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
		const child = this.child = spawn(process.execPath, [this.hostPath], { env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
		this.closed = new Promise(resolve => child.once("close", () => resolve()));
		// Avoid pipe backpressure even when the caller cannot service the event loop.
		child.stderr?.resume();
		this.arming = new Promise<void>((resolve, reject) => {
			let settled = false;
			const timer = setTimeout(() => finish(new Error("SHUTDOWN_GUARD_START_TIMEOUT")), 5000);
			const onError = (error: Error) => finish(error);
			const onClose = () => finish(new Error("SHUTDOWN_GUARD_EXITED"));
			const onMessage = (message: { type?: string }) => { if (message?.type === "armed") finish(); };
			const finish = (error?: Error) => {
				if (settled) return; settled = true;
				clearTimeout(timer); child.removeListener("error", onError); child.removeListener("close", onClose); child.removeListener("message", onMessage);
				if (error) { void this.cancel(); reject(error); } else resolve();
			};
			child.on("error", onError); child.once("close", onClose); child.on("message", onMessage);
			child.once("spawn", () => child.send({ type: "arm", timeoutMs }, error => { if (error) finish(error); }));
		});
		// Errors after readiness are observed; the application's fallback deadline remains active.
		child.on("error", () => {});
		return this.arming;
	}
	cancel(): Promise<void> {
		if (this.cancellation) return this.cancellation;
		this.cancellation = (async () => {
			const child = this.child; if (!child) return;
			// Do not kill the helper: it may already be terminating the tree. Cancellation
			// then waits for that operation; the application's fallback deadline stays armed.
			if (child.connected) child.send({ type: "cancel" }, () => {});
			await this.closed;
		})();
		return this.cancellation;
	}
}
