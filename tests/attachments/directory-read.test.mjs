import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@rally/coding-agent';
import { createRouterReadTools } from '../../src/main/supervisor/router-tools.ts';
import { createVersionedFileTools, FileVersions } from '../../src/main/supervisor/file-versions.ts';
import { ProcessRegistry } from '../../src/main/supervisor/process-registry.ts';

// Exercise Rally's real wrappers around Pi, without a provider or an external service.
test('router and worker directory reads retain Pi image blocks and worker file fingerprints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rally-image-read-'));
  const image = await readFile(new URL('../../src/renderer/src/assets/rally-mark.png', import.meta.url));
  try {
    await writeFile(join(directory, 'sample.png'), image);
    const manager = SessionManager.inMemory(directory);
    const versions = new FileVersions(manager);
    const processes = new ProcessRegistry(directory, { assertWritable() {} });
    const router = createRouterReadTools(() => directory, processes).find(tool => tool.name === 'read');
    const worker = createVersionedFileTools(directory, versions, () => {}).find(tool => tool.name === 'read');
    for (const tool of [router, worker]) {
      const result = await tool.execute('read-image', { path: 'sample.png' }, undefined, undefined, { cwd: directory, model: { input: ['text', 'image'] } });
      assert.equal(result.isError, undefined);
      const block = result.content.find(part => part.type === 'image');
      assert.ok(block, `read must expose bytes as an image block to the model: ${JSON.stringify(result)}`);
      assert.equal(block.mimeType, 'image/png');
      assert.ok(Buffer.from(block.data, 'base64').length > 0);
    }
    assert.ok(manager.getBranch().some(entry => entry.customType === 'rally-file-version-v1'));
    await writeFile(join(directory, 'sample.png'), Buffer.concat([image, Buffer.from('changed')]));
    await assert.rejects(() => versions.assertFresh(join(directory, 'sample.png')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
