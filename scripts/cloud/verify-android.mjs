import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/** Check the same local ZIP names that Android AssetManager consumes, not just jar's listing. */
export function verifyAndroid(path, expectedAbi) {
  const bytes = readFileSync(path);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'Missing APK central directory');
  const entries = new Map();
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'Invalid APK ZIP entry');
    const nameLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    const local = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const localLength = bytes.readUInt16LE(local + 26);
    const localName = bytes.toString('utf8', local + 30, local + 30 + localLength);
    assert.equal(localName, name, `APK filename mismatch: ${name}`);
    assert.ok(!name.includes('\\'), `APK filename must use forward slashes: ${name}`);
    entries.set(name, { start: local + 30 + localLength + bytes.readUInt16LE(local + 28), size: bytes.readUInt32LE(offset + 20), method: bytes.readUInt16LE(offset + 10) });
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  const read = name => {
    const entry = entries.get(name); assert.ok(entry, `Missing APK asset: ${name}`);
    const compressed = bytes.subarray(entry.start, entry.start + entry.size);
    assert.ok(entry.method === 0 || entry.method === 8);
    return (entry.method === 8 ? inflateRawSync(compressed) : compressed).toString('utf8');
  };
  const html = read('assets/extension/ui/index.html');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(data:|https?:)/.test(match[1])) continue;
    assert.ok(entries.has(posix.normalize('assets/extension/ui/' + match[1])), `Missing entry resource: ${match[1]}`);
  }
  const manifest = JSON.parse(read('assets/extension/manifest.json'));
  assert.ok(manifest.permissions.includes('nativeMessaging'));
  assert.match(manifest.content_security_policy, /img-src [^;]*blob:/, 'Attachment thumbnails need Blob URLs');
  assert.match(manifest.content_security_policy, /media-src [^;]*https:/, 'Media preview policy is missing');
  assert.match(manifest.content_security_policy, /connect-src [^;]*https:/, 'Text preview policy is missing');
  const abis = [...new Set([...entries.keys()].flatMap(name => /^lib\/([^/]+)\//.exec(name)?.[1] ?? []))].sort();
  assert.ok(abis.length > 0, 'No native libraries');
  if (expectedAbi) assert.deepEqual(abis, [expectedAbi], 'APK must contain exactly its declared ABI');
  for (const abi of abis) assert.ok(entries.has(`lib/${abi}/libxul.so`), `Gecko engine is missing for ${abi}`);
  assert.ok(entries.has('assets/licenses/geckoview-MPL-2.0.txt'));
  assert.ok(entries.has('assets/licenses/geckoview-sources.txt'));
  console.log(`APK assets, ZIP paths and Gecko verified (${abis.join(', ')})`);
}
