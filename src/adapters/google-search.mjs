/**
 * Google Search adapter: mo SERP US/English, xu ly consent,
 * nhan dien CAPTCHA/login, dieu huong Page 1 / Page 2 bang URL.
 */
import { ManualActionRequired, AppError } from '../core/errors.mjs';
import { firstVisible, clickFirstVisible } from '../browser/locator.mjs';
import { toRegExp } from '../core/text.mjs';

/**
 * Dung URL SERP chuan (dac ta Step 1 / Step 7).
 * @param {{domain?:string, keyword:string, language?:string, country?:string, personalization?:boolean, num?:number, start?:number, udm?:number}} args
 */
export function buildSearchUrl(args) {
  const domain = args.domain || 'www.google.com';
  const scheme = args.scheme || 'https';
  const params = [
    `q=${encodeURIComponent(args.keyword ?? '')}`,
    `hl=${args.language || 'en'}`,
    `gl=${args.country || 'us'}`,
    `pws=${args.personalization ? 1 : 0}`,
    `num=${args.num ?? 10}`,
    `start=${args.start ?? 0}`,
  ];
  if (args.udm != null) params.push(`udm=${args.udm}`);
  return `${scheme}://${domain}/search?${params.join('&')}`;
}

/** Origin dung de cap quyen (clipboard...) cho dung phien lam viec. */
export function searchOrigin(config) {
  const scheme = config?.search?.scheme || 'https';
  return `${scheme}://${config?.search?.domain ?? 'www.google.com'}`;
}

/** Doc gia tri mot query param tu URL. */
export function readParam(url, name) {
  try {
    return new URL(url).searchParams.get(name);
  } catch {
    return null;
  }
}

/**
 * Nhan dien trang thai trang hien tai.
 * @returns {Promise<'results'|'consent'|'captcha'|'login'|'unknown'>}
 */
export async function detectPageState(page, selectors) {
  const url = page.url();
  const block = selectors.google_block_state ?? {};
  const consent = selectors.google_consent ?? {};

  const hasUrlMarker = (markers) => (markers ?? []).some((m) => url.includes(m));
  if (hasUrlMarker(block.captcha_url_markers)) return 'captcha';
  if (hasUrlMarker(block.login_url_markers)) return 'login';
  if (hasUrlMarker(consent.detect_url)) return 'consent';

  let bodyText = '';
  try {
    bodyText = (await page.locator('body').innerText({ timeout: 5000 })).slice(0, 4000);
  } catch {
    return 'unknown';
  }

  const matchesAnyText = (markers) =>
    (markers ?? []).some((m) => {
      const re = toRegExp(m);
      return re ? re.test(bodyText) : false;
    });

  if (matchesAnyText(block.captcha_text_markers)) return 'captcha';
  if (matchesAnyText(block.login_text_markers)) return 'login';

  const ready = await firstVisible(page, selectors.google_results?.ready_markers, { perSpec: 1200 });
  if (ready) return 'results';
  return 'unknown';
}

/** Xu ly trang consent bang text/role selector, khong click toa do. */
export async function handleConsent(page, selectors, logger) {
  const clicked = await clickFirstVisible(page, selectors.google_consent?.accept_buttons, {
    logger, block: 'google_consent', perSpec: 2000,
  });
  if (clicked) {
    logger?.info('Da xu ly trang consent cua Google.');
    await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
  }
  return clicked;
}

/**
 * Mo mot trang SERP va dam bao trang thai la 'results'.
 * Nem ManualActionRequired khi gap CAPTCHA/login (khong bao gio tu bypass).
 */
export async function openSerp(page, url, ctx) {
  const { config, selectors, logger } = ctx;
  logger?.info(`Mo SERP: ${url}`);
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: config.search.page_timeout_ms ?? 45000,
  });

  let state = await detectPageState(page, selectors);
  if (state === 'consent') {
    await handleConsent(page, selectors, logger);
    state = await detectPageState(page, selectors);
  }

  if (state === 'captcha') {
    await logger?.screenshot(page, 'captcha');
    throw new ManualActionRequired(
      'MANUAL_CAPTCHA_REQUIRED',
      'Google yeu cau xac minh (CAPTCHA). Tool KHONG tu vuot. ' +
      'Hay xu ly trong cua so Chrome dang mo roi tiep tuc.',
      { url: page.url() },
    );
  }
  if (state === 'login') {
    await logger?.screenshot(page, 'login');
    throw new ManualActionRequired(
      'MANUAL_LOGIN_REQUIRED',
      'Google yeu cau dang nhap. Hay dang nhap trong cua so Chrome dang mo roi tiep tuc.',
      { url: page.url() },
    );
  }
  if (state !== 'results') {
    await logger?.screenshot(page, 'serp-unknown-state');
    throw new AppError(
      'SERP_NAVIGATION_FAILED',
      'Khong nhan dien duoc vung ket qua Google tren trang vua mo.',
      { details: { url: page.url() }, retryable: true },
    );
  }
  return state;
}

/**
 * Kiem tra URL hien tai dung thi truong/trang mong doi (Step 1 va Step 7).
 * @returns {{ok:boolean, mismatches:string[]}}
 */
export function verifySerpUrl(url, expected) {
  const mismatches = [];
  for (const [key, want] of Object.entries(expected)) {
    const actual = readParam(url, key);
    if (String(actual) !== String(want)) mismatches.push(`${key}=${actual ?? 'null'} (mong doi ${want})`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Cho vung ket qua on dinh truoc khi trich xuat. */
export async function waitForResults(page, selectors, timeout = 15000) {
  const found = await firstVisible(page, selectors.google_results?.ready_markers, {
    timeout, perSpec: Math.min(timeout, 4000),
  });
  return Boolean(found);
}
