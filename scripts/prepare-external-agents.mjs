import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { verifyBundledAgentAdapters } from './verify-external-agent-packaging.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repository, 'scripts', 'external-agents');
const destination = join(repository, 'build', 'external-agents');
const lock = readFileSync(join(source, 'package-lock.json'));
const revision = createHash('sha256').update(lock)
  .update(readFileSync(join(source, 'package.json')))
  .update(readFileSync(join(repository, 'node_modules/vite/package.json')))
  .update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const stamp = join(destination, '.revision');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === revision) {
  verifyBundledAgentAdapters(destination);
} else {
  // This isolated build-time dependency tree omits native CLIs and never runs install scripts.
  // It is separate from the application tree, whose platform dependencies must remain installed.
  const npm = process.env.npm_execpath ?? (process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    : resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'));
  execFileSync(process.execPath, [npm, 'ci', '--prefix', source, '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund'], {
    stdio: 'inherit', windowsHide: true,
  });
  // Only this fixed, generated directory is replaced; never prune the application or user tree.
  if (resolve(destination) !== resolve(repository, 'build', 'external-agents')) throw new Error('Invalid adapter output directory');
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'package.json'), JSON.stringify({ name: 'rally-agent-adapters', private: true, type: 'module' }));
  const modules = join(source, 'node_modules');
  const codex = join(destination, 'codex');
  mkdirSync(codex, { recursive: true });
  // Upstream already bundles Codex ACP's JavaScript; CODEX_PATH always selects the user's CLI.
  cpSync(join(modules, '@agentclientprotocol/codex-acp/dist/index.js'), join(codex, 'index.js'));
  await build({
    configFile: false,
    logLevel: 'error',
    ssr: { noExternal: true },
    build: {
      ssr: true, target: 'node22', outDir: join(destination, 'claude-code'), emptyOutDir: true, minify: false,
      rolldownOptions: {
        input: join(modules, '@agentclientprotocol/claude-agent-acp/dist/index.js'),
        external: ['@anthropic-ai/claude-agent-sdk'],
        output: { entryFileNames: 'index.js' },
      },
    },
  });
  // The SDK is only a JS transport client here. Keep its module layout for internal imports.
  const sdk = '@anthropic-ai/claude-agent-sdk';
  cpSync(join(modules, sdk), join(destination, 'node_modules', sdk), {
    recursive: true,
    filter: path => !/\.d\.[cm]?ts$|\.map$/u.test(path),
  });
  // Preserve notices from all locked build dependencies, including libraries bundled upstream.
  for (const relative of readdirSync(modules, { recursive: true })) {
    const file = join(modules, relative);
    if (!statSync(file).isFile() || !/(?:^|[\\/])(?:licen[cs]e|notice|copyright)(?:[.\-_][^\\/]*)?$/iu.test(relative)) continue;
    const target = join(destination, 'licenses', relative);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  cpSync(join(source, 'package-lock.json'), join(destination, 'dependency-lock.json'));
  const report = verifyBundledAgentAdapters(destination);
  writeFileSync(stamp, revision);
  console.log(`Prepared bundled agent adapters: ${(report.bytes / 1024 / 1024).toFixed(2)} MiB (no native CLIs)`);
}
