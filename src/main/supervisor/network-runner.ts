import { Worker } from "node:worker_threads";
import { validateNetworkRequest, type NetworkHop, type NetworkMessage, type NetworkRequest, type NetworkResult } from "./network-contract.ts";

/** A bounded thread owns fetch sockets and HTML parsing, and is terminated on every exit path. */
export class NetworkRunner {
	private readonly active = new Map<Promise<NetworkResult>, AbortController>();
	private disposed = false;
	private closing?: Promise<void>;
	run(request: NetworkRequest, signal?: AbortSignal, onRequest?: (hop: NetworkHop) => void): Promise<NetworkResult> {
		if (this.disposed) return Promise.reject(new Error("NETWORK_CLOSED: 网络工具已关闭"));
		const copy = structuredClone(request); const timeout = validateNetworkRequest(copy);
		const controller = new AbortController(); const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
		const pending = this.execute(copy, timeout, combined, onRequest);
		this.active.set(pending, controller);
		void pending.finally(() => this.active.delete(pending)).catch(() => {});
		return pending;
	}
	dispose(): Promise<void> {
		if (this.closing) return this.closing;
		this.disposed = true;
		for (const controller of this.active.values()) controller.abort();
		return this.closing = Promise.allSettled(this.active.keys()).then(() => {});
	}
	private async execute(request: NetworkRequest, timeout: number, signal: AbortSignal, onRequest?: (hop: NetworkHop) => void): Promise<NetworkResult> {
		signal.throwIfAborted();
		// No provider keys, GH tokens or browser state are inherited by the network thread.
		const env = Object.fromEntries(["SystemRoot", "SystemDrive", "PATH", "TEMP", "TMP", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
		const worker = new Worker(new URL(import.meta.url.endsWith(".ts") ? "./network-host.ts" : "./network-host.js", import.meta.url), {
			workerData: request, execArgv: [], env, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
		});
		let timer: ReturnType<typeof setTimeout> | undefined; let abort: () => void = () => {};
		try {
			return await new Promise<NetworkResult>((resolve, reject) => {
				abort = () => reject(new Error("NETWORK_ABORTED: 网络调用已取消；有副作用的请求可能已经执行，请先查询再决定是否重试"));
				signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) { abort(); return; }
				timer = setTimeout(() => reject(new Error("NETWORK_TIMEOUT: 网络调用超时；有副作用的请求可能已经执行，请先查询再决定是否重试")), timeout);
				worker.on("error", reject);
				worker.on("exit", code => reject(new Error(`NETWORK_HOST_EXITED: 网络执行线程退出 (${code})`)));
				worker.on("message", (message: NetworkMessage) => {
					if (signal.aborted) return;
					if (message.type === "result") resolve(message.value);
					else if (message.type === "error") reject(new Error(message.message));
					else if (message.type === "request") {
						try { onRequest?.(message); signal.throwIfAborted(); worker.postMessage({ sequence: message.sequence }); }
						catch (error) { reject(error); }
					}
				});
			});
		} finally {
			clearTimeout(timer); signal.removeEventListener("abort", abort);
			await worker.terminate();
		}
	}
}
