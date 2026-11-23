import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { setTimeout } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { AgentBrowserService } from '../../src/main/agent-browser/service.ts';
import { WebsiteAccounts } from '../../src/main/website-accounts.ts';
import { ProcessRegistry } from '../../src/main/supervisor/process-registry.ts';
import { browserCommand } from '../../src/main/agent-browser/commands.ts';

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!await check() && Date.now() < deadline) await setTimeout(10);
  assert.ok(await check(), 'expected browser takeover state');
}
function button(window, text) { return [...window.document.querySelectorAll('button')].find(button => button.textContent === text); }

async function setup(browser) {
  const failures = [], calls = [], events = new Map();
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => failures.push(error.message));
  const dom = new JSDOM(readFileSync('out/renderer/index.html', 'utf8'), { url: 'https://client.test', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.rallyStartup = { ready() {}, fail(error) { failures.push(String(error)); } };
  window.localStorage.setItem('rally.onboarded.v1', '1');
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.setPointerCapture = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  const identity = { name: 'Rally', personality: '', workstyle: '', avatar: null };
  const states = {
    'chat:state': { messages: [], header: { activity: null, showCompact: false, showNewConversation: false }, busy: false, model: null, thinkingLevel: null, thinkingLevels: [], notice: null },
    'credentials:state': { accounts: [], requests: [] },
    'tasks:state': { tasks: [], active: 0, limit: 2, autoApprove: false },
    'identity:initialize': identity, 'identity:state': identity,
    'models:state': { providers: [], available: [], active: null, worker: null },
    'memory:state': { path: '/memory.md' }, 'notifications:target': null,
    'services:state': { services: [] }, 'schedules:state': { schedules: [] },
  };
  const transport = {
    async invoke(channel, ...args) {
      // Exercise the production preload mappings and browser command boundary over JSON.
      const call = { channel, args: JSON.parse(JSON.stringify(args)) }; calls.push(call);
      if (!channel.startsWith('agent-browser:')) return states[channel] ?? false;
      return JSON.parse(JSON.stringify(await browserCommand(browser, 'device-a', channel, call.args) ?? null));
    },
    send() {}, on(channel, callback) { if (!events.has(channel)) events.set(channel, new Set()); events.get(channel).add(callback); },
    off(channel, callback) { events.get(channel)?.delete(callback); },
  };
  window.require = name => { assert.equal(name, 'electron'); return { ipcRenderer: transport, contextBridge: { exposeInMainWorld: (key, value) => { window[key] = value; } } }; };
  window.eval(readFileSync('out/preload/index.cjs', 'utf8'));
  window.rallyConnection = { state: async () => ({ mode: 'local', platform: 'desktop', url: '', instance: '' }) };
  const script = window.document.querySelector('script[type="module"]').getAttribute('src');
  const module = new SourceTextModule(readFileSync(resolve('out/renderer', script), 'utf8'), { context: dom.getInternalVMContext(), initializeImportMeta: meta => { meta.url = new URL(script, window.location.href).href; } });
  try {
    await module.link(() => { throw Error('Unexpected renderer import'); }); await module.evaluate();
    await until(() => button(window, '打开浏览器'));
    return { window, calls, failures };
  } catch (error) { window.close(); throw error; }
}

test('built takeover UI clicks a scaled CDP frame, tolerates jitter and sends bounded drags and keys', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rally-browser-input-'));
  const registry = new ProcessRegistry(directory, { assertWritable() {}, graceMs: 50 });
  const browser = new AgentBrowserService(join(directory, 'profile'), new WebsiteAccounts(join(directory, 'accounts.txt')), registry);
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<button style="position:absolute;left:120px;top:80px;width:100px;height:40px" onclick="window.clicks++">Pick</button>
      <div style="position:absolute;left:120px;top:160px;width:400px;height:60px;background:#ddd"
        onpointerdown="window.trace=[['down',event.clientX,event.clientY]];this.setPointerCapture(event.pointerId)"
        onpointermove="if(event.buttons)window.trace.push(['move',event.clientX,event.clientY])"
        onpointerup="window.trace.push(['up',event.clientX,event.clientY])">Slider</div>
      <script>window.clicks=0;window.trace=[];window.keys=[];document.onkeydown=event=>window.keys.push(event.key)</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let window;
  try {
    const opened = await browser.open('task', 'run', `http://127.0.0.1:${server.address().port}`);
    const page = browser.windows.get(opened.id).page;
    assert.equal(page.viewportSize(), null, 'use the production CDP connection');
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const ui = await setup(browser); window = ui.window;
    window.HTMLImageElement.prototype.getBoundingClientRect = () => ({ left: 100, top: 60, width: size.width / 2, height: size.height / 2 });
    const picture = () => window.document.querySelector('img[alt="任务浏览器画面"]');
    const ready = () => picture() && button(window, '交还') && !button(window, '交还').disabled;
    button(window, '打开浏览器').click(); await until(() => picture() && button(window, '接管'));
    button(window, '接管').click(); await until(ready);
    const inputs = () => ui.calls.filter(call => call.channel === 'agent-browser:input');
    const pointer = (type, x, y) => picture().dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 100 + x / 2, clientY: 60 + y / 2 }));

    pointer('pointerdown', 150, 100); pointer('pointerup', 150, 100);
    await until(async () => await page.evaluate(() => window.clicks) === 1); await until(ready);
    assert.deepEqual(inputs().at(-1).args[2], { kind: 'click', x: 150, y: 100 });
    pointer('pointerdown', 150, 100);
    for (let i = 0; i < 10; i++) pointer('pointermove', 150 + i % 2, 100);
    pointer('pointerup', 151, 100);
    await until(async () => await page.evaluate(() => window.clicks) === 2); await until(ready);
    assert.equal(inputs().at(-1).args[2].kind, 'click', 'event count must not turn tiny jitter into a drag');

    pointer('pointerdown', 140, 180);
    for (let i = 1; i <= 150; i++) pointer('pointermove', 140 + i, 180);
    pointer('pointerup', 320, 180);
    await until(async () => (await page.evaluate(() => window.trace.at(-1)))?.[0] === 'up'); await until(ready);
    const drag = inputs().at(-1).args[2];
    assert.equal(drag.kind, 'drag'); assert.equal(drag.points.length, 128);
    assert.deepEqual(await page.evaluate(() => [window.trace[0], window.trace.at(-1)]), [['down', 140, 180], ['up', 320, 180]]);
    pointer('pointerdown', 140, 180); pointer('pointermove', 200, 180); pointer('pointerup', 140, 180);
    await until(() => inputs().length === 4); await until(ready);
    assert.equal(inputs().at(-1).args[2].kind, 'drag', 'a drag returning to its start is still a drag');

    picture().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    await until(async () => (await page.evaluate(() => window.keys)).includes('a')); await until(ready);
    assert.deepEqual(inputs().at(-1).args[2], { kind: 'key', key: 'Control+a' });
    button(window, 'Enter').click();
    await until(async () => (await page.evaluate(() => window.keys)).includes('Enter')); await until(ready);
    assert.deepEqual(ui.failures, []);
    assert.equal(window.document.querySelector('[role="alert"]'), null);
  } finally { window?.close(); await browser.dispose(); await registry.dispose(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
