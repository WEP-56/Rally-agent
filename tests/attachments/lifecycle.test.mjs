import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ResourceStore } from '../../src/main/resource-store.ts';
import { EventLog } from '../../src/main/supervisor/event-log.ts';
import { recoverResourceReferences } from '../../src/main/supervisor/resource-lifecycle.ts';
import { TaskStore } from '../../src/main/supervisor/task-store.ts';

test('recovery preserves old conversations and live tasks, releases deleted tasks and removes only managed crash leftovers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rally-resource-lifecycle-'));
  const store = new ResourceStore(join(directory, 'resources'));
  const events = new EventLog(join(directory, 'events.jsonl'));
  try {
    const old = await store.importBytes('desktop', 'old.txt', Buffer.from('old conversation'));
    const task = await store.importBytes('worker', 'live.txt', Buffer.from('live task'));
    const deleted = await store.importBytes('worker', 'deleted.txt', Buffer.from('deleted task'));
    store.retain('task:T-2', [deleted.id]);
    events.append('chat_message', { n: 1, attachments: [old] });
    events.append('chat_reset', { conversationId: randomUUID() });
    events.append('chat_message', { n: 2, text: 'new conversation' });
    const tasks = { list: () => [{ id: 'T-1', quotes: [], inputs: [], runs: [{ lastReport: { attachments: [task] } }] }], timeline: () => [] };
    assert.equal(recoverResourceReferences(store, events, tasks), 0);
    const incoming = join(directory, 'resources', 'incoming', randomUUID());
    const orphan = join(directory, 'resources', 'blobs', 'a'.repeat(64));
    const staging = join(directory, 'resources', 'blobs', 'b'.repeat(64) + '.' + randomUUID() + '.tmp');
    const unrelated = join(directory, 'resources', 'blobs', 'user-notes.txt');
    for (const file of [incoming, orphan, staging, unrelated]) await writeFile(file, 'leftover');
    await store.sweep(Date.now() + 25 * 60 * 60 * 1000);
    assert.equal(store.get(old.id, 'another-device').state, 'ready');
    assert.equal(store.get(task.id).state, 'ready');
    assert.throws(() => store.get(deleted.id), /不存在/);
    for (const file of [incoming, orphan, staging]) await assert.rejects(readFile(file), { code: 'ENOENT' });
    assert.equal(await readFile(unrelated, 'utf8'), 'leftover');
    // Corrupt history cannot authorize pruning a reference recovered in a prior healthy run.
    events.warnings.push('damaged line');
    recoverResourceReferences(store, events, { list: () => [], timeline: () => [] });
    await store.sweep(Date.now() + 26 * 60 * 60 * 1000);
    assert.equal(store.get(task.id).state, 'ready');
  } finally { await store.close(); events.close(); await rm(directory, { recursive: true, force: true }); }
});

test('downstream input retains a producer artifact after producer deletion and replay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rally-resource-dependency-'));
  const resources = new ResourceStore(join(directory, 'resources'));
  const events = new EventLog(join(directory, 'events.jsonl'));
  try {
    const store = new TaskStore(events, () => directory, () => {});
    const create = dependsOn => store.create({ title: 'fixture', quotes: [], cwd: directory, mode: 'readonly', scope: [], dependsOn, autoApprove: false }).task;
    const producer = create([]), consumer = create([producer.id]);
    const file = await resources.importBytes('worker', 'result.txt', Buffer.from('shared output'));
    store.inheritResources(consumer.id, [file, file]);
    store.inheritResources(consumer.id, [file]);
    assert.equal(store.get(consumer.id).inputs.length, 1);
    store.cancel(consumer.id, 'system'); store.cancel(producer.id, 'system');
    store.archive(producer.id, true); store.beginDelete(producer.id);
    store.finishDelete(producer.id);
    const replay = new TaskStore(events, () => directory, () => {});
    recoverResourceReferences(resources, events, replay);
    await resources.sweep(Date.now() + 25 * 3600000);
    assert.equal(resources.get(file.id).state, 'ready');
    assert.deepEqual(replay.get(consumer.id).inputs[0].attachments.map(ref => ref.id), [file.id]);
  } finally { await resources.close(); events.close(); await rm(directory, { recursive: true, force: true }); }
});
