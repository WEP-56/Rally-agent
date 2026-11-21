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
  const failures = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => failures.push(error.message));
  const dom = new JSDOM(html, { url: 'moz-extension://rally/ui/index.html', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console });
  const { window } = dom;
  // xterm probes canvas at module load, but the Android connection view does not use it.
  window.HTMLCanvasElement.prototype.getContext = () => null;
  let reply;
  window.browser = { runtime: { connectNative: name => {
    assert.equal(name, 'rally');
    return {
      onMessage: { addListener: fn => { reply = fn; } },
      onDisconnect: { addListener() {} },
      postMessage: envelope => {
        const message = JSON.parse(envelope.json);
        assert.equal(message.method, 'state');
        queueMicrotask(() => reply({ json: JSON.stringify({ id: message.id, ok: true, value: { platform: 'android', mode: 'choose', url: '', instance: '', profiles: [] } }) }));
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

test('warm cloud startup paints cached identity before networking and resumes its cursor without replaying writes', async () => {
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
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const calls = [];
  window.rallyConnection = {
    state: async () => ({ mode: 'cloud', platform: 'android', url: 'http://server:4711', instance: 'server-instance' }),
    request: (route, packet) => { calls.push({ route, packet }); return new Promise(() => {}); },
  };
  try {
    window.eval(readFileSync('out/renderer/startup.js', 'utf8'));
    const script = window.document.querySelector('script[type="module"]').getAttribute('src');
    const module = new SourceTextModule(readFileSync(resolve('out/renderer', script), 'utf8'), { context: dom.getInternalVMContext(), initializeImportMeta: meta => { meta.url = new URL(script, window.location.href).href; } });
    await module.link(() => { throw Error('Unexpected renderer import'); });
    await module.evaluate();
    const deadline = Date.now() + 3000;
    while (!window.document.querySelector('.chat-identity') && Date.now() < deadline) await setTimeout(10);
    assert.match(window.document.querySelector('.chat-identity')?.textContent ?? '', /Saved identity/);
    await setTimeout(50);
    assert.equal(window.document.getElementById('startup').style.display, 'none');
    assert.match(window.document.getElementById('root').textContent, /当前显示本机缓存/);
    const poll = calls.find(call => call.route === 'events');
    assert.equal(poll.packet.epoch, 'saved-runtime');
    assert.equal(poll.packet.seq, 42);
    assert.equal(calls.filter(call => call.route === 'rpc').length, 0);
    await assert.rejects(window.rally.chat.send('never send offline'), /未连接/);
    assert.equal(calls.filter(call => call.route === 'rpc').length, 0);
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});
