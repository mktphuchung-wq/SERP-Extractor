/**
 * Retry theo step (dac ta muc 13.2): toi da 2 retry, backoff 2s/5s,
 * khong retry loi thu cong (CAPTCHA/login), moi lan retry co cleanup.
 */
import { AppError, ManualActionRequired } from './errors.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isRetryable(error) {
  if (error instanceof ManualActionRequired) return false;
  // AppError phai tu khai bao transient. Mac dinh retry moi AppError co the
  // lap lai thao tac UI co side effect (submit/copy) hoac cho vo ich.
  if (error instanceof AppError) return error.retryable === true;
  // Loi he thong/Playwright khong duoc phan loai van co the la transient.
  return true;
}

/**
 * @template T
 * @param {string} name ten step (dung cho log)
 * @param {(attempt:number)=>Promise<T>} fn
 * @param {{retries?:number, backoff?:number[], logger?:object, cleanup?:(attempt:number)=>Promise<void>, onError?:(err:Error, attempt:number)=>Promise<void>}} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(name, fn, opts = {}) {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoff ?? [2000, 5000];
  const logger = opts.logger;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      if (attempt > 0) logger?.info(`Thu lai step "${name}" (lan ${attempt}/${retries})`);
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (opts.onError) await opts.onError(err, attempt).catch(() => {});
      if (!isRetryable(err) || attempt === retries) break;
      const wait = backoff[Math.min(attempt, backoff.length - 1)];
      logger?.warn(`Step "${name}" loi: ${err.message}. Cho ${wait}ms roi thu lai.`, {
        code: 'STEP_RETRY', step: name, attempt,
      });
      if (opts.cleanup) await opts.cleanup(attempt).catch(() => {});
      await sleep(wait);
    }
  }
  throw lastError;
}

/**
 * Chay fn nhung khong lam vo run: tra ve {ok, value, error}.
 * Dung cho cac block "co warning van tiep tuc" (AI, Ahrefs, Suggestions).
 */
export async function softly(name, fn, logger) {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    logger?.warn(`Step "${name}" that bai, tiep tuc voi canh bao: ${err.message}`, {
      code: err instanceof AppError ? err.code : 'STEP_SOFT_FAIL',
      step: name,
    });
    return { ok: false, error: err };
  }
}

/** Delay ngau nhien giua cac thao tac de giam hanh vi giong bot (muc 18). */
export async function humanDelay(config, logger) {
  const min = config?.search?.min_delay_ms ?? 1500;
  const max = config?.search?.max_delay_ms ?? 3000;
  const ms = Math.round(min + Math.random() * Math.max(0, max - min));
  logger?.debug(`Cho ${ms}ms truoc thao tac tiep theo`);
  await sleep(ms);
  return ms;
}

/**
 * Cho toi khi predicate tra ve gia tri truthy hoac het timeout.
 * @template T
 * @param {()=>Promise<T>} probe
 * @param {{timeout:number, interval?:number, description?:string}} opts
 */
export async function waitFor(probe, opts) {
  const interval = opts.interval ?? 500;
  const deadline = Date.now() + opts.timeout;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(interval);
  }
  return last ?? null;
}
