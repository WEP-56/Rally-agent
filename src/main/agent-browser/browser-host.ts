import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// Started only after ProcessRegistry has durably registered the parent host.
const profile = process.argv[2];
if (!profile) throw Error("BROWSER_PROFILE_REQUIRED");
const context = await chromium.launchPersistentContext(profile, {
	headless: true, viewport: { width: 1280, height: 800 }, acceptDownloads: true,
	args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
});
const [port, endpoint] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split(/\r?\n/);
process.stdout.write(JSON.stringify({ endpoint: `ws://127.0.0.1:${port}${endpoint}` }) + "\n");
process.stdin.resume();
process.stdin.once("end", () => { void context.close(); });
context.once("close", () => process.exit(0));
