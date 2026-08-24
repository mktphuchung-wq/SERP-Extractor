/**
 * Ket noi Playwright vao Chrome dang chay qua CDP va quan ly tab.
 */
import path from 'node:path';
import { chromium } from 'playwright-core';
import { AppError } from '../core/errors.mjs';

/**
 * @param {{port:number, logger?:object, timeout?:number, attempts?:number}} opts
 */
export async function connectCdp(opts) {
  const url = `http://127.0.0.1:${opts.port}`;
  const timeout = opts.timeout ?? 30000;
  // Lan dau Chrome mo mot profile bang phien ban khac (vi du doi tu Chrome he thong
  // sang Chrome for Testing), no phai nang cap profile truoc khi phuc vu CDP. Buoc do
  // co the vuot qua timeout mac dinh dung MOT lan, nen thu lai thay vi bao loi ngay.
  const attempts = opts.attempts ?? 2;

  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const browser = await chromium.connectOverCDP(url, { timeout });
      opts.logger?.info(`Da ket noi CDP: ${url}`);
      return browser;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        opts.logger?.warn(
          `Chua ket noi duoc CDP (lan ${attempt}/${attempts}), Chrome co the dang nang cap profile. Thu lai...`,
          { code: 'CDP_RETRY', url },
        );
        await new Promise((resolve) => { setTimeout(resolve, 3000); });
      }
    }
  }

  throw new AppError(
    'CDP_CONNECT_FAILED',
    `Khong ket noi duoc toi Chrome qua CDP (${url}) sau ${attempts} lan: ${lastErr.message}`,
    { cause: lastErr },
  );
}

/** Lay context dau tien (context cua profile that). */
export function primaryContext(browser) {
  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new AppError('CDP_CONNECT_FAILED', 'Chrome khong tra ve browser context nao.');
  }
  return contexts[0];
}

/**
 * Lay mot tab lam viec: uu tien tab trong ve about:blank, neu khong thi mo tab moi.
 */
export async function acquirePage(context, opts = {}) {
  const pages = context.pages();
  let page = pages.find((p) => {
    const url = p.url();
    return url === 'about:blank' || url === 'chrome://newtab/' || url.startsWith('chrome://new-tab');
  });
  if (!page) page = await context.newPage();
  if (opts.viewport) {
    try { await page.setViewportSize(opts.viewport); } catch { /* CDP co the tu quan ly kich thuoc */ }
  }
  await page.bringToFront().catch(() => {});
  return page;
}

/**
 * Doc duong dan profile that su cua Chrome dang attach (qua chrome://version).
 * @returns {Promise<string|null>} vi du: C:\...\AutoSerpTool\chrome-profile\Default
 */
export async function readAttachedProfilePath(context, logger) {
  let page = null;
  try {
    page = await context.newPage();
    await page.goto('chrome://version/', { waitUntil: 'domcontentloaded', timeout: 10000 });
    const value = await page.evaluate(() => {
      const el = document.querySelector('#profile_path');
      return el ? el.textContent.trim() : null;
    });
    return value || null;
  } catch (err) {
    logger?.debug(`Khong doc duoc chrome://version: ${err.message}`);
    return null;
  } finally {
    if (page && !page.isClosed()) await page.close().catch(() => {});
  }
}

/**
 * Xac minh dang lam viec dung profile automation, KHONG phai profile ca nhan.
 *
 * Can thiet khi tool attach vao mot cua so Chrome co san: neu cong debug lai
 * thuoc ve mot Chrome khac (vi du profile ca nhan), phai dung lai thay vi
 * am tham dung nham profile cua nguoi dung.
 *
 * @returns {Promise<{verified:boolean, actual:string|null, expected:string}>}
 */
export async function verifyAttachedProfile(context, expectedUserDataDir, logger) {
  const expected = path.resolve(expectedUserDataDir);
  const actual = await readAttachedProfilePath(context, logger);

  if (!actual) {
    logger?.warn(
      'Khong xac minh duoc profile cua Chrome dang attach. Van tiep tuc.',
      { code: 'PROFILE_NOT_VERIFIED', expected },
    );
    return { verified: false, actual: null, expected };
  }

  // chrome://version tra ve <user-data-dir>\<Default|Profile N>
  const actualRoot = path.resolve(path.dirname(actual));
  const matches = actualRoot.toLowerCase() === expected.toLowerCase();

  if (!matches) {
    throw new AppError(
      'PROFILE_MISMATCH',
      `Chrome dang mo tren cong debug KHONG phai profile automation.\n` +
      `  Dang dung : ${actual}\n` +
      `  Mong doi  : ${expected}\n` +
      'Tool tu choi lam viec tren profile khac (co the la profile ca nhan cua ban). ' +
      'Hay dong cua so Chrome do, hoac doi browser.remote_debugging_port sang cong khac.',
      { details: { actual, expected } },
    );
  }

  logger?.info(`Da xac minh dung profile automation: ${actual}`);
  return { verified: true, actual, expected };
}

/** Cap quyen clipboard cho origin cu the (dung cho nut Copy cua Ahrefs). */
export async function grantClipboard(context, origin, logger) {
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    return true;
  } catch (err) {
    logger?.debug(`Khong cap duoc quyen clipboard cho ${origin}: ${err.message}`);
    return false;
  }
}

/** Dong cac tab phu do tool mo ra, giu lai tab chinh. */
export async function closeExtraPages(context, keep, logger) {
  for (const page of context.pages()) {
    if (page === keep) continue;
    if (page.isClosed()) continue;
    try { await page.close(); } catch (err) { logger?.debug(`Khong dong duoc tab: ${err.message}`); }
  }
}

/** Ngat ket noi nhung KHONG dong Chrome cua nguoi dung. */
export async function disconnect(browser, logger) {
  try {
    await browser.close();
    logger?.debug('Da ngat ket noi CDP (Chrome van chay).');
  } catch (err) {
    logger?.debug(`Loi khi ngat CDP: ${err.message}`);
  }
}
