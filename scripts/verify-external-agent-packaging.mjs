import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Adapters are app-owned JavaScript. Native agent runtimes must stay user-owned. */
export function verifyExternalAgentPackagePaths(paths) {
  const forbidden = /(?:^|\/)node_modules\/(?:@anthropic-ai\/(?:claude-code(?:-[^/]+)?|claude-agent-sdk-[^/]+)|@openai\/codex(?:-[^/]+)?)(?:\/|$)/u;
  const included = paths.map(path => path.replaceAll('\\', '/')).find(path => forbidden.test(path));
  assert.equal(included, undefined, `Native agent CLIs must not be bundled: ${included}`);
}

export function verifyBundledAgentAdapters(directory) {
  const files = readdirSync(directory, { recursive: true });
  verifyExternalAgentPackagePaths(files);
  let bytes = 0;
  for (const file of files) {
    const info = statSync(join(directory, file));
    if (!info.isFile()) continue;
    assert.ok(!/\.(?:exe|dll|node|so|dylib)$/iu.test(file), `Unexpected native adapter dependency: ${file}`);
    bytes += info.size;
  }
  for (const entry of ['codex/index.js', 'claude-code/index.js', 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs']) {
    assert.ok(statSync(join(directory, entry)).isFile(), `Missing bundled adapter entry: ${entry}`);
  }
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.type, 'module');
  assert.ok(bytes < 15 * 1024 * 1024, `Adapter runtime unexpectedly large: ${bytes} bytes`);
  return { bytes, files: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'Usage: node scripts/verify-external-agent-packaging.mjs <bundle>');
  verifyExternalAgentPackagePaths(readdirSync(resolve(process.argv[2]), { recursive: true }));
  const report = verifyBundledAgentAdapters(join(resolve(process.argv[2]), 'external-agents'));
  console.log(`Bundled JavaScript adapters: ${report.bytes} bytes; no native agent CLIs`);
}
