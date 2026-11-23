import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('Linux bundle includes its pinned browser and supports persistent launch', { skip: !process.env.RALLY_TEST_BROWSER_ROOT || process.platform !== 'linux' }, async () => {
  const require = createRequire(join(resolve(process.env.RALLY_TEST_BROWSER_ROOT), 'package.json'));
  const { chromium } = require('playwright');
  const profile = await mkdtemp(join(tmpdir(), 'rally-linux-package-browser-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true });
    const page = context.pages()[0]; await page.setContent('<button>Linux package</button>');
    assert.match(await page.ariaSnapshot({ mode: 'ai' }), /Linux package/);
  } finally { if (context) await context.close(); await rm(profile, { recursive: true, force: true }); }
});
