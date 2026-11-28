import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebsiteAccounts } from '../../src/main/website-accounts.ts';
import { cloudVault } from '../../src/main/cloud/vault.ts';

test('encrypted accounts survive restart, publish only metadata and obey origin and enabled state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-accounts-'));
  try {
    const file = join(dir, 'accounts.txt'), vault = cloudVault(randomBytes(32));
    const store = new WebsiteAccounts(file, vault);
    const username = 'unique-account@example.test', password = '  unique-secret-中文!  ';
    const request = store.request('call-1', 'https://example.test/login');
    assert.deepEqual(store.request('call-1', 'https://example.test'), request);
    assert.throws(() => store.request('call-1', 'https://other.test'), /其他网站/);
    const submit = { requestId: request.id, website: request.origin, username, password };
    assert.throws(() => store.submit({ ...submit, website: 'https://example.test.evil.test' }), /来源一致/);
    const saved = store.submit(submit);
    assert.deepEqual(store.submit(submit), saved);
    assert.deepEqual(store.submit({ ...submit, username: 'second-device', password: 'must-not-replace' }), saved);
    assert.equal(store.state().accounts.length, 1);
    for (const publicOutput of [JSON.stringify(saved), JSON.stringify(store.state()), readFileSync(file, 'utf8')]) {
      assert.ok(!publicOutput.includes(username)); assert.ok(!publicOutput.includes(password));
    }
    const restored = new WebsiteAccounts(file, vault);
    assert.deepEqual(restored.forHost(saved.accountId, request.origin), { username, password });
    for (const wrong of ['http://example.test', 'https://example.test:444', 'https://other.test']) assert.throws(() => restored.forHost(saved.accountId, wrong), /没有可用/);
    restored.update(saved.accountId, false);
    assert.throws(() => restored.forHost(saved.accountId, request.origin), /没有可用/);
    restored.replace(saved.accountId, { username: 'changed-user', password: '  changed-password  ' });
    assert.throws(() => restored.forHost(saved.accountId, request.origin), /没有可用/);
    restored.update(saved.accountId, true);
    assert.deepEqual(restored.forHost(saved.accountId, request.origin), { username: 'changed-user', password: '  changed-password  ' });
    restored.remove(saved.accountId);
    assert.throws(() => restored.forHost(saved.accountId, request.origin), /没有可用/);
    assert.deepEqual(readdirSync(dir), ['accounts.txt']);
    assert.throws(() => new WebsiteAccounts(file, cloudVault(randomBytes(32))), /无法解密/);
    writeFileSync(file, 'broken');
    assert.throws(() => new WebsiteAccounts(file, vault), /无法解密/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cancelled requests and unavailable encryption never accept or persist secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-accounts-'));
  try {
    const file = join(dir, 'accounts.txt');
    const unavailable = new WebsiteAccounts(file);
    assert.throws(() => unavailable.request('no-vault', 'https://example.test'), /加密不可用/);
    assert.deepEqual(readdirSync(dir), []);
    const store = new WebsiteAccounts(file, cloudVault(randomBytes(32)));
    store.request('cancel', 'https://example.test'); store.cancel('cancel');
    assert.equal(store.submit({ requestId: 'cancel', website: 'https://example.test', username: 'u', password: 'p' }).status, 'cancelled');
    store.cancel('cancel'); assert.equal(store.state().accounts.length, 0);
    assert.throws(() => new WebsiteAccounts(file, undefined), /加密不可用/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('requests expire with time or their associated run and remain idempotent after restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-accounts-'));
  try {
    const file = join(dir, 'accounts.txt'), vault = cloudVault(randomBytes(32));
    let active = true;
    const store = new WebsiteAccounts(file, vault, (taskId, runId) => active && taskId === 'task' && runId === 'run');
    const request = store.request('bound', 'https://example.test', { taskId: 'task', runId: 'run', purpose: '登录测试' });
    active = false;
    assert.equal(store.submit({ requestId: request.id, website: request.origin, username: 'u', password: 'p' }).status, 'expired');
    const restored = new WebsiteAccounts(file, vault);
    assert.equal(restored.state().requests[0].status, 'expired');
    assert.equal(restored.state().accounts.length, 0);
    const timed = restored.request('timed', request.origin);
    t.mock.method(Date, 'now', () => timed.createdAt + 24 * 60 * 60 * 1000);
    assert.equal(restored.submit({ requestId: timed.id, website: timed.origin, username: 'u', password: 'p' }).status, 'expired');
    assert.equal(restored.state().accounts.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('secret-only entries support named services, replacement, disable and legacy encrypted accounts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rally-password-book-'));
  try {
    const file = join(dir, 'accounts.txt'), vault = cloudVault(randomBytes(32));
    const legacy = { id: 'old-account', origin: 'https://example.test', enabled: true, createdAt: 1, username: 'old-user', password: 'old-password' };
    writeFileSync(file, vault.encrypt(JSON.stringify({ version: 1, accounts: [legacy], requests: [] })).toString('base64'));
    const store = new WebsiteAccounts(file, vault);
    assert.deepEqual(store.forHost(legacy.id, legacy.origin), { username: legacy.username, password: legacy.password });
    assert.equal(store.valueForHost({ id: legacy.id, field: 'username' }), legacy.username);
    const request = store.request('token', 'Gitee 项目维护', { kind: 'secret', label: '工作项目 Token' });
    const saved = store.submit({ requestId: request.id, website: request.origin, password: '  private-token  ' });
    const restored = new WebsiteAccounts(file, vault);
    assert.equal(restored.state().accounts[1].kind, 'secret');
    assert.equal(restored.valueForHost({ id: saved.accountId }), '  private-token  ');
    assert.throws(() => restored.valueForHost({ id: saved.accountId, field: 'username' }), /只有密钥/);
    assert.throws(() => restored.valueForHost({ id: saved.accountId, field: 'unknown' }), /引用无效/);
    restored.replace(saved.accountId, { password: 'replacement-token' });
    assert.equal(restored.valueForHost({ id: saved.accountId }), 'replacement-token');
    assert.equal(restored.state().accounts[1].kind, 'secret');
    restored.update(saved.accountId, false);
    assert.throws(() => restored.valueForHost({ id: saved.accountId }), /已停用/);
    restored.update(saved.accountId, true);
    restored.remove(saved.accountId);
    assert.throws(() => restored.valueForHost({ id: saved.accountId }), /不存在/);
    store.request('convert', 'https://gitee.com', { kind: 'account' });
    const converted = store.submit({ requestId: 'convert', website: 'https://gitee.com', kind: 'secret', password: 'just-a-token' });
    assert.deepEqual(store.request('convert', 'https://gitee.com', { kind: 'account' }), converted);
    assert.throws(() => store.forHost(converted.accountId, 'https://gitee.com'), /没有可用/);
    assert.ok(!JSON.stringify(store.state()).includes('just-a-token'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
