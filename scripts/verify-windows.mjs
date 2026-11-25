import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
import { load } from 'js-yaml';
import { verifyExternalAgentPackagePaths } from './verify-external-agent-packaging.mjs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const configuration = load(readFileSync('electron-builder.yml', 'utf8'));
assert.equal(configuration.appId, 'dev.rally.app');
assert.equal(configuration.win.icon, 'build/icon.ico');
assert.equal(configuration.nsis.installerIcon, configuration.win.icon);
assert.equal(configuration.nsis.uninstallerIcon, configuration.win.icon);
const directory = resolve('release/win-unpacked');
const resources = join(directory, 'resources');
const ico = readFileSync(join(resources, 'icon.ico'));
assert.deepEqual(ico, readFileSync('build/icon.ico'));
assert.equal(ico.readUInt16LE(2), 1);
const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico[6 + 16 * index] || 256);
for (const size of [16, 32, 48, 256]) assert.ok(sizes.includes(size), `Missing Windows icon size ${size}`);
assert.deepEqual(readFileSync(join(resources, 'icon.png')), readFileSync('docs/icon.png'));
assert.ok(statSync(join(resources, 'skills', 'SKILL.md')).isFile(), 'Missing top-level built-in Skill index');
for (const name of ['identity.md', 'coach.md', 'model-provider.md', 'media-search.md', 'mcp.md', 'skills.md', 'roles.md', 'external-agents.md']) {
  assert.ok(statSync(join(resources, 'skills', 'references', name)).isFile(), `Missing built-in Skill reference ${name}`);
}
const archive = join(resources, 'app.asar'); const files = listPackage(archive).map(path => path.replaceAll('\\', '/'));
verifyExternalAgentPackagePaths([...files, ...readdirSync(directory, { recursive: true })]);
for (const path of ['/out/main/index.js', '/out/preload/index.cjs', '/out/renderer/index.html']) assert.ok(files.includes(path), `Missing ${path}`);
assert.equal(JSON.parse(extractFile(archive, 'package.json')).version, version);
const main = extractFile(archive, join('out', 'main', 'index.js')).toString();
for (const marker of ['dev.rally.app', 'desktop-v1.json', 'desktop:state']) assert.ok(main.includes(marker), `Missing desktop implementation ${marker}`);
for (const path of [join(directory, 'Rally.exe'), `release/Rally-${version}-setup.exe`]) {
  const file = readFileSync(path); assert.equal(file.toString('ascii', 0, 2), 'MZ'); assert.ok(statSync(path).size > 1024 * 1024);
}
console.log('Windows application, installer, version and shared icon assets verified');
