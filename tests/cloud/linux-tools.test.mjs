import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { managedGithubRunner } from '../../src/main/supervisor/github-runner.ts';
import { ProcessRegistry } from '../../src/main/supervisor/process-registry.ts';

test('Linux bundle runs gh offline and GitHub tools also find user-installed commands', { skip: process.platform !== 'linux' || !process.env.RALLY_TEST_SERVER }, async () => {
  const bundle = resolve(process.env.RALLY_TEST_SERVER);
  await access(join(bundle, 'bin/gh'), constants.X_OK);
  assert.match(await readFile(join(bundle, 'bin/GH-LICENSE'), 'utf8'), /GitHub Inc/);
  const directory = await mkdtemp(join(tmpdir(), 'rally-gh-test-'));
  const previous = process.env;
  const agent = join(directory, 'agent');
  // No inherited tokens, user config, or provider keys; these calls never contact GitHub.
  process.env = { PATH: `${bundle}/bin:/usr/bin:/bin`, HOME: directory, GH_CONFIG_DIR: join(directory, 'gh'), RALLY_CODING_AGENT_DIR: agent };
  const processes = new ProcessRegistry(join(directory, 'state'), { assertWritable() {} });
  try {
    const github = managedGithubRunner(processes);
    const packaged = await github(directory, ['--version'], { outputDir: directory });
    assert.equal(packaged.exitCode, 0); assert.match(packaged.output, /^gh version 2\.105\.0\b/);
    await mkdir(join(agent, 'bin'), { recursive: true });
    await writeFile(join(agent, 'bin/gh'), '#!/bin/sh\nprintf "user-installed-gh\\n"\n', { mode: 0o755 });
    const user = await github(directory, ['--version'], { outputDir: directory });
    assert.equal(user.exitCode, 0); assert.equal(user.output, 'user-installed-gh\n');
    assert.deepEqual(JSON.parse(await readFile(processes.file, 'utf8')).processes, []);
  } finally { await processes.dispose(); process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
