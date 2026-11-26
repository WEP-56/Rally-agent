import { defineConfig } from "vitest/config";

// The color library's 0.4.0 ESM contains extensionless imports. Resolve it
// through Vite, exactly as the renderer production build does.
export default defineConfig({
  test: {
    include: ["src/renderer/src/md3/theme.test.ts"],
    server: { deps: { inline: ["@material/material-color-utilities"] } },
  },
});
