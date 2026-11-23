import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processIdentity, stopProcessTree } from '../src/main/supervisor/process-identity.ts';
import { ProcessRegistry } from '../src/main/supervisor/process-registry.ts';
import { EventLog } from '../src/main/supervisor/event-log.ts';
import { TaskStore } from '../src/main/supervisor/task-store.ts';
import { JobManager } from '../src/main/supervisor/jobs.ts';
import { ServiceManager } from '../src/main/supervisor/services.ts';
import { AuditLog } from '../src/main/supervisor/audit.ts';

test('Linux proc disappearance is distinct from permission and I/O failures', { skip: process.platform !== 'linux' }, async t => {
  const read = fs.readFile;
  let code;
  t.mock.method(fs, 'readFile', async (path, ...args) => {
    if (path === '/proc/12345/stat') throw Object.assign(new Error(code), { code });
    return read(path, ...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (code of ['ENOENT', 'ESRCH']) {
    assert.equal(await processIdentity(12345), undefined);
    assert.equal(await stopProcessTree({ pid: 12345, created: 'linux:fixture:1' }, 0), 'missing');
  }
  for (code of ['EACCES', 'EIO']) await assert.rejects(processIdentity(12345), { code });
});

test('ESRCH during command cleanup does not strand jobs or block later tasks and services', { skip: process.platform !== 'linux' }, async t => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'rally-process-exit-'));
  const events = new EventLog(join(directory, 'events.jsonl'));
  const store = new TaskStore(events, directory, () => {});
  const processes = new ProcessRegistry(directory, { assertWritable() {}, graceMs: 0 });
  const failures = [];
  const jobs = new JobManager({ store, processes, directory: join(directory, 'jobs'), settingsFile: join(directory, 'settings.json'), foregroundSeconds: 10,
    onDone() {}, onBusyChange() {}, onError(error) { failures.push(error); } });
  const services = new ServiceManager({ store, processes, events, audit: new AuditLog(join(directory, 'audit.jsonl'), events), directory: join(directory, 'jobs'),
    onChange() {}, onUserStop() {}, onError(error) { failures.push(error); }, stopGraceMs: 0 });
  const read = fs.readFile;
  let reads = 0;
  // The third stat read happens after SIGKILL: reproduce the observed open/read race.
  t.mock.method(fs, 'readFile', async (path, ...args) => {
    if (/^\/proc\/\d+\/stat$/.test(String(path)) && ++reads === 3) throw Object.assign(new Error('no such process, read'), { code: 'ESRCH' });
    return read(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    const invocation = { executable: process.execPath, args: ['-e', 'console.log("command done")'], cwd: directory, env: { PATH: process.env.PATH } };
    let task, run;
    for (const title of ['first task', 'next task']) {
      task = store.create({ title, quotes: [], cwd: directory, scope: [], mode: 'write', dependsOn: [], autoApprove: true }).task;
      run = store.startRun(task.id, 'dispatch', 'offline');
      assert.equal((await jobs.execute(task, run, 'bash', 'fixture', invocation)).exitCode, 0);
      assert.equal(task.jobs[0].status, 'exited');
    }
    assert.ok(reads >= 3, 'the cleanup race was injected');
    const service = await services.start(task, run, { name: 'fixture', command: 'fixture', readyPattern: 'ready' }, undefined,
      { ...invocation, args: ['-e', 'console.log("ready");setInterval(()=>{},1000)'] });
    await services.stop(service.serviceId, 'worker', task.id);
    assert.equal(services.state().services[0].status, 'stopped');
    assert.equal(processes.failed, false);
    assert.deepEqual(failures, []);
    assert.deepEqual(JSON.parse(await fs.readFile(processes.file, 'utf8')).processes, []);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    await services.dispose(); await jobs.dispose(); await processes.dispose(); events.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
