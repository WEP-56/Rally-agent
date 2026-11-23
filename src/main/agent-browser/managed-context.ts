import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext } from "playwright";
import type { ProcessRegistry } from "../supervisor/process-registry.ts";

export async function managedContext(registry: ProcessRegistry, profile: string): Promise<BrowserContext> {
	await mkdir(profile, { recursive: true, mode: 0o700 });
	const host = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./browser-host.ts" : "./browser-host.js", import.meta.url));
	let resolve!: (endpoint: string) => void, reject!: (error: Error) => void;
	const endpoint = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
	let output = "";
	const processHost = registry.open({ executable: process.execPath, args: [host, profile], cwd: dirname(profile), env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...(process.env.RALLY_BROWSER_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.RALLY_BROWSER_PATH } : {}) } }, { kind: "browser" }, {
		onStdout: data => {
			output += data;
			if (output.length > 4096) throw Error("BROWSER_HOST_PROTOCOL_LIMIT");
			if (output.includes("\n")) { const value = JSON.parse(output); if (typeof value.endpoint !== "string" || !/^ws:\/\/127\.0\.0\.1:\d+\//.test(value.endpoint)) throw Error("BROWSER_HOST_PROTOCOL_INVALID"); resolve(value.endpoint); }
		},
		onStderr: () => {}, // Chromium diagnostics can contain page URLs; never forward to task logs.
	});
	const timer = setTimeout(() => reject(Error("浏览器启动超时，请检查浏览器运行依赖")), 30000);
	void processHost.exited.then(() => reject(Error("浏览器进程已退出")), () => reject(Error("浏览器启动失败，请检查运行依赖")));
	try {
		const browser = await chromium.connectOverCDP(await endpoint, { timeout: 15000 });
		const context = browser.contexts()[0];
		context.once("close", () => { void processHost.ready.then(input => input.end(), () => {}); });
		return context;
	} catch (error) { processHost.close(); await processHost.exited.catch(() => {}); throw error; }
	finally { clearTimeout(timer); }
}
