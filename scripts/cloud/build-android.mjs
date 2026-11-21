import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import assert from 'node:assert/strict';
import { verifyAndroid } from './verify-android.mjs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const debug = process.argv.includes('--debug');
const abis = ['arm64-v8a', 'armeabi-v7a', 'x86_64'];
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : undefined);
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...(sdk ? { ANDROID_HOME: sdk } : {}) }, ...options });
  if (result.error || result.status !== 0) throw result.error ?? Error(`Android build failed (${result.status})`);
};
mkdirSync('.artifacts', { recursive: true });
mkdirSync('release', { recursive: true });
if (debug && !existsSync('.artifacts/android-debug.p12')) {
  const executable = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
  run(executable, ['-genkeypair', '-keystore', resolve('.artifacts/android-debug.p12'), '-storepass', 'android', '-alias', 'rally-debug', '-keyalg', 'RSA', '-validity', '3650', '-dname', 'CN=Rally Local Debug']);
}
if (!debug && ['ANDROID_KEYSTORE', 'ANDROID_KEY_ALIAS', 'ANDROID_STORE_PASSWORD', 'ANDROID_KEY_PASSWORD'].some(key => !process.env[key])) throw Error('Release signing credentials required');
const args = [debug ? 'assembleDebug' : 'assembleRelease', '--no-daemon', ...process.argv.filter(arg => arg === '--offline' || arg === '--write-locks' || arg.startsWith('--write-verification-metadata'))];
if (process.platform === 'win32') run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', ...args], { cwd: resolve('android') });
else run('sh', ['gradlew', ...args], { cwd: resolve('android') });
const variant = debug ? 'debug' : 'release';
const directory = resolve(`android/build/outputs/apk/${variant}`);
const metadata = JSON.parse(readFileSync(join(directory, 'output-metadata.json'), 'utf8'));
assert.equal(metadata.applicationId, 'dev.rally.mobile');
assert.equal(metadata.elements.length, abis.length, 'Expected one APK per ABI');
const signer = join(sdk || '', 'build-tools', '36.0.0', 'lib', 'apksigner.jar');
assert.ok(existsSync(signer), 'Android Build Tools 36.0.0 are required for signature verification');
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
let certificate;
const outputs = [];
for (const abi of abis) {
  const entry = metadata.elements.find(item => item.filters.length === 1 && item.filters[0].filterType === 'ABI' && item.filters[0].value === abi);
  assert.ok(entry, `Missing split ${abi}`); assert.equal(entry.versionName, version);
  assert.equal(entry.outputFile, basename(entry.outputFile));
  const built = join(directory, entry.outputFile); verifyAndroid(built, abi);
  const verified = spawnSync(java, ['-jar', signer, 'verify', '--verbose', '--print-certs', built], { encoding: 'utf8' });
  if (verified.error || verified.status !== 0) throw verified.error ?? Error('APK signature verification failed: ' + verified.stdout + verified.stderr);
  const digest = /Signer #1 certificate SHA-256 digest: ([a-f0-9]+)/i.exec(verified.stdout)?.[1].toLowerCase();
  assert.ok(digest, 'No signing certificate');
  if (certificate) assert.equal(digest, certificate, 'ABI packages must use the same signing certificate');
  certificate = digest;
  if (!debug) {
    assert.ok(!/CN=(Android Debug|Rally Local Debug)/i.test(verified.stdout), 'A release APK cannot use the debug certificate');
    if (process.env.ANDROID_CERT_SHA256) assert.equal(digest, process.env.ANDROID_CERT_SHA256.replace(/:/g, '').toLowerCase(), 'Unexpected release signing certificate');
  }
  outputs.push({ built, apk: `release/Rally-${version}-android-${abi}${debug ? '-debug' : ''}.apk` });
}
// Publish the set only after all three packages pass content and signature checks.
for (const { built, apk } of outputs) { copyFileSync(built, apk); rmSync(`${apk}.idsig`, { force: true }); console.log(apk); }
console.log(`Verified ${debug ? 'debug' : 'release'} certificate SHA-256: ${certificate}`);
