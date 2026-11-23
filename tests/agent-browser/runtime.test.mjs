import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

test('persistent Chromium supports AI references, shared login state, frames and input', { timeout: 60000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'rally-browser-test-'));
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<label>Message<input></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Apply</button><output></output>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true });
    const page = context.pages()[0]; await page.goto(origin);
    const snapshot = await page.ariaSnapshot({ mode: 'ai' });
    const input = /textbox "Message" \[ref=(\w+)\]/.exec(snapshot)?.[1];
    const button = /button "Apply" \[ref=(\w+)\]/.exec(snapshot)?.[1];
    assert.ok(input); assert.ok(button);
    await page.getByRef(input).fill('中文输入');
    await page.getByRef(button).click();
    assert.equal(await page.locator('output').textContent(), '中文输入');
    await context.addCookies([{ name: 'rally_test', value: 'shared', url: origin, expires: Date.now() / 1000 + 3600 }]);
    const second = await context.newPage(); await second.goto(origin);
    assert.match(await second.evaluate(() => document.cookie), /rally_test=shared/);
    let frame;
    await page.screencast.start({ size: { width: 800, height: 600 }, fps: 2, onFrame: value => { frame = value; } });
    await page.getByRef(input).press('End');
    await page.keyboard.insertText('完成');
    const deadline = Date.now() + 10000;
    while (!frame && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(frame?.data.length > 0); assert.ok(frame.viewportWidth > 0);
    await page.screencast.stop();
    assert.equal(await page.getByRef(input).inputValue(), '中文输入完成');
    await context.close(); context = undefined;
    context = await chromium.launchPersistentContext(profile, { headless: true });
    assert.equal((await context.cookies(origin)).find(cookie => cookie.name === 'rally_test')?.value, 'shared');
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
