import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from '../../src/main/resource-store.ts';
import { AttachmentQueue, attachmentMessage, resolveAttachments } from '../../src/main/supervisor/attachments.ts';

test('model image input uses actual Pi blocks; text-only, ordinary files and missing originals are explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-attachment-message-')); const store = new ResourceStore(dir);
  try {
    const png = await store.importBytes('a', 'photo.png', await readFile(new URL('../../src/renderer/src/assets/rally-mark.png', import.meta.url)));
    const plain = await store.importBytes('a', 'notes.txt', Buffer.from('<script>untrusted data</script>'));
    assert.throws(() => resolveAttachments(store, [png.id], 'b'), /无权/);
    assert.throws(() => resolveAttachments(store, Array(11).fill(png.id), 'a'), /10/);
    const refs = resolveAttachments(store, [png.id, plain.id, png.id], 'a'); assert.equal(refs.length, 2);
    const content = await attachmentMessage(store, 'inspect', refs, { input: ['text', 'image'] });
    assert.equal(content.filter(part => part.type === 'image').length, 1);
    assert.ok(Buffer.from(content.find(part => part.type === 'image').data, 'base64').length > 0);
    assert.ok(content.some(part => part.text?.includes(store.path(plain.id)) || part.text?.includes(JSON.stringify(store.path(plain.id)).slice(1, -1))));
    const textOnly = await attachmentMessage(store, 'inspect', [png], { input: ['text'] });
    assert.ok(!textOnly.some(part => part.type === 'image')); assert.ok(textOnly.some(part => part.text?.includes('does not accept image')));
    await rm(store.path(png.id));
    const missing = await attachmentMessage(store, '', [png], { input: ['image'] }); assert.ok(missing.some(part => part.text?.includes('file missing')));
    assert.throws(() => resolveAttachments(store, [png.id], 'a'), /缺失/);
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('slow attachment preparation preserves send order, steers during an active turn, and can be cancelled before admission', async () => {
  const calls = []; const turns = []; let resolveImage;
  const session = { prompt: (text, options) => {
    calls.push(text); assert.equal(options.streamingBehavior, 'steer');
    options.preflightResult('started'); return new Promise(done => turns.push(done));
  } };
  const queue = new AttachmentQueue(session);
  const first = queue.send(() => new Promise(done => { resolveImage = done; }), () => true);
  const second = queue.send(async () => 'second', () => true);
  await Promise.resolve(); assert.deepEqual(calls, []);
  resolveImage([{ type: 'text', text: 'first' }, { type: 'image', data: 'dGVzdA==', mimeType: 'image/png' }]);
  await queue.idle(); assert.deepEqual(calls, ['first', 'second']);
  turns.forEach(done => done()); await Promise.all([first, second]);
  let finish;
  const aborted = queue.send(() => new Promise(done => { finish = done; }), () => true);
  await Promise.resolve(); queue.cancel(); finish('never sent'); await aborted;
  assert.deepEqual(calls, ['first', 'second']);
});
