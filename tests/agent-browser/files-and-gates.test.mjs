import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserService } from '../../src/main/agent-browser/service.ts';
import { WebsiteAccounts } from '../../src/main/website-accounts.ts';
import { ResourceStore } from '../../src/main/resource-store.ts';
import { createBrowserTools } from '../../src/main/supervisor/browser-tools.ts';

test('task tabs, gated form changes, resource upload and download do not cross task boundaries', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-browser-files-'));
  const server = createServer((req, res) => {
    if (req.url === '/file') { res.setHeader('Content-Disposition', 'attachment; filename="report.txt"'); res.end('download-content'); return; }
    res.setHeader('Content-Type', 'text/html');
    res.end('<input aria-label="Upload" type="file"><input aria-label="Draft" value="before"><button onclick="document.querySelector(\'output\').textContent=\'sent\'">Send</button><a href="/file" download>Download</a><a target="_blank" href="/popup">Popup</a><output></output>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = new AgentBrowserService(join(dir, 'profile'), new WebsiteAccounts(join(dir, 'accounts.txt')));
  const resources = new ResourceStore(join(dir, 'resources'));
  try {
    const window = await browser.open('T-1', 'run-1', url);
    const other = await browser.open('T-2', 'run-2', url);
    const live = browser.windows.get(window.id);
    let decision = 'deny'; let mutate = false;
    const gates = { async request() { if (mutate) await live.page.getByLabel('Draft').fill('changed during approval'); return { value: decision }; } };
    const resource = await resources.importBytes('task:T-1', 'input.txt', Buffer.from('upload-content'));
    const published = [];
    const task = { id: 'T-1', mode: 'write', outputDir: join(dir, 'output') }, run = { id: 'run-1' };
    const tools = createBrowserTools(browser, task, run, gates, { store: () => resources, allowedIds: () => [resource.id], publish: (_id, refs) => published.push(...refs) });
    const call = (name, args) => tools.find(tool => tool.name === name).execute('test-call', args);
    let observation = await browser.snapshot(window.id);
    const ref = (label, text = observation.snapshot) => { const found = new RegExp(`"${label}" \\[ref=(\\w+)\\]`).exec(text)?.[1]; assert.ok(found, text); return found; };
    const send = { ...observation, action: { kind: 'click', ref: ref('Send') }, irreversible: true, reason: 'send test form' };
    assert.deepEqual((await call('browser_action', send)).details, { denied: true });
    assert.equal(await live.page.locator('output').textContent(), '');
    decision = 'allow'; mutate = true;
    await assert.rejects(call('browser_action', send), /内容已改变/);
    assert.equal(await live.page.locator('output').textContent(), '');
    mutate = false; observation = await browser.snapshot(window.id);
    await call('browser_file', { ...observation, operation: 'upload', id: resource.id, ref: ref('Upload'), reason: 'upload fixture' });
    assert.equal(await live.page.getByLabel('Upload').evaluate(input => input.files[0].text()), 'upload-content');
    assert.equal(await live.page.getByLabel('Upload').evaluate(input => input.files[0].name), 'input.txt');
    observation = await browser.snapshot(window.id);
    await assert.rejects(call('browser_file', { ...observation, operation: 'upload', id: 'unrelated', ref: ref('Upload'), reason: 'bad' }), /当前任务/);
    const download = live.page.waitForEvent('download');
    await browser.action(observation, { kind: 'click', ref: ref('Download') }); await download;
    observation = await browser.snapshot(window.id); assert.equal(observation.downloads.length, 1);
    const downloadId = observation.downloads[0].id;
    await assert.rejects(browser.download(await browser.snapshot(other.id), downloadId, resources), /不属于当前任务/);
    await call('browser_file', { ...observation, operation: 'download', id: downloadId, reason: 'collect file' });
    assert.equal(published[0].name, 'report.txt');
    assert.equal(await readFile(resources.path(published[0].id), 'utf8'), 'download-content');
    assert.ok((await readdir(browser.staging)).every(name => name.startsWith('upload-')));
    observation = await browser.snapshot(window.id);
    const popup = live.page.waitForEvent('popup');
    await browser.action(observation, { kind: 'click', ref: ref('Popup') }); await popup;
    observation = await browser.snapshot(window.id); assert.equal(observation.tabs.length, 2);
    const tab = observation.tabs.find(tab => !tab.active);
    await assert.rejects(browser.action(await browser.snapshot(other.id), { kind: 'tab', tabId: tab.id }), /不属于当前任务/);
    await browser.action(observation, { kind: 'tab', tabId: tab.id });
    assert.equal((await browser.snapshot(window.id)).tabs.find(tab => tab.active).id, tab.id);
    await browser.closeTask(task.id); assert.equal(live.pages.size, 0);
    assert.deepEqual(await readdir(browser.staging), []);
  } finally { await browser.dispose(); await resources.close(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
