import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const destination = resolve(process.argv[2] ?? 'build/agent-browser');
const install = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium', '--only-shell'], {
  stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: destination },
});
if (install.error) throw install.error;
process.exitCode = install.status ?? 1;
