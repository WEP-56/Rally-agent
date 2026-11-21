import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { ResourceStore } from '../../src/main/resource-store.ts';
import { RESOURCE_MAX_BYTES } from '../../src/shared/resources.ts';

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'rally-resources-'));
  const stores = [];
  const make = () => { const store = new ResourceStore(join(directory, 'resources')); stores.push(store); return store; };
  try { await run({ directory, make }); }
  finally {
    for (const store of stores) await store.close();
    const rel = relative(resolve(tmpdir()), resolve(directory));
    assert.ok(rel.startsWith('rally-resources-') && !isAbsolute(rel) && !rel.includes('..'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('upload resumes after restart, repeated chunks compare bytes, completion is idempotent', () => fixture(async ({ make }) => {
  let store = make();
  const bytes = Buffer.from('hello world');
  const upload = store.begin('device-a', { name: '../hello.txt', size: bytes.length });
  await store.append('device-a', upload.id, 0, bytes.subarray(0, 5));
  assert.equal((await store.append('device-a', upload.id, 0, bytes.subarray(0, 5))).offset, 5);
  await assert.rejects(() => store.append('device-a', upload.id, 0, Buffer.from('other')), /不一致/);
  await assert.rejects(() => store.append('device-b', upload.id, 5, bytes.subarray(5)), /不属于/);
  await store.close(); store = make();
  assert.equal(store.status('device-a', upload.id).offset, 5);
  await assert.rejects(() => store.complete('device-a', upload.id), /尚未/);
  await store.append('device-a', upload.id, 5, bytes.subarray(5));
  await assert.rejects(() => store.complete('device-a', upload.id, 'wrong'), /校验/);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const resource = await store.complete('device-a', upload.id, hash);
  assert.equal(resource.mime, 'text/plain');
  assert.equal(resource.name, '.._hello.txt');
  assert.deepEqual(await readFile(store.path(resource.id)), bytes);
  assert.equal((await store.complete('device-a', upload.id)).id, resource.id);
  assert.throws(() => store.get(resource.id, 'device-b'), /无权/);
  store.retain('message:one', [resource.id], 'device-a');
  assert.equal(store.get(resource.id, 'device-b').id, resource.id);
}));

test('directory imports snapshot original bytes and preserve shared references through cleanup', () => fixture(async ({ directory, make }) => {
  const store = make();
  const work = join(directory, 'work'); await mkdir(work);
  const path = join(work, 'image.png');
  const bytes = await readFile(new URL('../../src/renderer/src/assets/rally-mark.png', import.meta.url));
  await writeFile(path, bytes);
  const a = await store.importFile('agent', path, [work]);
  const b = await store.importFile('agent', path, [work], 'generated');
  assert.equal(a.sha256, b.sha256);
  assert.equal(store.path(a.id), store.path(b.id));
  assert.equal(a.mime, 'image/png');
  store.retain('message:one', [a.id]); store.retain('task:one', [a.id, b.id]);
  await writeFile(path, 'changed');
  assert.deepEqual(await readFile(store.path(a.id)), bytes);
  store.release('task:one');
  await store.sweep(Date.now() + 25 * 60 * 60 * 1000);
  assert.equal(store.get(a.id).state, 'ready');
  assert.throws(() => store.get(b.id), /不存在/);
  store.release('message:one');
  await store.sweep(Date.now() + 25 * 60 * 60 * 1000);
  assert.throws(() => store.get(a.id), /不存在/);
  assert.equal(await readFile(path, 'utf8'), 'changed', 'cleanup never deletes the source file');
}));

test('upload bounds, cancellation, missing resources and directory boundaries are enforced', () => fixture(async ({ directory, make }) => {
  const store = make();
  assert.throws(() => store.begin('a', { name: 'large', size: RESOURCE_MAX_BYTES + 1 }), /1 GiB/);
  const upload = store.begin('a', { name: 'test.bin', size: 3 });
  await assert.rejects(() => store.append('a', upload.id, 0, Buffer.alloc(4)), /范围/);
  await assert.rejects(() => store.append('a', upload.id, 1, Buffer.alloc(2)), /位置/);
  await store.cancel('a', upload.id);
  assert.throws(() => store.status('a', upload.id), /不存在/);
  const work = join(directory, 'work'); await mkdir(work);
  const outside = join(directory, 'outside.txt'); await writeFile(outside, 'secret');
  await assert.rejects(() => store.importFile('a', outside, [work]), /允许/);
  await assert.rejects(() => store.importFile('a', work, [work]), /普通文件/);
  const empty = store.begin('a', { name: 'empty.txt', size: 0 });
  const resource = await store.complete('a', empty.id);
  await rm(store.path(resource.id));
  assert.equal(store.get(resource.id).state, 'missing');
  store.retain('message:one', [resource.id]);
  assert.equal(store.get(resource.id, 'another-device').state, 'missing', 'missing published files remain identifiable');
}));

test('crash bytes beyond committed offset are discarded before resuming', () => fixture(async ({ directory, make }) => {
  const store = make();
  const upload = store.begin('a', { name: 'resume.txt', size: 6 });
  await store.append('a', upload.id, 0, Buffer.from('abc'));
  await writeFile(join(directory, 'resources', 'incoming', upload.id), 'abcBAD');
  await store.append('a', upload.id, 3, Buffer.from('def'));
  const resource = await store.complete('a', upload.id);
  assert.equal(await readFile(store.path(resource.id), 'utf8'), 'abcdef');
}));

test('parallel identical uploads share durable bytes and a later import repairs a corrupt blob', () => fixture(async ({ make }) => {
  const store = make();
  const bytes = Buffer.from('same bytes');
  const first = store.begin('a', { name: 'a.txt', size: bytes.length });
  const second = store.begin('b', { name: 'b.txt', size: bytes.length });
  await Promise.all([store.append('a', first.id, 0, bytes), store.append('b', second.id, 0, bytes)]);
  const [a, b] = await Promise.all([store.complete('a', first.id), store.complete('b', second.id)]);
  assert.notEqual(a.id, b.id);
  assert.equal(store.path(a.id), store.path(b.id));
  await writeFile(store.path(a.id), 'corrupt');
  const repair = store.begin('a', { name: 'repair.txt', size: bytes.length });
  await store.append('a', repair.id, 0, bytes);
  await store.complete('a', repair.id);
  assert.deepEqual(await readFile(store.path(a.id)), bytes);
}));
