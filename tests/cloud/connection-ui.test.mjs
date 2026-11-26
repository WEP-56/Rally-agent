import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { setTimeout } from 'node:timers/promises';
import { JSDOM } from 'jsdom';

async function until(check) {
  const deadline = Date.now() + 3000;
  while (!check() && Date.now() < deadline) await setTimeout(10);
  assert.ok(check(), 'expected renderer state');
}
async function setup(select) {
  const dom = new JSDOM(readFileSync('out/renderer/index.html', 'utf8'), { url: 'https://client.test', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.rallyConnection = { state: async () => ({ platform: 'desktop', mode: 'choose', url: '', instance: '', profiles: ['https://saved.test'] }), select };
  const script = window.document.querySelector('script[type="module"]').getAttribute('src');
  const module = new SourceTextModule(readFileSync(resolve('out/renderer', script), 'utf8'), { context: dom.getInternalVMContext(), initializeImportMeta: meta => { meta.url = new URL(script, window.location.href).href; } });
  await module.link(() => { throw Error('Unexpected import'); });
  await module.evaluate();
  await until(() => window.document.querySelector('[aria-label="运行模式"]'));
  return dom;
}
function button(window, label) {
  return [...window.document.querySelectorAll('button')].find(item => item.textContent.includes(label));
}
function input(window, type, value) {
  const field = window.document.querySelector(`input[type="${type}"]`);
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, value);
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('desktop first launch selects local without requesting server credentials', async () => {
  const calls = [];
  const dom = await setup((...args) => { calls.push(args); return new Promise(() => {}); });
  try {
    assert.equal(dom.window.document.querySelector('input[type="url"]'), null);
    button(dom.window, '使用本地模式').click();
    await until(() => calls.length === 1);
    assert.deepEqual(calls[0], ['local', '', '']);
    await until(() => button(dom.window, '正在进入本地')?.disabled);
  } finally { dom.window.close(); }
});

test('cloud switch preserves local session on cancel or connection failure, and reuses paired credentials', async () => {
  const calls = [];
  const dom = await setup(async (...args) => { calls.push(args); throw Error('服务器不可用'); });
  const { window } = dom;
  try {
    window.runtime.mode = 'local';
    button(window, '连接云端').click();
    await until(() => window.document.querySelector('input[type="url"]'));
    input(window, 'url', 'https://saved.test/');
    await setTimeout(20);
    assert.equal(window.document.querySelector('input[type="password"]').required, false);
    window.document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => window.document.querySelector('dialog[open]'));
    button(window, '取消').click();
    await until(() => !window.document.querySelector('dialog[open]'));
    assert.equal(calls.length, 0);
    assert.equal(window.runtime.mode, 'local');
    window.document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => window.document.querySelector('dialog[open]'));
    button(window, '继续切换').click();
    await until(() => window.document.querySelector('[role="alert"]'));
    assert.deepEqual(calls[0], ['cloud', 'https://saved.test', '']);
    assert.match(window.document.querySelector('[role="alert"]').textContent, /服务器不可用/);
    assert.equal(window.runtime.mode, 'local');
    assert.equal(button(window, '连接云端').disabled, false);
  } finally { window.close(); }
});
