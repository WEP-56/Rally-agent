import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloudVault } from '../src/main/cloud/vault.ts';
import { WebsiteAccounts } from '../src/main/website-accounts.ts';
import { credentialEnvironment } from '../src/main/credential-bindings.ts';
import { ProcessRegistry } from '../src/main/supervisor/process-registry.ts';
import { EventLog } from '../src/main/supervisor/event-log.ts';
import { TaskStore } from '../src/main/supervisor/task-store.ts';
import { JobManager } from '../src/main/supervisor/jobs.ts';

test('background jobs mask logs/completion, isolate env and reject credentials revoked during startup', { timeout: 30000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rally-credential-execution-'));
  const accounts = new WebsiteAccounts(join(directory, 'vault.txt'), cloudVault(randomBytes(32)));
  accounts.request('fixture', 'Gitee', { kind: 'secret' });
  const secret = 'private-token-$()-"-中文';
  const { accountId } = accounts.submit({ requestId: 'fixture', website: 'Gitee', password: secret });
  const credentialEnv = { RALLY_TEST_TOKEN: { id: accountId } };
  // RALLY_* belongs to the host; task bindings use an ordinary application variable.
  assert.throws(() => credentialEnvironment(accounts, credentialEnv), /保留项/);
  const references = { GITEE_TOKEN: { id: accountId } };
  assert.throws(() => credentialEnvironment(accounts, { PATH: { id: accountId } }), /保留项/);
  assert.throws(() => credentialEnvironment(accounts, { TOKEN: { id: accountId }, token: { id: accountId } }), /重复/);
  const processes = new ProcessRegistry(directory, { credentials: () => accounts, assertWritable() {}, graceMs: 0 });
  const events = new EventLog(join(directory, 'events.jsonl'));
  const store = new TaskStore(events, directory, () => {});
  const task = store.create({ title: 'token fixture', quotes: [], cwd: directory, scope: [], mode: 'readonly', dependsOn: [], autoApprove: true }).task;
  const run = store.startRun(task.id, 'dispatch', 'offline');
  let completed;
  const done = new Promise(resolve => { completed = resolve; });
  const jobs = new JobManager({ store, processes, directory: join(directory, 'jobs'), settingsFile: join(directory, 'settings.json'), foregroundSeconds: 0.01,
    onDone(job, text) { completed({ job, text }); }, onBusyChange() {}, onError(error) { throw error; } });
  const safeEnv = Object.fromEntries(['SystemRoot', 'SystemDrive', 'PATH', 'PATHEXT', 'COMSPEC', 'TEMP', 'TMP'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
  const command = { executable: process.execPath, args: ['-e', 'const value=process.env.GITEE_TOKEN; process.stdout.write(value.slice(0,5)); setTimeout(()=>{process.stdout.write(value.slice(5));process.stderr.write(value);},50)'], cwd: directory, env: safeEnv, credentialEnv: references };
  try {
    const started = await jobs.execute(task, run, 'bash', 'fixture command without plaintext', command);
    assert.equal(started.background, true);
    const { job, text } = await done;
    assert.equal(job.exitCode, 0); assert.ok(text.includes('[REDACTED]')); assert.ok(!text.includes(secret));
    assert.equal(readFileSync(jobs.output(task.id, job.id).logPath, 'utf8'), '[REDACTED][REDACTED]');
    let isolated = '';
    await processes.run({ ...command, credentialEnv: undefined, args: ['-e', 'process.stdout.write(process.env.GITEE_TOKEN ?? "UNSET")'] }, { kind: 'job', taskId: 'other-task' }, { onStdout(text) { isolated += text; }, onStderr() {} });
    assert.equal(isolated, 'UNSET');
    let ran = false;
    await assert.rejects(processes.run(command, { kind: 'job', taskId: task.id }, {
      onStarted() { accounts.update(accountId, false); }, onStdout() { ran = true; }, onStderr() { ran = true; },
    }), /已停用/);
    assert.equal(ran, false);
    for (const value of [JSON.stringify(events.all()), readFileSync(processes.file, 'utf8')]) assert.ok(!value.includes(secret));
  } finally {
    await jobs.dispose(); await processes.dispose(); events.close(); rmSync(directory, { recursive: true, force: true });
  }
});
