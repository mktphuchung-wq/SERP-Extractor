import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ManualActionRequired } from '../../src/core/errors.mjs';
import { isRetryable, withRetry } from '../../src/core/retry.mjs';

test('retry: AppError chi retry khi khai bao retryable', () => {
  assert.equal(isRetryable(new AppError('OUTPUT_WRITE_FAILED', 'disk')), false);
  assert.equal(isRetryable(new AppError('SERP_NAVIGATION_FAILED', 'nav', { retryable: true })), true);
  assert.equal(isRetryable(new ManualActionRequired('MANUAL_LOGIN_REQUIRED', 'login')), false);
  assert.equal(isRetryable(new Error('transient runtime error')), true);
});

test('retry: khong lap lai AppError co side effect neu khong opt-in', async () => {
  let attempts = 0;
  await assert.rejects(() => withRetry('submit', async () => {
    attempts += 1;
    throw new AppError('AI_PROMPT_SUBMIT_FAILED', 'failed');
  }, { retries: 2, backoff: [0] }));
  assert.equal(attempts, 1);
});
