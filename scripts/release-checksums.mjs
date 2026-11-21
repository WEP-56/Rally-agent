import { createReadStream } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const directory = resolve(process.argv[2] ?? 'release');
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const tag = process.argv.indexOf('--tag');
if (tag !== -1) assert.equal(process.argv[tag + 1], `v${version}`, 'Tag must match package.json');
const expected = [
  `Rally-${version}-setup.exe`, `rally-server-${version}-linux-x64.tar.gz`,
  ...['arm64-v8a', 'armeabi-v7a', 'x86_64'].map(abi => `Rally-${version}-android-${abi}.apk`),
].sort();
const actual = (await readdir(directory)).filter(name => /\.(exe|apk|tar\.gz)$/.test(name)).sort();
assert.deepEqual(actual, expected, 'Release requires exactly one Windows, one Linux x64 and three signed Android ABI packages');
const lines = [];
for (const name of expected) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(join(directory, 'SHA256SUMS'), lines.join('\n') + '\n');
console.log(`Verified release file set for v${version}; wrote SHA256SUMS`);
