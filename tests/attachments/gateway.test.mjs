import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ResourceGateway } from '../../src/main/cloud/resource-gateway.ts';
import { AccessStore, newKey } from '../../src/main/cloud/access.ts';
import { failure } from '../../src/main/cloud/http.ts';

test('preview tickets grant one read resource and revocation interrupts active byte streams', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rally-resource-gateway-'));
  const access = new AccessStore(join(directory, 'access.sqlite'), newKey());
  const pair = access.pair(access.issue('test')); const device = access.authenticate(pair.token);
  const socket = process.platform === 'win32' ? '\\\\.\\pipe\\rally-stream-' + randomUUID() : join(directory, 'runtime.sock');
  let ended; const upstreamEnded = new Promise(resolve => { ended = resolve; });
  const runtime = createServer((req, res) => {
    assert.equal(req.headers['x-rally-device'], device);
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': '999999' }); res.write(Buffer.alloc(1024));
    res.once('close', ended);
  });
  const gateway = new ResourceGateway(socket, access);
  const server = createServer((req, res) => { try { gateway.handle(req, res); } catch (error) { failure(res, error); } });
  try {
    runtime.listen(socket); await once(runtime, 'listening'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port; const id = randomUUID(); const ticket = gateway.ticket(device, id);
    const wrong = await fetch(base + ticket.replace(id, randomUUID())); assert.equal(wrong.status, 401); await wrong.text();
    const write = await fetch(base + ticket.replace('/resources/', '/uploads/').replace('/content', '') + '&offset=0', { method: 'PUT', body: 'x' }); assert.equal(write.status, 401); await write.text();
    const response = await fetch(base + ticket); const reader = response.body.getReader(); assert.ok((await reader.read()).value.length);
    access.revoke(device); gateway.revoke(device);
    await assert.rejects(reader.read()); await upstreamEnded;
    const revoked = await fetch(base + ticket); assert.equal(revoked.status, 401); await revoked.text();
  } finally {
    gateway.close(); server.closeAllConnections(); runtime.closeAllConnections();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => runtime.close(resolve))]);
    access.db.close(); await rm(directory, { recursive: true, force: true });
  }
});
