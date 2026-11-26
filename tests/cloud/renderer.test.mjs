import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { setTimeout } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { CloudMirror } from '../../src/shared/cloud-state.ts';

test('bundled Android entry starts through its native port and shows cloud connection fields', async () => {
  const html = readFileSync('out/renderer/index.html', 'utf8');
  const cssPath = /<link[^>]+href="([^"]+\.css)"/.exec(html)?.[1];
  assert.ok(cssPath);
  const css = readFileSync(resolve('out/renderer', cssPath), 'utf8');
  const glass = [...css.matchAll(/\.chat-header-overlay:{1,2}before\s*\{([^}]+)\}/g)].map(match => match[1]).join('\n');
  assert.match(glass, /(?:^|[;\s])backdrop-filter:\s*blur\(16px\)/, 'The production CSS must keep the unprefixed filter for Gecko');
  const failures = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => failures.push(error.message));
  const dom = new JSDOM(html, { url: 'moz-extension://rally/ui/index.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  // xterm probes canvas at module load, but the Android connection view does not use it.
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let reply;
  window.browser = { runtime: { connectNative: name => {
    assert.equal(name, 'rally');
    return {
      onMessage: { addListener: fn => { reply = fn; } },
      onDisconnect: { addListener() {} },
      postMessage: envelope => {
        const message = JSON.parse(envelope.json);
        assert.ok(['state', 'setAppearance'].includes(message.method));
        const value = message.method === 'state' ? { platform: 'android', mode: 'choose', url: '', instance: '', profiles: [] } : null;
        queueMicrotask(() => reply({ json: JSON.stringify({ id: message.id, ok: true, value }) }));
      },
    };
  } } };
  try {
    window.eval(readFileSync('android/extension/bridge.js', 'utf8'));
    window.eval(readFileSync('out/renderer/startup.js', 'utf8'));
    const script = window.document.querySelector('script[type="module"]').getAttribute('src');
    const module = new SourceTextModule(readFileSync(resolve('out/renderer', script), 'utf8'), {
      context: dom.getInternalVMContext(), initializeImportMeta: meta => { meta.url = new URL(script, window.location.href).href; },
    });
    await module.link(() => { throw Error('Renderer has an unbundled import'); });
    await module.evaluate();
    const deadline = Date.now() + 3000;
    while (!window.document.querySelector('input[type="url"]') && Date.now() < deadline) await setTimeout(10);
    assert.ok(window.document.querySelector('input[type="url"]'));
    assert.ok(window.document.querySelector('input[type="password"]'));
    assert.ok(!window.document.getElementById('root').textContent.includes('使用本地模式'));
    await setTimeout(30);
    assert.equal(window.document.getElementById('startup').style.display, 'none');
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});

test('a broken entry script displays a recoverable startup error', () => {
  const dom = new JSDOM(readFileSync('out/renderer/index.html', 'utf8'), { runScripts: 'outside-only' });
  try {
    dom.window.eval(readFileSync('out/renderer/startup.js', 'utf8'));
    dom.window.dispatchEvent(new dom.window.ErrorEvent('error', { message: 'Unexpected syntax in entry' }));
    assert.equal(dom.window.document.getElementById('startup').style.display, 'flex');
    assert.match(dom.window.document.getElementById('startup-detail').textContent, /Unexpected syntax/);
    assert.equal(dom.window.document.getElementById('startup-retry').hidden, false);
  } finally { dom.window.close(); }
});

for (const platform of ['android', 'desktop']) test(`${platform} warm cloud startup paints cached identity and keeps desktop behavior local while offline`, async () => {
  const html = readFileSync('out/renderer/index.html', 'utf8');
  const failures = [];
  const virtual = new VirtualConsole(); virtual.on('jsdomError', error => failures.push(error.message));
  const dom = new JSDOM(html, { url: 'https://rally-client.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: virtual });
  const { window } = dom;
  const mirror = new CloudMirror('http://server:4711', 'server-instance');
  const chat = { messages: [], header: { activity: null, showCompact: false, showNewConversation: false }, busy: false, model: null, thinkingLevel: null, thinkingLevels: [], notice: null };
  mirror.apply({ epoch: 'saved-runtime', seq: 42, events: [
    { channel: 'chat:event', data: { type: 'snapshot', state: chat } },
    { channel: 'task:event', data: { type: 'snapshot', board: { tasks: [], active: 0, limit: 2, autoApprove: false } } },
    { channel: 'identity:changed', data: { name: 'Saved identity', personality: 'Calm', workstyle: 'Plan', avatar: null } },
    { channel: 'workspace:event', data: { defaultWorkspace: '/work', recentProjects: [] } },
    { channel: 'services:event', data: { services: [] } },
  ] });
  mirror.remember('memory:state', { path: '/memory.md' });
  const read = result => { const request = { result }; queueMicrotask(() => request.onsuccess?.()); return request; };
  window.indexedDB = { open: () => read({ transaction: () => ({ objectStore: () => ({ get: () => read(mirror.encode()), put: () => read(undefined) }) }) }) };
  window.localStorage.setItem('rally.onboarded.v1', '1');
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.HTMLElement.prototype.scrollTo = () => {};
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const calls = [];
  const startupWrites = [];
  const browserCalls = [];
  let browserEvent;
  const desktop = { closeBehavior: 'quit', trayAvailable: true, openAtLogin: false, loginItemAvailable: true };
  if (platform === 'desktop') window.rallyLocal = {
    browser: {
      onEvent: fn => { browserEvent = fn; return () => { browserEvent = undefined; }; },
      ...Object.fromEntries(['create', 'navigate', 'action', 'layout', 'close'].map(method => [method, async (...args) => { browserCalls.push({ method, args }); return { id: args[0], url: 'https://example.test/' }; }])),
    },
    resources: { onSave: () => () => {} },
    desktop: {
      getState: async () => ({ ...desktop }),
      update: async closeBehavior => ({ ...desktop, closeBehavior }),
      setOpenAtLogin: async enabled => { startupWrites.push(enabled); desktop.openAtLogin = enabled; return { ...desktop }; },
    },
  };
  window.rallyConnection = {
    state: async () => ({ mode: 'cloud', platform, url: 'http://server:4711', instance: 'server-instance' }),
    request: (route, packet) => { calls.push({ route, packet }); return new Promise(() => {}); },
  };
  try {
    window.eval(readFileSync('out/renderer/startup.js', 'utf8'));
    const script = window.document.querySelector('script[type="module"]').getAttribute('src');
    const module = new SourceTextModule(readFileSync(resolve('out/renderer', script), 'utf8'), { context: dom.getInternalVMContext(), initializeImportMeta: meta => { meta.url = new URL(script, window.location.href).href; } });
    await module.link(() => { throw Error('Unexpected renderer import'); });
    await module.evaluate();
    const deadline = Date.now() + 3000;
    const identity = () => window.document.querySelector('.chat-header-overlay button[title="打开工位"]');
    while (!identity() && Date.now() < deadline) await setTimeout(10);
    assert.match(identity()?.textContent ?? '', /Saved identity/);
    await setTimeout(50);
    assert.equal(window.document.getElementById('startup').style.display, 'none');
    assert.match(window.document.getElementById('root').textContent, /当前显示本机缓存/);
    const poll = calls.find(call => call.route === 'events');
    assert.equal(poll.packet.epoch, 'saved-runtime');
    assert.equal(poll.packet.seq, 42);
    assert.equal(calls.filter(call => call.route === 'rpc').length, 0);
    if (platform === 'desktop') {
      const events = [];
      const off = window.rally.browser.onEvent(event => events.push(event));
      await window.rally.browser.create('test', 'https://example.test/');
      await window.rally.browser.navigate('test', 'https://example.test/next');
      await window.rally.browser.action('test', 'reload');
      await window.rally.browser.layout({ id: 'test', visible: false, x: 0, y: 0, width: 1, height: 1 });
      await window.rally.browser.close('test');
      browserEvent({ type: 'state', state: { id: 'test' } });
      assert.equal(events.length, 1); off();
      browserEvent({ type: 'state', state: { id: 'test' } });
      assert.equal(events.length, 1);
      assert.deepEqual(browserCalls.map(call => call.method), ['create', 'navigate', 'action', 'layout', 'close']);
      assert.equal(calls.filter(call => call.route === 'rpc').length, 0);
    }
    await assert.rejects(window.rally.chat.send('never send offline'), /未连接/);
    const waitFor = async predicate => {
      const end = Date.now() + 3000;
      while (!predicate() && Date.now() < end) await setTimeout(10);
      assert.ok(predicate());
    };
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ',', ctrlKey: true }));
    await waitFor(() => window.document.querySelector('.rally-settings'));
    const section = window.document.querySelector('button[aria-label="桌面行为"]');
    if (platform === 'desktop') {
      assert.ok(section); section.click();
      const startup = () => window.document.querySelector('[role="switch"][aria-label="开机自启"]');
      await waitFor(() => startup() && !startup().disabled);
      assert.equal(startup().getAttribute('aria-checked'), 'false');
      startup().click();
      await waitFor(() => startup().getAttribute('aria-checked') === 'true' && !startup().disabled);
      assert.deepEqual(startupWrites, [true]);
      desktop.openAtLogin = false;
      window.dispatchEvent(new window.Event('focus'));
      await waitFor(() => startup().getAttribute('aria-checked') === 'false');
      assert.deepEqual(startupWrites, [true]);
    } else {
      assert.equal(section, null);
      await assert.rejects(window.rally.desktop.setOpenAtLogin(true), /仅适用于桌面客户端/);
    }
    assert.equal(calls.filter(call => call.route === 'rpc').length, 0);
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});
