import { Worker } from "node:worker_threads";

// User/model supplied expressions must not execute on Electron's event loop.
const source = `const { parentPort, workerData } = require("node:worker_threads");
const pattern = new RegExp(workerData);
parentPort.on("message", text => parentPort.postMessage(pattern.test(text)));`;

export class ReadyPattern {
	private readonly worker: Worker;
	private online = false;
	private busy = false;
	private closed = false;
	private queued?: string;
	private timer?: ReturnType<typeof setTimeout>;
	private closing?: Promise<void>;
	constructor(pattern: string, matched: () => void, failed: (error: Error) => void) {
		this.worker = new Worker(source, { eval: true, workerData: pattern, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4, stackSizeMb: 2 } });
		const fail = (error: Error) => { if (this.closed) return; void this.close(); failed(error); };
		this.worker.on("online", () => { this.online = true; this.drain(); });
		this.worker.on("message", (found: boolean) => {
			clearTimeout(this.timer); this.busy = false;
			if (this.closed) return;
			if (found) { void this.close(); matched(); } else this.drain();
		});
		this.worker.on("error", fail);
		this.worker.on("exit", code => { if (!this.closed) fail(new Error(`SERVICE_PATTERN_EXITED: ${code}`)); });
		this.timeout = () => fail(new Error("SERVICE_PATTERN_TIMEOUT: readyPattern 匹配超时，仍可用端口确认就绪"));
	}
	private readonly timeout: () => void;
	test(text: string): void { if (!this.closed) { this.queued = text.slice(-8192); this.drain(); } }
	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.closed = true; this.queued = undefined; clearTimeout(this.timer);
		return this.closing = this.worker.terminate().then(() => {});
	}
	private drain(): void {
		if (!this.online || this.busy || this.closed || this.queued === undefined) return;
		this.busy = true; this.timer = setTimeout(this.timeout, 1000);
		this.worker.postMessage(this.queued); this.queued = undefined;
	}
}
