import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentBrowserService } from '../../src/main/agent-browser/service.ts';
import { WebsiteAccounts } from '../../src/main/website-accounts.ts';
import { cloudVault } from '../../src/main/cloud/vault.ts';

test('task windows share profile, queue the fourth task and enforce ownership and observation generations', { timeout: 60000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-service-test-'));
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<label>Account<input></label><label>Password<input type="password"></label><button onclick="document.cookie=\'shared=yes; path=/\'; document.querySelector(\'output\').textContent=\'clicked\'">Apply</button><output></output>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const accounts = new WebsiteAccounts(join(dir, 'accounts.txt'), cloudVault(randomBytes(32)));
  accounts.request('request', url); const saved = accounts.submit({ requestId: 'request', website: url, username: 'private-account', password: 'private-password' });
  const browser = new AgentBrowserService(join(dir, 'profile'), accounts);
  try {
    const windows = await Promise.all([1, 2, 3].map(n => browser.open('task-' + n, 'run-1', url)));
    assert.equal(new Set(windows.map(window => window.id)).size, 3);
    // Verify native window identity, not merely three tabs in one window.
    const context = await browser.context;
    assert.equal(context.pages().length, 3);
    const nativeWindows = [];
    for (const page of context.pages()) {
      const session = await context.newCDPSession(page);
      nativeWindows.push((await session.send('Browser.getWindowForTarget')).windowId);
      await session.detach();
    }
    assert.equal(new Set(nativeWindows).size, 3);
    let fourth;
    const pending = browser.open('task-4', 'run-1', url).then(window => { fourth = window; });
    const cancelled = new AbortController();
    const fifth = browser.open('task-5', 'run-1', url, cancelled.signal);
    cancelled.abort(); await assert.rejects(fifth, /取消/);
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(fourth, undefined);
    const first = windows[0];
    let observation = await browser.snapshot(first.id);
    const account = /textbox "Account" \[ref=(\w+)\]/.exec(observation.snapshot)?.[1];
    const password = /textbox "Password" \[ref=(\w+)\]/.exec(observation.snapshot)?.[1];
    assert.ok(account); assert.ok(password);
    accounts.update(saved.accountId, false);
    await assert.rejects(browser.login(observation, saved.accountId, account, password), /没有可用/);
    accounts.update(saved.accountId, true);
    accounts.request('wrong-site', 'https://other.example.test');
    const wrong = accounts.submit({ requestId: 'wrong-site', website: 'https://other.example.test', username: 'wrong-account', password: 'wrong-password' });
    await assert.rejects(browser.login(observation, wrong.accountId, account, password), /没有可用/);
    await browser.login(observation, saved.accountId, account, password);
    await assert.rejects(browser.frame(first.id, true), /私密操作/);
    await assert.rejects(browser.screenshot(first.id), /私密操作/);
    // Another task may share a logged-in site's account echo; it must also be filtered.
    await context.pages()[1].locator('output').evaluate(element => { element.textContent = 'private-account'; });
    assert.ok(!(await browser.snapshot(windows[1].id)).snapshot.includes('private-account'));
    observation = await browser.snapshot(first.id);
    assert.ok(!observation.snapshot.includes('private-account')); assert.ok(!observation.snapshot.includes('private-password'));
    const taken = await browser.take(first.id, 'device-a'); assert.equal(taken.owner, 'user');
    await assert.rejects(browser.snapshot(first.id), /等待用户/);
    await assert.rejects(browser.take(first.id, 'device-b'), /已被接管/);
    const frame = await browser.frame(first.id, false, 'device-a'); assert.ok(frame.data.length > 0);
    await assert.rejects(browser.input(first.id, 'device-b', frame, { kind: 'click', x: 1, y: 1 }), /控制权/);
    browser.disconnect('device-a');
    await assert.rejects(browser.input(first.id, 'device-a', frame, { kind: 'click', x: 1, y: 1 }), /控制权/);
    assert.equal(browser.state().find(window => window.id === first.id).owner, 'waiting');
    await browser.take(first.id, 'device-b'); await browser.handBack(first.id, 'device-b');
    await assert.rejects(browser.action(observation, { kind: 'click', ref: account }), /等待用户|过期/);
    assert.ok((await browser.snapshot(windows[1].id)).snapshot.includes('Apply'));
    await browser.closeTask('task-1'); await pending; assert.ok(fourth);
    assert.equal(browser.state().filter(window => window.owner !== 'closed').length, 3);
    // A takeover must wait for the underlying navigation, then invalidate queued Agent work.
    const live = browser.windows.get(windows[1].id);
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    await live.page.route('**/slow', async route => { entered(); await new Promise(resolve => { release = resolve; }); await route.fulfill({ contentType: 'text/html', body: '<button>After navigation</button>' }); });
    const navigation = browser.navigate(windows[1].id, url + '/slow'); await started;
    let takenOver = false;
    const takeover = browser.take(windows[1].id, 'device-c').then(() => { takenOver = true; });
    await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(takenOver, false);
    release(); await navigation; await takeover; assert.equal(takenOver, true);
    await assert.rejects(browser.snapshot(windows[1].id), /等待用户/);
    await browser.handBack(windows[1].id, 'device-c');
    assert.match((await browser.snapshot(windows[1].id)).snapshot, /After navigation/);
  } finally { await browser.dispose(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('takeover also waits for the initial navigation and closing a task wakes waiting tools', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rally-browser-opening-'));
  let respond, entered;
  const arriving = new Promise(resolve => { entered = resolve; });
  const server = createServer((_req, res) => { respond = () => res.end('<button>Ready</button>'); entered(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = new AgentBrowserService(join(dir, 'profile'), new WebsiteAccounts(join(dir, 'accounts.txt')));
  try {
    const opening = browser.open('task', 'run', `http://127.0.0.1:${server.address().port}`);
    await arriving; const id = browser.state()[0].id;
    let complete = false;
    const takeover = browser.take(id, 'device').then(() => { complete = true; });
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(complete, false);
    respond(); await opening; await takeover;
    const waiting = assert.rejects(browser.waitForAgent(id), /已关闭/);
    await browser.closeTask('task'); await waiting;
  } finally { await browser.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
