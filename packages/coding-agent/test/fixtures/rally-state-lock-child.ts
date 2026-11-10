import { StateDirectoryLock } from "../../../../src/main/supervisor/state-lock.ts";

let lock: StateDirectoryLock | undefined;
process.on("message", (command) => {
	try {
		if (command === "acquire") {
			lock = new StateDirectoryLock(process.argv[2]);
			process.send?.({ type: "acquired" });
		} else if (command === "release") {
			lock?.release();
			process.send?.({ type: "released" });
		} else if (command === "block") {
			process.send?.({ type: "blocked" });
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
		}
	} catch (error) { process.send?.({ type: "error", error: String(error) }); }
});
process.send?.({ type: "ready" });
