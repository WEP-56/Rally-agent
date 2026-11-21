import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceStore } from '../../src/main/resource-store.ts';
import { resourceTools } from '../../src/main/supervisor/resource-tools.ts';

test('MCP image capture preserves model content and attaches trusted refs to nested/parent calls; publication enforces scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rally-resource-tools-'));
  const store = new ResourceStore(join(directory, 'resources')); const publications = [];
  let resultHandler; let publish; let active = true;
  const bytes = await readFile('src/renderer/src/assets/rally-mark.png');
  try {
    const privateResource = await store.importBytes('another-device', 'private.png', bytes);
    resourceTools({ store: () => store, owner: 'task:T-1', cwd: () => directory, roots: () => [directory], allowedIds: () => [], active: () => active, publish: (id, refs) => publications.push({ id, refs }) })({
      registerTool: tool => { publish = tool; }, on: (event, handler) => { assert.equal(event, 'tool_result'); resultHandler = handler; },
    });
    const image = { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') };
    const result = await resultHandler({ toolName: 'mcp_image', toolCallId: 'nested', parentToolCallId: 'parent', content: [image], input: {}, structuredContent: { caption: 'fixture' }, isError: false }, { signal: new AbortController().signal });
    assert.equal(result.content[0], image); assert.deepEqual(result.structuredContent, { caption: 'fixture' });
    assert.deepEqual(publications.map(item => item.id), ['nested', 'parent']);
    const resource = publications[0].refs[0]; assert.equal(store.get(resource.id).mime, 'image/png');
    assert.deepEqual(await readFile(store.path(resource.id)), bytes);
    await assert.rejects(publish.execute('denied', { resourceIds: [privateResource.id] }), /可见范围/);
    await assert.rejects(publish.execute('outside', { paths: [new URL('../../package.json', import.meta.url).pathname.slice(process.platform === 'win32' ? 1 : 0)] }), /允许的目录/);
    active = false; await assert.rejects(publish.execute('ended', { resourceIds: [resource.id] }), /结束/);
    assert.equal(await resultHandler({ content: [image] }, {}), undefined);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
