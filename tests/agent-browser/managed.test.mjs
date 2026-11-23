import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserService } from '../../src/main/agent-browser/service.ts';
import { WebsiteAccounts } from '../../src/main/website-accounts.ts';
import { ProcessRegistry } from '../../src/main/supervisor/process-registry.ts';
import { createServer } from 'node:http';

test('production browser process is durably registered, supports snapshots and cleans its tree', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-browser-managed-'));
  const registry = new ProcessRegistry(dir, { assertWritable() {}, graceMs: 50 });
  const browser = new AgentBrowserService(join(dir, 'profile'), new WebsiteAccounts(join(dir, 'accounts.txt')), registry);
  const server = createServer((_req, res) => res.end('<button>managed</button>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const window = await browser.open('task', 'run', `http://127.0.0.1:${server.address().port}`);
    assert.match((await browser.snapshot(window.id)).snapshot, /managed/);
    assert.ok(JSON.parse(await readFile(registry.file, 'utf8')).processes.some(entry => entry.kind === 'browser'));
    assert.ok((await browser.frame(window.id)).data.length > 0);
    await (await browser.context).browser().close();
    assert.equal(browser.state().find(item => item.id === window.id).owner, 'closed');
    await assert.rejects(browser.snapshot(window.id), /已关闭/);
    const reopened = await browser.open('task-restarted', 'run-2', `http://127.0.0.1:${server.address().port}`);
    assert.notEqual(reopened.id, window.id);
    assert.match((await browser.snapshot(reopened.id)).snapshot, /managed/);
    await browser.dispose(); await registry.dispose();
    assert.deepEqual(JSON.parse(await readFile(registry.file, 'utf8')).processes, []);
  } finally { await browser.dispose(); await registry.dispose(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
