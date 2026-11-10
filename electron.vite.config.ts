// electron-vite config: main (ESM, deps external), preload (CJS for sandbox), renderer (React + Tailwind).

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
	main: {
		// @rally/* stay external: at runtime they load each package's dist through the workspace links.
		build: { externalizeDeps: true, rolldownOptions: { input: { index: resolve("src/main/index.ts"), "process-host": resolve("src/main/supervisor/process-host.ts"), "terminal-host": resolve("src/main/terminal-host.ts"), "search-tool-host": resolve("src/main/supervisor/search-tool-host.ts"), "shutdown-guard-host": resolve("src/main/shutdown-guard-host.ts") } } },
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
		plugins: [react(), tailwindcss()],
	},
});
