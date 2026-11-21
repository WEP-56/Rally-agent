import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from '@rally/ai';
import { registerFauxProvider } from '@rally/ai/compat';
import { Supervisor } from './src/main/supervisor/index.ts';
import { resolveRallyPaths, ensureRallyDirs } from './src/main/paths.ts';
import { defaultModel } from './src/shared/models.ts';

const textOf = message => typeof message?.content === 'string' ? message.content : message?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';
const paths = resolveRallyPaths(); process.env.RALLY_CODING_AGENT_DIR = paths.agentDir;
ensureRallyDirs(paths); mkdirSync(paths.workspaceDir, { recursive: true });
const image = readFileSync(process.env.RALLY_TEST_IMAGE); writeFileSync(join(paths.workspaceDir, 'directory.png'), image);
let supervisor = new Supervisor(paths, { emitChat() {}, emitTask() {} });
const faux = registerFauxProvider({ provider: 'offline-attachments', models: [{ id: 'main' }, { id: 'worker' }] });
async function configure() {
  await supervisor.models.save([{ id: 'offline-attachments', name: 'Offline', protocol: 'messages', baseUrl: 'http://127.0.0.1:1', apiKey: 'faux-key', models: faux.models.map(model => defaultModel(model.id)) }]);
  const runtime = await supervisor.models.whenReady();
  runtime.registerProvider('offline-attachments', { api: faux.api, apiKey: 'faux-key', baseUrl: 'http://127.0.0.1:1', models: faux.models.map(model => ({ ...model, type: 'chat' })) });
  supervisor.models.setActive({ provider: 'offline-attachments', model: 'main', thinkingLevel: 'off' });
  await supervisor.models.selectWorker({ provider: 'offline-attachments', model: 'worker', thinkingLevel: 'off' });
}
async function until(predicate) {
  const deadline = Date.now() + 20000;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out: ' + JSON.stringify({ chat: supervisor.main.state(), board: supervisor.board() })); await setTimeout(25); }
}
function checkImage(context) {
  const message = context.messages.findLast(message => message.role === 'user');
  assert.ok(Array.isArray(message.content));
  const block = message.content.find(part => part.type === 'image'); assert.ok(block, 'model request must carry actual image bytes');
  assert.ok(Buffer.from(block.data, 'base64').length > 0);
  return textOf(message);
}
try {
  await configure(); await supervisor.start();
  const photo = await supervisor.resources.importBytes('desktop', 'upload.png', image);
  const ordinary = await supervisor.resources.importBytes('desktop', 'data.txt', Buffer.from('attachment-data'));
  let userId;
  faux.setResponses([
    context => {
      const text = checkImage(context); userId = /User message (#\d+)/.exec(text)[1];
      assert.match(text, new RegExp(ordinary.id));
      return fauxAssistantMessage(fauxToolCall('task_dispatch', { title: '附件链路', quotes: [{ id: userId }], cwd: paths.workspaceDir, mode: 'write', scope: ['result.txt'] }), { stopReason: 'toolUse' });
    },
    fauxAssistantMessage('等待批准附件任务。'),
    context => {
      assert.ok(getCurrentTools(context.messages).some(tool => tool.name === 'resource_publish'));
      assert.match(checkImage(context), new RegExp(photo.id));
      return fauxAssistantMessage(fauxToolCall('read', { path: 'directory.png' }), { stopReason: 'toolUse' });
    },
    context => {
      const result = context.messages.findLast(message => message.role === 'toolResult');
      assert.ok(result.content.some(part => part.type === 'image'), 'capturing preview must retain model image block');
      assert.match(textOf(result), /Displayed image resources/);
      return fauxAssistantMessage(fauxToolCall('write', { path: 'result.txt', content: 'generated artifact' }), { stopReason: 'toolUse' });
    },
    fauxAssistantMessage(fauxToolCall('resource_publish', { paths: ['result.txt', 'directory.png'] }), { stopReason: 'toolUse' }),
    context => {
      assert.match(textOf(context.messages.findLast(message => message.role === 'toolResult')), /Published resources/);
      return fauxAssistantMessage(fauxToolCall('task_report', { state: 'ready', summary: '附件产物已发布' }), { stopReason: 'toolUse' });
    },
    fauxAssistantMessage('worker 完成'),
    context => {
      assert.ok(context.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image')), 'report relay preserves image payload');
      return fauxAssistantMessage('附件任务完成。');
    },
  ]);
  await supervisor.main.send('请查看附件并写出一个结果文件。', [photo.id, ordinary.id]);
  await until(() => supervisor.board().tasks[0]?.status === 'pending_approval' && !supervisor.main.isBusy());
  const task = supervisor.store.list()[0]; assert.deepEqual(task.quotes[0].attachments.map(ref => ref.id), [photo.id, ordinary.id]);
  supervisor.approve(task.id);
  await until(() => task.ended?.outcome === 'done' && !supervisor.workers.has(task.id) && supervisor.main.state().messages.some(message => message.text === '附件任务完成。'));
  const generated = task.runs[0].lastReport.attachments; assert.equal(generated.length, 2);
  assert.equal(readFileSync(supervisor.resources.path(generated[0].id), 'utf8'), 'generated artifact');
  assert.equal(supervisor.resources.get(generated[0].id, 'another-device').id, generated[0].id);
  assert.ok(supervisor.store.view(task).assistantMessages.some(message => message.attachments?.some(ref => ref.name.includes('directory.png'))));
  assert.ok(supervisor.main.state().messages.some(message => message.role === 'system' && message.attachments?.some(ref => ref.id === generated[0].id)));
  assert.equal(faux.getPendingResponseCount(), 0);
  // Main read captures a display resource as well, without exposing bytes to snapshots.
  faux.setResponses([fauxAssistantMessage(fauxToolCall('read', { path: 'directory.png' }), { stopReason: 'toolUse' }), fauxAssistantMessage('目录图片已读取。')]);
  await supervisor.main.send('查看工作区目录图片');
  await until(() => supervisor.main.state().messages.some(message => message.text === '目录图片已读取。') && !supervisor.main.isBusy());
  assert.ok(supervisor.main.state().messages.some(message => message.role === 'assistant' && message.attachments?.some(ref => ref.name.includes('directory.png'))));
  assert.ok(!JSON.stringify(supervisor.board()).includes(image.toString('base64')));
  writeFileSync(join(paths.workspaceDir, 'result.txt'), 'modified source');
  assert.equal(readFileSync(supervisor.resources.path(generated[0].id), 'utf8'), 'generated artifact');
  // Dependency startup must inherit actual image bytes and persist its own references.
  faux.setResponses([
    context => {
      assert.match(checkImage(context), new RegExp(generated[1].id));
      return fauxAssistantMessage(fauxToolCall('task_report', { state: 'ready', summary: '上游图片已接收' }), { stopReason: 'toolUse' });
    },
    fauxAssistantMessage('consumer 完成'), fauxAssistantMessage('依赖任务已完成。'),
  ]);
  const consumer = supervisor.store.create({ title: '读取上游附件', quotes: [], cwd: paths.workspaceDir, mode: 'readonly', scope: [], dependsOn: [task.id], autoApprove: false }).task;
  supervisor.approve(consumer.id);
  await until(() => supervisor.store.get(consumer.id).ended?.outcome === 'done' && !supervisor.workers.has(consumer.id) && !supervisor.main.isBusy());
  assert.deepEqual(supervisor.store.get(consumer.id).inputs.find(input => input.kind === 'upstream').attachments.map(ref => ref.id), generated.map(ref => ref.id));
  await supervisor.dispose();
  supervisor = new Supervisor(paths, { emitChat() {}, emitTask() {} });
  assert.deepEqual(supervisor.main.quote({ id: userId }).attachments.map(ref => ref.id), [photo.id, ordinary.id]);
  assert.deepEqual(supervisor.store.get(task.id).runs[0].lastReport.attachments, generated);
  assert.ok(supervisor.store.view(supervisor.store.get(task.id)).assistantMessages.some(message => message.attachments?.length));
  unlinkSync(supervisor.resources.path(generated[0].id));
  assert.equal(supervisor.resources.get(generated[0].id, 'another-device').state, 'missing');
  console.log('Attachment chain passed: image input, quotes, directory read, publish, relay, cross-device metadata, restart');
} finally { await supervisor.dispose(); faux.unregister(); }
