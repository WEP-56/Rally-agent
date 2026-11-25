// electron-vite config: main (ESM, deps external), preload (CJS for sandbox), renderer (React + Tailwind).

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
	main: {
		// @rally/* stay external: at runtime they load each package's dist through the workspace links.
		build: { externalizeDeps: true, rolldownOptions: { input: { index: resolve("src/main/index.ts"), "browser-host": resolve("src/main/agent-browser/browser-host.ts"), "process-host": resolve("src/main/supervisor/process-host.ts"), "terminal-host": resolve("src/main/terminal-host.ts"), "search-tool-host": resolve("src/main/supervisor/search-tool-host.ts"), "shutdown-guard-host": resolve("src/main/shutdown-guard-host.ts"), "external-worker-windows-preload": resolve("src/main/external-worker-windows-preload.ts"), "network-host": resolve("src/main/supervisor/network-host.ts") } } },
	},
	preload: {
		// Sandboxed preloads cannot load ESM.
		build: {
			rolldownOptions: {
				output: { format: "cjs", entryFileNames: "[name].cjs" },
			},
		},
	},
	renderer: {
		// Shared renderer targets both the desktop Chromium and the bundled Android Gecko.
		build: { target: "es2022", cssTarget: "firefox150" },
		plugins: [react(), tailwindcss()],
	},
});
