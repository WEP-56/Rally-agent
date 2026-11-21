import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ResourceDownloads, saveResource } from '../../src/main/resource-download.ts';

test('native file saving verifies bytes, reports progress and preserves a previous file on error/cancel', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-download-'));
  const destination = join(dir, 'saved.txt'); const data = Buffer.from('saved attachment');
  const resource = { size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  async function* source() { yield data.subarray(0, 5); yield data.subarray(5); }
  try {
    const progress = [];
    await saveResource(source(), destination, resource, new AbortController().signal, bytes => progress.push(bytes));
    assert.deepEqual(await readFile(destination), data); assert.deepEqual(progress, [5, data.length]);
    await writeFile(destination, 'previous saved file');
    await assert.rejects(() => saveResource(source(), destination, { ...resource, sha256: 'wrong' }, new AbortController().signal, () => {}), /校验/);
    const controller = new AbortController();
    await assert.rejects(() => saveResource(source(), destination, resource, controller.signal, () => controller.abort()), /abort/i);
    assert.equal(await readFile(destination, 'utf8'), 'previous saved file');
    assert.deepEqual(await readdir(dir), ['saved.txt']);
    const downloads = new ResourceDownloads();
    const pending = downloads.start('save-1', signal => saveResource(source(), destination, resource, signal, () => downloads.cancel('save-1')).then(() => true));
    assert.equal(await pending, false); await downloads.close();
    assert.throws(() => downloads.start('save-2', async () => true), /关闭/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
