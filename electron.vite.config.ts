// electron-vite config: main (ESM, deps external), preload (CJS for sandbox), renderer (React + Tailwind).

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
	main: {
		// @rally/* stay external: at runtime they load each package's dist through the workspace links.
		build: { externalizeDeps: true },
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
