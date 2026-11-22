import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceTextModule } from 'node:vm';
import { setTimeout } from 'node:timers/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

async function until(check) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await setTimeout(10);
  assert.ok(check(), 'expected attachment UI state');
}
const mentionTask = (id, title, createdAt, archivedAt) => ({ id, title, createdAt, archivedAt, status: 'done', statusText: '完成', mode: 'readonly', cwd: '/work', scope: [], quotes: [], dependsOn: [], approval: { state: 'approved' } });

async function setup(tasks = []) {
  const failures = []; const virtual = new VirtualConsole(); virtual.on('jsdomError', error => failures.push(error.message));
  const dom = new JSDOM(readFileSync('out/renderer/index.html', 'utf8'), { url: 'https://client.test', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: virtual });
  const { window } = dom; const events = new Map(); const calls = []; const uploads = new Map(); let counter = 0; let refuseSend = true; let refuseChunk = true;
  const chat = { messages: [], header: { activity: null, showCompact: false, showNewConversation: false }, busy: false, model: null, thinkingLevel: null, thinkingLevels: [], notice: null };
  const identity = { name: 'Rally', personality: '', workstyle: '', avatar: null };
  const emit = (channel, data) => { for (const callback of events.get(channel) ?? []) callback(null, data); };
  window.rallyStartup = { ready() {}, fail(error) { failures.push(error?.stack ?? String(error)); } };
  window.localStorage.setItem('rally.onboarded.v1', '1');
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollIntoView = () => {};
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.URL.createObjectURL = () => 'blob:https://client.test/image'; window.URL.revokeObjectURL = () => {};
  window.fetch = async () => ({ ok: true, text: async () => '<script>display as data</script>' });
  // Use production client mappings with an IPC fixture, so event and argument contracts are exercised.
  const transport = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'chat:state') return chat;
      if (channel === 'tasks:state') return { tasks, active: 0, limit: 2, autoApprove: false };
      if (channel === 'identity:initialize' || channel === 'identity:state') return identity;
      if (channel === 'models:state') return { providers: [], available: [], active: null, worker: null };
      if (channel === 'memory:state') return { path: '/memory.md' };
      if (channel === 'notifications:target') return null;
      if (channel === 'services:state') return { services: [] };
      if (channel === 'schedules:state') return { schedules: [] };
      if (channel === 'resources:begin') {
        const id = `upload-${++counter}`; const value = { id, offset: 0, size: args[0].size, chunkSize: 3, name: args[0].name }; uploads.set(id, value); return { ...value };
      }
      if (channel === 'resources:status') return { ...uploads.get(args[0]) };
      if (channel === 'resources:append') {
        if (refuseChunk) { refuseChunk = false; throw Error('模拟断网'); }
        const upload = uploads.get(args[0]); assert.equal(args[1], upload.offset);
        assert.ok(args[2] instanceof window.Uint8Array); upload.offset += args[2].length; return { ...upload };
      }
      if (channel === 'resources:complete') {
        const upload = uploads.get(args[0]); assert.equal(upload.offset, upload.size);
        const resource = { id: `resource-${upload.id}`, name: upload.name, mime: 'image/png', size: upload.size, state: 'ready' }; upload.resource = resource; return resource;
      }
      if (channel === 'resources:cancel') return;
      if (channel === 'resources:get') return [...uploads.values()].find(upload => upload.resource?.id === args[0]).resource;
      if (channel === 'resources:preview') return 'https://preview.test/token';
      if (channel === 'resources:save') { emit('resources:save-progress', { id: args[1], received: 3, size: 6 }); return true; }
      if (channel === 'chat:send') {
        if (refuseSend) { refuseSend = false; throw Error('模拟发送失败'); }
        const message = { id: '#1', role: 'user', text: args[0], at: Date.now(), attachments: args[1].map(id => [...uploads.values()].find(upload => upload.resource?.id === id).resource) };
        chat.messages.push(message); emit('chat:event', { type: 'message', message }); return;
      }
      return false;
    },
    send() {}, on: (channel, callback) => { if (!events.has(channel)) events.set(channel, new Set()); events.get(channel).add(callback); }, off: (channel, callback) => events.get(channel)?.delete(callback),
  };
  window.require = name => { assert.equal(name, 'electron'); return { ipcRenderer: transport, contextBridge: { exposeInMainWorld: (key, value) => { window[key] = value; } } }; };
  window.eval(readFileSync('out/preload/index.cjs', 'utf8'));
  window.rallyConnection = { state: async () => ({ mode: 'local', platform: 'desktop', url: '', instance: '' }) };
  const script = window.document.querySelector('script[type="module"]').getAttribute('src');
  const module = new SourceTextModule(readFileSync(resolve('out/renderer', script), 'utf8'), { context: dom.getInternalVMContext(), initializeImportMeta: meta => { meta.url = new URL(script, window.location.href).href; } });
  await module.link(() => { throw Error('Unexpected renderer import'); }); await module.evaluate();
  await until(() => window.document.querySelector('.chat-composer textarea'));
  await setTimeout(30); // Let StrictMode mount/cleanup and subscription effects settle.
  return { dom, window, calls, failures, uploads, emit };
}
function file(name) { return { name, size: 6, type: 'image/png', slice: (start, end) => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5, 6].slice(start, end)).buffer }) }; }
function buttons(window, text) { return [...window.document.querySelectorAll('button')].filter(button => button.textContent.includes(text)); }
function send(window) { window.document.querySelector('.chat-composer textarea').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }

test('built attachment UI pastes, retries chunks, preserves a failed send, opens one preview tab and saves', async () => {
  const { window, calls, failures } = await setup();
  try {
    const textarea = window.document.querySelector('.chat-composer textarea');
    const paste = new window.Event('paste', { bubbles: true, cancelable: true }); Object.defineProperty(paste, 'clipboardData', { value: { files: [file('paste.png')] } }); textarea.dispatchEvent(paste);
    await until(() => buttons(window, '重试').length); assert.equal(paste.defaultPrevented, true);
    send(window); await setTimeout(20); assert.equal(calls.filter(call => call.channel === 'chat:send').length, 0);
    buttons(window, '重试')[0].click(); await until(() => window.document.querySelector('.chat-composer').textContent.includes('已就绪'));
    assert.equal(calls.filter(call => call.channel === 'resources:begin').length, 1, 'retry resumes the same upload');
    send(window); await until(() => window.document.body.textContent.includes('模拟发送失败'));
    assert.match(window.document.querySelector('.chat-composer').textContent, /paste.png/);
    send(window); await until(() => buttons(window, '点击预览').length > 0);
    assert.deepEqual(Array.from(calls.filter(call => call.channel === 'chat:send').at(-1).args[1]), ['resource-upload-1']);
    await until(() => !window.document.querySelector('.chat-composer').textContent.includes('paste.png'));
    const card = buttons(window, '点击预览')[0]; card.click();
    await until(() => window.document.querySelector('h2')?.textContent === 'paste.png');
    assert.ok(window.document.querySelector('video') === null);
    card.click(); await setTimeout(20);
    assert.equal([...window.document.querySelectorAll('h2')].filter(item => item.textContent === 'paste.png').length, 1);
    buttons(window, '下载')[0].click(); await until(() => window.document.body.textContent.includes('已保存到所选位置'));
    assert.equal(calls.filter(call => call.channel === 'resources:save').length, 1);
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});

test('drop and picker share the queue and removal cancels an unfinished upload', async () => {
  const { window, calls, failures } = await setup();
  try {
    const drop = new window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(drop, 'dataTransfer', { value: { files: [file('drop.png')], types: ['Files'] } });
    window.document.querySelector('.chat-composer textarea').dispatchEvent(drop);
    await until(() => buttons(window, '重试').length); buttons(window, '移除')[0].click();
    await until(() => calls.some(call => call.channel === 'resources:cancel'));
    const picker = window.document.querySelector('.chat-composer input[type="file"]'); Object.defineProperty(picker, 'files', { value: [file('picked.png')] }); picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => window.document.querySelector('.chat-composer').textContent.includes('已就绪'));
    assert.ok(!window.document.querySelector('.chat-composer').textContent.includes('drop.png'));
    assert.match(window.document.querySelector('.chat-composer').textContent, /picked.png/);
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});

test('resource tabs render escaped text, audio/video controls and a recoverable missing-file state', async () => {
  const { window, uploads, emit, failures } = await setup();
  try {
    const items = [
      { id: 'text', name: 'safe.txt', mime: 'text/plain', size: 40, state: 'ready' },
      { id: 'audio', name: 'sound.wav', mime: 'audio/wav', size: 100, state: 'ready' },
      { id: 'video', name: 'clip.mp4', mime: 'video/mp4', size: 100, state: 'ready' },
      { id: 'missing', name: 'lost.png', mime: 'image/png', size: 100, state: 'missing' },
    ];
    for (const resource of items) uploads.set(resource.id, { resource });
    emit('chat:event', { type: 'message', message: { id: '#50', role: 'assistant', text: '产物', at: Date.now(), attachments: items } });
    await until(() => buttons(window, '点击预览').length === items.length);
    const open = name => buttons(window, name).find(button => button.textContent.includes('点击预览')).click();
    open('safe.txt');
    await until(() => [...window.document.querySelectorAll('pre')].some(element => element.textContent.includes('<script>'))).catch(error => { throw Error(window.document.body.textContent, { cause: error }); });
    assert.ok(!window.document.querySelector('pre script'));
    open('sound.wav'); await until(() => window.document.querySelector('audio[controls]'));
    open('clip.mp4'); await until(() => window.document.querySelector('video[controls]'));
    open('lost.png'); await until(() => [...window.document.querySelectorAll('[role="alert"]')].some(element => element.textContent.includes('原件已缺失')));
    assert.ok(buttons(window, '下载').find(button => button.disabled));
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});


test('task references support menu selection, removal and retry without appending titles to the sent text', async () => {
  const { window, calls, failures } = await setup([
    mentionTask('T-101', '旧任务', 1), mentionTask('T-102', '邮件附件', 2), mentionTask('T-103', '归档任务', 3, 4),
  ]);
  try {
    const composer = window.document.querySelector('.chat-composer');
    assert.ok(composer, failures.join("\n"));
    const textarea = composer.querySelector('textarea');
    const pick = composer.querySelector('[title="引用任务"]');
    const key = (target, key) => target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const setText = (value) => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
      textarea.setSelectionRange(value.length, value.length);
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    pick.click();
    await until(() => composer.querySelector('[role="listbox"]'));
    const search = composer.querySelector('input[role="combobox"]');
    assert.deepEqual([...composer.querySelectorAll('[role="option"]')].map(option => option.textContent.includes('邮件附件')), [true, false]);
    key(search, 'ArrowDown'); await until(() => composer.querySelector('[aria-selected="true"]').textContent.includes('旧任务'));
    key(search, 'Enter'); await until(() => composer.querySelector('[aria-label^="移除任务 T-101"]'));
    composer.querySelector('[aria-label^="移除任务 T-101"]').click();
    await until(() => !composer.querySelector('[aria-label^="移除任务"]'));

    setText('请继续@邮件');
    await until(() => composer.querySelectorAll('[role="option"]').length === 1);
    key(textarea, 'Enter'); await until(() => composer.querySelector('[aria-label^="移除任务 T-102"]'));
    assert.equal(textarea.value, '请继续');
    assert.equal(calls.filter(call => call.channel === 'chat:send').length, 0);
    send(window); await until(() => window.document.querySelector('[role="alert"]')?.textContent.includes('模拟发送失败'));
    assert.ok(composer.querySelector('[aria-label^="移除任务 T-102"]'));
    send(window); await until(() => window.document.querySelector('[aria-label^="打开任务 T-102"]'));
    assert.deepEqual(calls.filter(call => call.channel === 'chat:send').map(call => call.args[0]), ['请继续\n\n@T-102', '请继续\n\n@T-102']);
    await until(() => !composer.querySelector('[aria-label^="移除任务"]') && textarea.value === '');
    window.document.querySelector('[aria-label^="打开任务 T-102"]').click();
    await until(() => buttons(window, '在主对话中提及').length === 1);
    buttons(window, '在主对话中提及')[0].click();
    await until(() => composer.querySelector('[aria-label^="移除任务 T-102"]'));
    assert.equal(textarea.value, '');
    assert.deepEqual(failures, []);
  } finally { window.close(); }
});
