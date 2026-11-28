import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { load } from 'js-yaml';
import { verifyExternalAgentPackagePaths } from '../scripts/verify-external-agent-packaging.mjs';

test('release dependency tree allows JS adapters but excludes all native agent packages', () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  verifyExternalAgentPackagePaths(Object.keys(lock.packages));
  for (const path of [
    'node_modules/@anthropic-ai/claude-code/bin/claude.exe',
    'node_modules/@openai/codex/bin/codex.js',
    '/node_modules/other/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
    'resources\\app.asar.unpacked\\node_modules\\@openai\\codex-win32-x64\\vendor\\codex.exe',
  ]) assert.throws(() => verifyExternalAgentPackagePaths([path]), /must not be bundled/);
  verifyExternalAgentPackagePaths([
    'node_modules/@agentclientprotocol/sdk/dist/index.js', 'node_modules/@anthropic-ai/sdk/index.js',
    'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js',
    'node_modules/@agentclientprotocol/codex-acp/dist/index.js',
    'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
  ]);
});

test('release manifest rejects stale/debug/missing packages and hashes the exact five-file set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-release-'));
  const version = JSON.parse(readFileSync('package.json')).version;
  const names = [`Rally-${version}-setup.exe`, `rally-server-${version}-linux-x64.tar.gz`, ...['arm64-v8a', 'armeabi-v7a', 'x86_64'].map(abi => `Rally-${version}-android-${abi}.apk`)];
  const check = tag => spawnSync(process.execPath, [resolve('scripts/release-checksums.mjs'), dir, '--tag', tag], { encoding: 'utf8' });
  try {
    for (const name of names) writeFileSync(join(dir, name), name);
    assert.equal(check('v' + version).status, 0);
    for (const name of names) assert.ok(readFileSync(join(dir, 'SHA256SUMS'), 'utf8').includes(`${createHash('sha256').update(name).digest('hex')}  ${name}\n`));
    assert.notEqual(check('v999.0.0').status, 0);
    const debug = join(dir, 'unexpected-debug.apk'); writeFileSync(debug, 'fixture'); assert.notEqual(check('v' + version).status, 0); rmSync(debug);
    rmSync(join(dir, names[0])); assert.notEqual(check('v' + version).status, 0);
    const workflow = load(readFileSync('.github/workflows/release.yml', 'utf8'));
    assert.deepEqual(workflow.on.push.tags, ['v*']);
    assert.ok(workflow.jobs.draft.steps.some(step => step.run?.includes('release-checksums')));
    assert.ok(workflow.jobs.draft.steps.some(step => step.run?.includes('--draft')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
