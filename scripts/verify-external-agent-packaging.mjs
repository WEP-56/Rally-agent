import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Check the resolved dependency tree as well as the real bundle, including nested deps. */
export function verifyExternalAgentPackagePaths(paths) {
  const forbidden = /(?:^|\/)node_modules\/(?:@agentclientprotocol\/(?:claude-agent-acp|codex-acp)|@anthropic-ai\/(?:claude-code|claude-agent-sdk)(?:-[^/]+)?|@openai\/codex(?:-[^/]+)?)(?:\/|$)/u;
  const included = paths.map(path => path.replaceAll('\\', '/')).find(path => forbidden.test(path));
  assert.equal(included, undefined, `External agents must be installed on demand, found in base package: ${included}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'Usage: node scripts/verify-external-agent-packaging.mjs <bundle>');
  verifyExternalAgentPackagePaths(readdirSync(resolve(process.argv[2]), { recursive: true }));
  console.log('Base package contains no Claude/Codex adapters, SDK runtimes or native CLIs');
}
