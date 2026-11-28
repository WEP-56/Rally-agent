import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from '../../src/main/resource-store.ts';
import { ResourcePreviewHost } from '../../src/main/resource-preview.ts';
import { byteRange } from '../../src/main/resource-http.ts';

test('preview capabilities stream original bytes, HEAD and seek ranges without exposing filesystem paths', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-preview-'));
  const store = new ResourceStore(dir); const host = new ResourcePreviewHost(store);
  try {
    const resource = await store.importBytes('desktop', '中文 file.txt', Buffer.from('0123456789'));
    const url = await host.url(resource.id);
    assert.ok(!url.includes(resource.id));
    assert.equal((await fetch(new URL('/wrong', url))).status, 403);
    assert.equal((await fetch(url, { method: 'POST' })).status, 403);
    const full = await fetch(url);
    assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789');
    assert.match(full.headers.get('content-security-policy'), /sandbox/);
    assert.match(full.headers.get('content-disposition'), /UTF-8/);
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
    const range = await fetch(url, { headers: { Range: 'bytes=3-5' } });
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 3-5/10');
    assert.equal(await range.text(), '345');
    const suffix = await fetch(url, { headers: { Range: 'bytes=-2' } }); assert.equal(await suffix.text(), '89');
    const ignored = await fetch(url, { headers: { Range: 'bytes=3-5', 'If-Range': 'old' } }); assert.equal(ignored.status, 200); await ignored.text();
    for (const value of ['bytes=0-1,3-4', 'bytes=10-', 'bytes=-0', 'bytes=4-2', 'bytes=9007199254740993-']) {
      const response = await fetch(url, { headers: { Range: value } }); assert.equal(response.status, 416, value); await response.text();
    }
    assert.throws(() => byteRange('bytes=0-', 0));
    await rm(store.path(resource.id));
    const missing = await fetch(url); assert.equal(missing.status, 404); await missing.text();
  } finally { await host.close(); await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('image thumbnails are bounded derivatives and inherit original authorization', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-thumbnail-')); const store = new ResourceStore(dir);
  try {
    const original = await store.importBytes('device-a', 'image.png', await readFile(new URL('../../src/renderer/src/assets/rally-mark.png', import.meta.url)));
    const thumbnail = await store.thumbnail(original.id, 'device-a');
    assert.equal(thumbnail.derivedFrom, original.id); assert.equal(thumbnail.variant, 'thumbnail');
    assert.ok(thumbnail.width <= 256 && thumbnail.height <= 256 && thumbnail.size < 128 * 1024);
    assert.equal((await store.thumbnail(original.id, 'device-a')).id, thumbnail.id);
    assert.throws(() => store.get(thumbnail.id, 'device-b'), /无权/);
    store.retain('message:1', [original.id]);
    assert.equal(store.get(thumbnail.id, 'device-b').state, 'ready');
    await store.sweep(Date.now() + 25 * 3600000);
    assert.equal(store.get(thumbnail.id).state, 'ready');
    store.release('message:1'); await store.sweep(Date.now() + 25 * 3600000);
    await store.sweep(Date.now() + 25 * 3600000);
    assert.throws(() => store.get(original.id), /不存在/); assert.throws(() => store.get(thumbnail.id), /不存在/);
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('markup responses use the detected MIME while retaining preview sandboxing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-markup-'));
  const store = new ResourceStore(dir); const host = new ResourcePreviewHost(store);
  try {
    for (const [name, content, mime] of [
      ['report.html', '<!doctype html><meta charset="utf-8"><p>中文</p>', 'text/html'],
      ['diagram.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
    ]) {
      const resource = await store.importBytes('desktop', name, Buffer.from(content));
      const response = await fetch(await host.url(resource.id));
      assert.equal(response.headers.get('content-type'), mime);
      assert.match(response.headers.get('content-security-policy'), /sandbox/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(await response.text(), content);
    }
  } finally { await host.close(); await store.close(); await rm(dir, { recursive: true, force: true }); }
});
