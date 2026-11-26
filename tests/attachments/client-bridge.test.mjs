import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { setTimeout } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

async function until(check) { const end = Date.now() + 5000; while (!check() && Date.now() < end) await setTimeout(10); assert.ok(check()); }

for (const platform of ['android', 'desktop']) test(`built ${platform} cloud client routes resource bytes through native bridge and keeps desktop settings local`, async () => {
  const failures = []; const virtual = new VirtualConsole(); virtual.on('jsdomError', error => failures.push(error.message));
  const dom = new JSDOM(readFileSync('out/renderer/index.html', 'utf8'), { url: 'https://rally-client.test', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: virtual });
  const { window } = dom; let reply; let stopped = false; const uploads = []; const requests = []; const appearances = []; const nativeEvents = new Map();
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.localStorage.setItem('rally.onboarded.v1', '1');
  const identity = { name: 'Fixture', personality: '', workstyle: '', avatar: null };
  const packet = { epoch: 'fixture', seq: 1, events: [
    { channel: 'chat:event', data: { type: 'snapshot', state: { messages: [], header: {}, busy: false, model: null, thinkingLevel: null, thinkingLevels: [] } } },
    { channel: 'task:event', data: { type: 'snapshot', board: { tasks: [], active: 0, limit: 2 } } },
    { channel: 'identity:changed', data: identity }, { channel: 'workspace:event', data: { defaultWorkspace: '/work', recentProjects: [] } }, { channel: 'services:event', data: { services: [] } },
  ] };
  const state = { platform, mode: 'cloud', url: 'http://server.test', instance: 'fixture', profiles: [] };
  const request = async (route, body) => {
    requests.push({ route, body }); if (stopped) throw Error('offline');
    if (route === 'events') return packet;
    if (body.channel === 'models:state') return { providers: [], available: [], active: null, worker: null };
    if (body.channel === 'memory:state') return { path: '/memory.md' };
    // A malformed account response must not take down the entire conversation.
    if (body.channel === 'credentials:state') return null;
    if (body.channel === 'resources:preview') return '/v1/resources/file/content?ticket=short';
    return [];
  };
  let downloadId;
  const saveResource = async (_id, id) => {
    downloadId = id;
    if (platform === 'android') reply({ type: 'resource-save-progress', json: JSON.stringify({ id, received: 12, size: 12 }) });
    else for (const fn of nativeEvents.get('resources:save-progress') ?? []) fn(null, { id, received: 12, size: 12 });
    return true;
  };
  const upload = async (id, offset, bytes) => { uploads.push({ id, offset, bytes: Buffer.from(bytes) }); return { id, offset: offset + bytes.length }; };
  if (platform === 'android') {
    window.browser = { runtime: { connectNative: () => ({
      onMessage: { addListener: fn => { reply = fn; } }, onDisconnect: { addListener() {} },
      postMessage: envelope => {
        assert.ok(envelope.json.length < 1024 * 1024);
        const call = JSON.parse(envelope.json);
        Promise.resolve().then(async () => {
          let value;
          if (call.method === 'state') value = state;
          else if (call.method === 'setAppearance') { appearances.push(call.args); value = null; }
          else if (call.method === 'request') value = await request(...call.args);
          else if (call.method === 'upload') value = await upload(call.args[0], call.args[1], Buffer.from(call.args[2], 'base64'));
          else if (call.method === 'saveResource') value = await saveResource(...call.args);
          else if (call.method === 'cancelSave') { assert.equal(call.args[0], downloadId); value = true; }
          else throw Error(call.method);
          reply({ json: JSON.stringify({ id: call.id, ok: true, value }) });
        }).catch(error => reply({ json: JSON.stringify({ id: call.id, ok: false, value: error.message }) }));
      },
    }) } };
    window.eval(readFileSync('android/extension/bridge.js', 'utf8'));
  } else {
    let behavior = 'quit';
    const ipc = {
      invoke: async (channel, ...args) => {
        if (channel === 'desktop:state') return { closeBehavior: behavior, trayAvailable: true };
        if (channel === 'desktop:update') { behavior = args[0]; return { closeBehavior: behavior, trayAvailable: true }; }
        return false;
      }, send() {}, on: (channel, fn) => { const group = nativeEvents.get(channel) ?? new Set(); group.add(fn); nativeEvents.set(channel, group); }, off: (channel, fn) => nativeEvents.get(channel)?.delete(fn),
    };
    window.require = () => ({ ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (key, value) => { window[key] = value; } } });
    window.eval(readFileSync('out/preload/index.cjs', 'utf8'));
    window.rallyConnection = { state: async () => state, request, upload, saveResource, cancelSave: async id => { assert.equal(id, downloadId); } };
  }
  try {
    const script = window.document.querySelector('script[type="module"]').getAttribute('src');
    const module = new SourceTextModule(readFileSync(resolve('out/renderer', script), 'utf8'), { context: dom.getInternalVMContext(), initializeImportMeta: meta => { meta.url = new URL(script, window.location.href).href; } });
    await module.link(() => { throw Error('unbundled import'); }); await module.evaluate();
    await until(() => window.document.querySelector('.chat-composer'));
    if (platform === 'android') {
      const surface = () => window.document.documentElement.style.getPropertyValue('--md-sys-color-surface');
      await until(() => appearances.length > 0);
      assert.deepEqual(appearances.at(-1), [false, surface()]);
      window.document.querySelector('.chat-header-settings').click();
      await until(() => window.document.querySelector('button[aria-label="外观"]'));
      window.document.querySelector('button[aria-label="外观"]').click();
      const themeButton = label => [...window.document.querySelectorAll('button')].find(button => button.textContent === label);
      await until(() => themeButton('深色'));
      themeButton('深色').click();
      await until(() => appearances.at(-1)[0] === true);
      assert.deepEqual(appearances.at(-1), [true, surface()]);
      assert.equal(window.document.documentElement.style.colorScheme, 'dark');
      themeButton('跟随系统').click();
      await until(() => appearances.at(-1)[0] === false);
      assert.deepEqual(appearances.at(-1), [false, surface()]);
      window.document.querySelector('[aria-label="自定义强调色"]').click();
      await until(() => window.document.querySelector('[aria-label="强调色十六进制值"]'));
      assert.equal(window.document.querySelector('input[type="color"]'), null);
      assert.equal(window.document.querySelectorAll('input[type="range"]').length, 3);
      const hex = window.document.querySelector('[aria-label="强调色十六进制值"]');
      const enterHex = value => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(hex, value);
        hex.dispatchEvent(new window.Event('input', { bubbles: true }));
      };
      enterHex('#12');
      await until(() => hex.getAttribute('aria-invalid') === 'true');
      const before = appearances.length;
      enterHex('#6854A4');
      await until(() => appearances.length > before);
      assert.equal(hex.getAttribute('aria-invalid'), 'false');
      assert.deepEqual(appearances.at(-1), [false, surface()]);
      assert.equal(JSON.parse(window.localStorage.getItem('rally.config.v1')).accent, '#6854A4');
    }
    const bytes = new window.Uint8Array(1024 * 1024); bytes.fill(81);
    const result = await window.rally.resources.append('file', 17, bytes);
    assert.equal(result.offset, bytes.length + 17);
    assert.equal(uploads.length, platform === 'android' ? 4 : 1);
    assert.deepEqual(Buffer.concat(uploads.map(item => item.bytes)), Buffer.alloc(1024 * 1024, 81));
    if (platform === 'android') assert.deepEqual(uploads.map(item => item.offset), [17, 262161, 524305, 786449]);
    assert.equal(await window.rally.resources.preview('file'), 'http://server.test/v1/resources/file/content?ticket=short');
    const progress = []; const off = window.rally.resources.onSave(value => progress.push(value));
    assert.equal(await window.rally.resources.save('file', 'download'), true); assert.equal(progress.at(-1).received, 12);
    await window.rally.resources.cancelSave('download'); off();
    if (platform === 'desktop') {
      stopped = true; // The local preference is usable even when the selected server is offline.
      assert.equal((await window.rally.desktop.update('tray')).closeBehavior, 'tray');
      assert.equal((await window.rally.desktop.getState()).closeBehavior, 'tray');
    } else await assert.rejects(window.rally.desktop.getState(), /桌面/);
    assert.ok(!requests.some(item => ['resources:append', 'resources:save', 'desktop:state', 'desktop:update'].includes(item.body?.channel)));
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});
