import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { verifyAndroid } from './verify-android.mjs';

const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const debug = process.argv.includes('--debug');
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
const args = [debug ? 'assembleDebug' : 'assembleRelease', '--no-daemon', ...process.argv.filter(arg => arg === '--write-locks' || arg.startsWith('--write-verification-metadata'))];
if (process.platform === 'win32') run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', ...args], { cwd: resolve('android') });
else run('sh', ['gradlew', ...args], { cwd: resolve('android') });
const variant = debug ? 'debug' : 'release';
const built = resolve(`android/build/outputs/apk/${variant}/RallyAndroid-${variant}.apk`);
verifyAndroid(built);
const apk = `release/Rally-${version}-android${debug ? '-debug' : ''}.apk`;
copyFileSync(built, apk);
rmSync(`${apk}.idsig`, { force: true }); // A previous incremental signature must not accompany a new APK.
console.log(apk);
