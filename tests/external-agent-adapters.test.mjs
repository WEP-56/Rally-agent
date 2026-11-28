import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { FileMatcher, copyFiles } from 'app-builder-lib/out/fileMatcher.js';
import { load } from 'js-yaml';
import { verifyBundledAgentAdapters } from '../scripts/verify-external-agent-packaging.mjs';

test('packaged adapter mappings load outside the repository without native dependencies or host accounts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rally-bundled-adapters-'));
  try {
    const runtime = join(directory, 'external-agents');
    if (process.env.RALLY_TEST_SERVER) {
      cpSync(join(process.env.RALLY_TEST_SERVER, 'external-agents'), runtime, { recursive: true });
    } else {
      // Use the actual Electron resource filters: they silently skip a root node_modules.
      const config = load(readFileSync('electron-builder.yml', 'utf8'));
      const mappings = config.extraResources.filter(item => item.to === 'external-agents' || item.to.startsWith('external-agents/'));
      assert.ok(mappings.length > 0, 'Missing packaged agent adapters');
      await copyFiles(mappings.map(item => new FileMatcher(resolve(item.from), join(directory, item.to), value => value, item.filter)));
    }
    verifyBundledAgentAdapters(runtime);
    // Version flags load the real adapter modules without starting a host CLI or contacting a model API.
    const env = {
      PATH: dirname(process.execPath), SystemRoot: process.env.SystemRoot,
      HOME: directory, USERPROFILE: directory,
    };
    const lock = JSON.parse(readFileSync(join(runtime, 'dependency-lock.json'), 'utf8'));
    const codexVersion = lock.packages['node_modules/@agentclientprotocol/codex-acp'].version;
    const claudeVersion = lock.packages['node_modules/@agentclientprotocol/claude-agent-acp'].version;
    for (const [executor, expected] of [['codex', `@agentclientprotocol/codex-acp ${codexVersion}`], ['claude-code', claudeVersion]]) {
      const result = spawnSync(process.execPath, [join(runtime, executor, 'index.js'), '--version'], {
        cwd: directory, env, encoding: 'utf8', windowsHide: true, timeout: 10_000,
      });
      assert.equal(result.status, 0, `${executor}: ${result.error?.message ?? result.stderr}`);
      assert.equal(result.stdout.trim(), expected, `${executor} must load the bundled version`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
