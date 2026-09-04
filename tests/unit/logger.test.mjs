import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../../src/core/logger.mjs';

test('logger: redact token trong query string va nested object', () => {
  const url = 'http://127.0.0.1:1234/pair?token=secret123&next=1';
  assert.equal(redact(url), 'http://127.0.0.1:1234/pair?token=[redacted]&next=1');
  assert.equal(redact({ message: `Mo ${url}`, token: 'raw' }).message.includes('secret123'), false);
  assert.equal(redact({ token: 'raw' }).token, '[redacted]');
});
