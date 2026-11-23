import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

test('packaged Electron Node host launches the bundled Chromium without an installed user browser', { skip: !process.env.RALLY_TEST_DESKTOP, timeout: 40000 }, async () => {
  const directory = resolve(process.env.RALLY_TEST_DESKTOP), profile = await mkdtemp(join(tmpdir(), 'rally-browser-package-'));
  const resources = join(directory, 'resources');
  const child = spawn(join(directory, 'Rally.exe'), [join(resources, 'app.asar/out/main/browser-host.js'), profile], {
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: profile, TMP: profile, HOME: profile, USERPROFILE: profile, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: join(resources, 'browser') },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  const closed = once(child, 'exit'); let context;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let output = '', error = '';
      const timer = setTimeout(() => reject(Error('packaged host timed out: ' + error)), 20000);
      child.stderr.on('data', data => { error += data; });
      child.once('exit', () => { clearTimeout(timer); reject(Error(error || 'early exit')); });
      child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output).endpoint); } });
    });
    const browser = await chromium.connectOverCDP(endpoint); context = browser.contexts()[0];
    const page = context.pages()[0]; await page.setContent('<button>Packaged browser</button>');
    assert.match(await page.ariaSnapshot({ mode: 'ai' }), /Packaged browser/);
    assert.ok((await page.screenshot()).length);
  } finally { child.stdin.end(); await closed; if (context) await context.browser().close(); await rm(profile, { recursive: true, force: true }); }
});
