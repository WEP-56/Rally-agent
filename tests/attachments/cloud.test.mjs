import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { newKey } from '../../src/main/cloud/access.ts';
import { CloudResourceClient } from '../../src/main/cloud/resource-client.ts';

test('cloud binary transport resumes, isolates drafts, shares published resources and verifies native downloads', { timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-cloud-resources-')); const key = newKey(); const children = [];
  writeFileSync(join(dir, 'admin.key'), key); writeFileSync(join(dir, 'vault.key'), newKey());
  const socket = process.platform === 'win32' ? '\\\\.\\pipe\\rally-resources-' + randomUUID() : join(dir, 'runtime.sock');
  async function start(file, marker) {
    const child = spawn(process.env.RALLY_TEST_SERVER ? join(process.env.RALLY_TEST_SERVER, 'bin/node') : process.execPath, [resolve(process.env.RALLY_TEST_SERVER ?? 'out/server', 'src/main/cloud', file)], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, RALLY_SOCKET: socket, RALLY_CONTROL_DIR: dir, RALLY_CREDENTIALS_DIR: dir, RALLY_PORT: '0', PI_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
    let logs = '';
    return new Promise((done, fail) => {
      const timer = setTimeout(() => fail(Error('Startup timed out: ' + logs)), 25000);
      child.once('exit', () => { clearTimeout(timer); fail(Error(logs)); }); child.stderr.on('data', data => { logs += data; });
      child.stdout.on('data', data => { logs += data; const match = logs.match(marker); if (match) { clearTimeout(timer); done({ child, match }); } });
    });
  }
  async function stop(child) { if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  try {
    let runtime = await start('runtime.ts', /runtime ready/); const gateway = await start('server.ts', /port: (\d+)/);
    const base = 'http://127.0.0.1:' + gateway.match[1];
    const post = async (route, token, body) => { const response = await fetch(base + '/v1/' + route, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
    const pair = async name => { const issue = await post('admin', key, { action: 'issue', name }); const paired = await post('pair', issue.data.key, { protocol: 1 }); assert.equal(paired.status, 200); return paired.data; };
    const a = await pair('Desktop'), b = await pair('Android');
    const call = (device, channel, ...args) => post('rpc', device.token, { protocol: 1, instance: device.instance, channel, args, requestId: randomUUID() });
    const rpc = async (device, channel, ...args) => { const result = await call(device, channel, ...args); assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
    const nativeA = new CloudResourceClient(base, a.instance, () => a.token); const nativeB = new CloudResourceClient(base, b.instance, () => b.token); const signal = new AbortController().signal;
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 29, 81);
    const upload = await rpc(a, 'resources:begin', { name: 'large-file.bin', size: bytes.length });
    await nativeA.append(upload.id, 0, bytes.subarray(0, 1024 * 1024), signal);
    assert.notEqual((await call(b, 'resources:status', upload.id)).status, 200);
    await assert.rejects(() => nativeB.append(upload.id, 0, Buffer.from('x'), signal), /不属于/);
    await stop(runtime.child); runtime = await start('runtime.ts', /runtime ready/);
    assert.equal((await rpc(a, 'resources:status', upload.id)).offset, 1024 * 1024);
    await nativeA.append(upload.id, 0, bytes.subarray(0, 1024 * 1024), signal); // lost response / retry
    for (let offset = 1024 * 1024; offset < bytes.length; offset += 1024 * 1024) await nativeA.append(upload.id, offset, bytes.subarray(offset, offset + 1024 * 1024), signal);
    const resource = await rpc(a, 'resources:complete', upload.id);
    assert.equal(resource.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.notEqual((await call(b, 'resources:get', resource.id)).status, 200);
    // No model is configured: publication and multi-device state still work without API calls.
    await rpc(a, 'chat:send', '', [resource.id]);
    assert.equal((await rpc(b, 'resources:get', resource.id)).id, resource.id);
    assert.ok((await rpc(b, 'chat:state')).messages.some(message => message.attachments?.[0]?.id === resource.id));
    const ticket = await rpc(b, 'resources:preview', resource.id);
    assert.ok(!ticket.includes(b.token));
    const range = await fetch(base + ticket, { headers: { Range: 'bytes=2-7' } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(2, 8));
    const badRange = await fetch(base + ticket, { headers: { Range: 'bytes=99999999-' } }); assert.equal(badRange.status, 416); await badRange.text();
    const anonymous = await fetch(base + `/v1/resources/${resource.id}/content`); assert.equal(anonymous.status, 401); await anonymous.text();
    const wrongInstance = await fetch(base + `/v1/resources/${resource.id}/content`, { headers: { Authorization: 'Bearer ' + a.token, 'X-Rally-Instance': 'wrong', 'X-Rally-Protocol': '1' } }); assert.equal(wrongInstance.status, 409); await wrongInstance.text();
    const saved = join(dir, 'downloaded.bin'); const progress = [];
    await nativeB.save(resource, saved, signal, count => progress.push(count)); assert.deepEqual(readFileSync(saved), bytes); assert.equal(progress.at(-1), bytes.length);
    const png = readFileSync('src/renderer/src/assets/rally-mark.png');
    const imageUpload = await rpc(a, 'resources:begin', { name: 'source.png', size: png.length }); await nativeA.append(imageUpload.id, 0, png, signal);
    const image = await rpc(a, 'resources:complete', imageUpload.id); const thumbnail = await rpc(a, 'resources:preview', image.id, true);
    const imageResponse = await fetch(base + thumbnail); assert.match(imageResponse.headers.get('content-type'), /^image\/(png|jpeg)$/); assert.ok((await imageResponse.arrayBuffer()).byteLength < 128 * 1024);
    const cancelled = await rpc(a, 'resources:begin', { name: 'cancel.bin', size: 3 }); await rpc(a, 'resources:cancel', cancelled.id);
    assert.match((await call(a, 'resources:status', cancelled.id)).data.error, /UPLOAD_NOT_FOUND/);
    const status = await post('admin', key, { action: 'status' }); await post('admin', key, { action: 'revoke', id: status.data.devices.find(device => device.name === 'Android').id });
    const revoked = await fetch(base + ticket); assert.equal(revoked.status, 401); await revoked.text();
    await assert.rejects(() => nativeB.save(resource, join(dir, 'revoked.bin'), signal, () => {}), /401/);
    assert.equal((await rpc(a, 'resources:get', resource.id)).state, 'ready');
  } finally { for (const child of children.reverse()) await stop(child); rmSync(dir, { recursive: true, force: true }); }
});
