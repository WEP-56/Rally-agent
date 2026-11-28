import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SecretRedactor } from '../src/main/secret-redactor.ts';

test('secret output is masked across every chunk boundary, encodings and independent streams', () => {
  const secret = 'token-中文 "\\ +/?%';
  const redactor = new SecretRedactor();
  redactor.add([secret]);
  for (const value of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), Buffer.from(secret).toString('base64')]) {
    const text = `before ${value} after`;
    for (let split = 0; split <= text.length; split++) {
      let result = '';
      const stream = redactor.stream(chunk => { result += chunk; });
      stream.write(text.slice(0, split)); stream.write(text.slice(split)); stream.end();
      assert.equal(result, 'before [REDACTED] after');
    }
  }
  let stdout = '', stderr = '';
  const out = redactor.stream(text => { stdout += text; }), err = redactor.stream(text => { stderr += text; });
  out.write(secret.slice(0, 5)); err.write(secret); out.write(secret.slice(5)); out.end(); err.end();
  assert.equal(stdout, '[REDACTED]'); assert.equal(stderr, '[REDACTED]');
});

test('normal progress is emitted immediately and secret-like prefixes flush at EOF', () => {
  const redactor = new SecretRedactor(); redactor.add(['token-abcdef']);
  let result = '';
  const stream = redactor.stream(text => { result += text; });
  stream.write('READY\n'); assert.equal(result, 'READY\n');
  stream.write('to'); assert.equal(result, 'READY\n');
  stream.end(); assert.equal(result, 'READY\nto');
});
