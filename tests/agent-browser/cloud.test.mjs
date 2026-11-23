import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { newKey } from '../../src/main/cloud/access.ts';
import { CloudMirror } from '../../src/shared/cloud-state.ts';

test('authenticated cloud devices view/control independently; revocation invalidates control and frames never enter cache', { timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-browser-cloud-')), key = newKey(), children = [];
  const socket = process.platform === 'win32' ? '\\\\.\\pipe\\rally-browser-' + randomUUID() : join(dir, 'runtime.sock');
  writeFileSync(join(dir, 'admin.key'), key);
  async function start(path, marker) {
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'LOCALAPPDATA', 'PLAYWRIGHT_BROWSERS_PATH', 'LD_LIBRARY_PATH'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
    const child = spawn(process.execPath, [resolve(path)], { env: { ...env, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, RALLY_FIXTURE: dir, RALLY_SOCKET: socket, RALLY_CONTROL_DIR: dir, RALLY_CREDENTIALS_DIR: dir, RALLY_PORT: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
    child.fixture = path.includes('cloud-fixture');
    children.push(child); let log = '';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(log || 'startup timeout')), 20000);
      child.stderr.on('data', data => { log += data; });
      child.once('exit', () => { clearTimeout(timer); reject(Error(log || 'early exit')); });
      child.stdout.on('data', data => { log += data; const match = log.match(marker); if (match) { clearTimeout(timer); resolve(match); } });
    });
  }
  try {
    await start('tests/agent-browser/cloud-fixture.mjs', /fixture ready/);
    const match = await start('out/server/src/main/cloud/server.ts', /port: (\d+)/);
    const base = 'http://127.0.0.1:' + match[1];
    const post = async (route, token, body) => { const response = await fetch(base + '/v1/' + route, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
    const pair = async name => { const issue = await post('admin', key, { action: 'issue', name }); return (await post('pair', issue.data.key, { protocol: 1 })).data; };
    const a = await pair('desktop'), b = await pair('mobile');
    const rpc = (device, channel, ...args) => post('rpc', device.token, { protocol: 1, instance: device.instance, channel, args });
    const state = await rpc(a, 'agent-browser:state'); assert.equal(state.status, 200);
    const id = state.data[0].id;
    const frame = await rpc(b, 'agent-browser:frame', id); assert.equal(frame.status, 200); assert.ok(frame.data.data.length);
    const cache = new CloudMirror(base, a.instance); cache.remember('agent-browser:frame', frame.data); assert.equal(cache.read('agent-browser:frame'), undefined);
    assert.equal((await rpc(a, 'agent-browser:take', id)).status, 200);
    assert.equal((await rpc(b, 'agent-browser:take', id)).status, 400);
    const fresh = await rpc(a, 'agent-browser:frame', id);
    assert.equal((await rpc(b, 'agent-browser:input', id, fresh.data, { kind: 'click', x: 1, y: 1 })).status, 400);
    const devices = (await post('admin', key, { action: 'status' })).data.devices;
    const entry = devices.find(device => device.name === 'desktop'); assert.ok(entry);
    assert.equal((await post('admin', key, { action: 'revoke', id: entry.id })).status, 200);
    assert.equal((await rpc(a, 'agent-browser:input', id, fresh.data, { kind: 'click', x: 1, y: 1 })).status, 401);
    assert.equal((await rpc(b, 'agent-browser:state')).data[0].owner, 'waiting');
    assert.equal((await rpc(b, 'agent-browser:take', id)).status, 200);
    assert.equal((await rpc(b, 'agent-browser:return', id)).status, 200);
    assert.equal((await rpc(b, 'agent-browser:input', id, fresh.data, { kind: 'click', x: 1, y: 1 })).status, 400);
  } finally {
    for (const child of children.reverse()) if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); if (child.fixture) child.stdin.end(); else child.kill(); await done; }
    rmSync(dir, { recursive: true, force: true });
  }
});
