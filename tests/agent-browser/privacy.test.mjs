import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AgentBrowserService } from '../../src/main/agent-browser/service.ts';
import { WebsiteAccounts } from '../../src/main/website-accounts.ts';
import { cloudVault } from '../../src/main/cloud/vault.ts';
import { browserCommand } from '../../src/main/agent-browser/commands.ts';

test('untrusted pages cannot inspect redaction secrets; a private frame requires its controlling device', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rally-browser-privacy-'));
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<p>Public page</p><input value="Visible to the controlling user"><input type="password"><script>
      window.captured = [];
      const original = Array.prototype.some;
      Array.prototype.some = function(...args) { captured.push([...this]); return original.apply(this, args); };
    </script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const accounts = new WebsiteAccounts(join(directory, 'accounts.txt'), cloudVault(randomBytes(32)));
  accounts.request('unrelated', 'https://unrelated.example.test');
  const username = 'OTHER-SITE-PRIVATE-ACCOUNT', password = 'OTHER-SITE-PRIVATE-PASSWORD';
  accounts.submit({ requestId: 'unrelated', website: 'https://unrelated.example.test', username, password });
  const browser = new AgentBrowserService(join(directory, 'profile'), accounts);
  try {
    const window = await browser.open('task', 'run', `http://127.0.0.1:${server.address().port}`);
    const page = browser.windows.get(window.id).page;
    await browser.snapshot(window.id);
    const masked = await browser.frame(window.id);
    const original = (await page.screenshot({ type: 'jpeg', quality: 65, scale: 'css' })).toString('base64');
    assert.notEqual(masked.data, original, 'agent frames still mask inputs');
    const captured = await page.evaluate(() => JSON.stringify(window.captured));
    assert.ok(!captured.includes(username), 'page received another origin account');
    assert.ok(!captured.includes(password), 'page received another origin password');
    await browser.take(window.id, 'device-a');
    await assert.rejects(Promise.resolve().then(() => browserCommand(browser, 'device-b', 'agent-browser:frame', [window.id])), /控制|私密/);
    const frame = await browserCommand(browser, 'device-a', 'agent-browser:frame', [window.id]);
    assert.equal(frame.data, original, 'the controlling user sees the original page without masks');
    await assert.rejects(browser.frame(window.id, true, 'device-a'), /缩略图已暂停/);
    await browser.handBack(window.id, 'device-a');
    assert.equal((await browser.frame(window.id)).data, masked.data, 'handing back restores masked frames');
  } finally { await browser.dispose(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
