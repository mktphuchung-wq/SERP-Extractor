/**
 * Ahrefs SEO Toolbar adapter: xac nhan thi truong US, lay Keywords Ideas va PAA.
 *
 * Quy tac bat buoc (dac ta muc 19.5): KHONG duoc thay Keywords Ideas bang nguon
 * khac ma khong ghi nhan; mac dinh allow_keyword_ideas_fallback = false.
 *
 * SUA 2026-08-27 (Fast Path v1 - P0/P1):
 *   Widget duoc resolve DUNG MOT LAN roi dung chung cho Keywords Ideas, PAA va
 *   country. Truoc day moi buoc lai duyet lai ca danh sach selector tu dau:
 *   Keywords Ideas mat 23,1 giay, PAA lap lai het 23,2 giay nua - 23,7% tong
 *   thoi gian run 20260827-171404 chi de tim di tim lai cung mot khoi DOM.
 */
import { firstVisible, clickFirstVisible } from '../browser/locator.mjs';
import { runExtractor, runExtractorOnLocator } from '../browser/page-eval.mjs';
import {
  extractAhrefsList, readAhrefsCountry, readCountryFromWidget, parseCopiedList,
} from '../extractors/ahrefs-dom.mjs';
import { normalizeList } from '../core/text.mjs';
import { WARNING_CODES } from '../core/errors.mjs';
import { sleep } from '../core/retry.mjs';
import { NO_LOCK } from '../core/mutex.mjs';

const PANEL_SELECTOR = '[role="tabpanel"]';

/**
 * Resolve widget Ahrefs MOT LAN cho ca run va giu lai trong `cache`.
 *
 * `cache` la mot object thuong (state.ahrefs trong orchestrator). Locator duoc
 * kiem tra con song truoc khi tai su dung: sau khi dieu huong trang, node cu
 * khong con nen phai resolve lai.
 *
 * @param {{page:object, selectors:object, config?:object, logger?:object, memory?:object, cache?:object, timeoutMs?:number}} args
 * @returns {Promise<object|null>} locator cua widget
 */
export async function resolveWidget(args) {
  const { page, selectors, logger, memory } = args;
  const cache = args.cache ?? null;
  const timeoutMs = args.timeoutMs
    ?? args.config?.extractors?.ahrefs_timeout_ms
    ?? 8000;

  if (cache?.widget) {
    const alive = await isAlive(cache.widget);
    if (alive) {
      logger?.debug('Dung lai widget Ahrefs da resolve o buoc truoc.');
      return cache.widget;
    }
    cache.widget = null;
  }

  const found = await firstVisible(page, selectors.ahrefs_widget?.container, {
    timeout: timeoutMs,
    perSpec: Math.min(timeoutMs, 2500),
    logger,
    memory,
    block: 'ahrefs_widget.container',
  });
  if (!found) return null;
  if (cache) {
    cache.widget = found.locator;
    cache.spec = found.spec;
  }
  return found.locator;
}

/** Locator con tro toi node dang hien tren trang khong? */
async function isAlive(locator) {
  try {
    return (await locator.count()) > 0 && (await locator.isVisible?.() ?? true);
  } catch {
    return false;
  }
}

/** Cho widget Ahrefs xuat hien tren SERP. */
export async function waitForWidget(page, selectors, timeoutMs, logger, opts = {}) {
  const widget = await resolveWidget({
    page, selectors, logger, timeoutMs, memory: opts.memory, cache: opts.cache,
  });
  return Boolean(widget);
}

/**
 * Doc va (neu can) doi country cua toolbar sang United States.
 *
 * Chi duoc goi SAU khi widget da san sang (dac ta Fast Path v1 - P1). Widget
 * chua san sang thi tra ve `ready:false` va KHONG phat canh bao: truoc day ham
 * nay chay ngay sau khi mo SERP, luc widget chua render, nen
 * AHREFS_REGION_NOT_VERIFIED gan nhu tat yeu.
 *
 * @param {object} page
 * @param {object} selectors
 * @param {object} logger
 * @param {{widget?:object}} [opts] container da resolve
 */
export async function verifyUsMarket(page, selectors, logger, opts = {}) {
  const sel = selectors.ahrefs_widget ?? {};
  const widget = opts.widget ?? null;

  if (!widget) {
    logger?.debug('Chua co widget Ahrefs de doc country; bo qua kiem tra thi truong.');
    return { verified: false, ready: false, text: '', market: 'unknown' };
  }

  const state = await readCountry(page, widget, sel);

  if (!state?.found) {
    logger?.warn(
      'Widget Ahrefs da san sang nhung khong doc duoc country. Van dung gl=us&hl=en&pws=0.',
      { code: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED },
    );
    return {
      verified: false, ready: true, warning: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED,
      text: '', market: 'unknown',
    };
  }
  if (state.isUS) {
    logger?.info(`Ahrefs Toolbar dang o thi truong: ${state.text} (doc bang ${state.via}).`);
    return { verified: true, ready: true, text: state.text, market: 'us' };
  }

  logger?.info(`Ahrefs Toolbar dang o "${state.text}", thu doi sang United States.`);
  const clicked = await clickFirstVisible(widget, sel.country_control, {
    logger, block: 'ahrefs_widget.country_control', perSpec: 2000, timeout: 4000,
  });
  if (clicked) {
    await sleep(1500);
    const after = await readCountry(page, widget, sel);
    if (after?.isUS) return { verified: true, ready: true, text: after.text, market: 'us' };
  }

  logger?.warn(
    'Khong doi duoc Ahrefs Toolbar sang United States. Van dung gl=us&hl=en&pws=0.',
    { code: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED, current: state.text },
  );
  return {
    verified: false, ready: true, warning: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED,
    text: state.text, market: normalizeMarket(state.text),
  };
}

/**
 * Doc country trong DUNG widget da resolve; chi khi khong doc duoc moi quay ve
 * duong cu (tim container bang CSS tren toan document).
 */
async function readCountry(page, widget, sel) {
  const options = {
    controlSelectors: cssSpecs(sel.country_control),
    usMarkers: sel.country_us_markers ?? ['(?i)united states'],
  };
  try {
    const inWidget = await runExtractorOnLocator(widget, readCountryFromWidget, options);
    if (inWidget?.found) return inWidget;
  } catch { /* thu duong con lai */ }

  return runExtractor(page, readAhrefsCountry, {
    options: {
      containerSelectors: cssSpecs(sel.container),
      controlSelectors: options.controlSelectors,
      usMarkers: options.usMarkers,
    },
  }).catch(() => null);
}

/** Chuoi country -> ma thi truong ngan gon cho log/manifest. */
function normalizeMarket(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value) return 'unknown';
  if (/united states|\bus\b|\busa\b/.test(value)) return 'us';
  return value.slice(0, 40);
}

/** Doi sang tab trong widget theo text/role - tim TRONG widget da resolve. */
async function openTab(scope, specs, logger, block, memory) {
  const clicked = await clickFirstVisible(scope, specs, {
    logger, block, perSpec: 2000, timeout: 5000, memory,
  });
  if (clicked) await sleep(1200);
  return clicked;
}

/** Doc danh sach hien tai trong widget (tab dang mo). */
async function readList(page, selectors, noise, logger) {
  const sel = selectors.ahrefs_widget ?? {};
  const result = await runExtractor(page, extractAhrefsList, {
    options: {
      containerSelectors: cssSpecs(sel.container),
      panelSelector: PANEL_SELECTOR,
      rowSelectors: cssSpecs(sel.rows),
      noise,
      maxItems: 100,
    },
  });
  logger?.debug('Ahrefs DOM rows', { rowCount: result?.rowCount ?? 0, items: result?.items?.length ?? 0 });
  return result ?? { found: false, items: [], rowCount: 0 };
}

/** Doc qua nut Copy + clipboard khi DOM khong doc duoc (shadow root dong...). */
async function readViaClipboard(scope, selectors, logger, lock = NO_LOCK) {
  // navigator.clipboard.readText() yeu cau tab dang duoc focus -> doc quyen
  return lock.run(() => readClipboardUnlocked(scope, selectors, logger));
}

async function readClipboardUnlocked(scope, selectors, logger) {
  const sel = selectors.ahrefs_widget ?? {};
  const clicked = await clickFirstVisible(scope.widget ?? scope.page, sel.copy_button, {
    logger, block: 'ahrefs_widget.copy_button', perSpec: 2000, timeout: 4000,
  });
  if (!clicked) return [];
  await sleep(800);
  try {
    const text = await readClipboardText(scope.page);
    const items = parseCopiedList(text);
    if (items.length) logger?.info(`Doc duoc ${items.length} dong tu clipboard cua Ahrefs.`);
    return items;
  } catch (err) {
    logger?.debug(`Khong doc duoc clipboard: ${err.message}`);
    return [];
  }
}

/** Uu tien quyen clipboardRead cua bridge; Playwright moi dung page context. */
async function readClipboardText(page) {
  if (typeof page.readClipboardText === 'function') {
    const text = await page.readClipboardText().catch(() => '');
    if (text) return text;
  }
  return page.evaluate(async () => {
    if (!navigator.clipboard?.readText) return '';
    return navigator.clipboard.readText();
  });
}

/**
 * Keywords Ideas (dac ta Step 3).
 * @returns {Promise<{items:string[], source:string, warnings:string[], widget:object|null}>}
 */
export async function collectKeywordIdeas(args) {
  const { page, config, selectors, logger } = args;
  const sel = selectors.ahrefs_widget ?? {};
  const noise = sel.ui_noise ?? [];
  const warnings = [];

  const widget = await resolveWidget({
    page, selectors, config, logger, memory: args.memory, cache: args.cache,
  });
  if (!widget) {
    logger?.warn('Khong tim thay widget Ahrefs tren SERP.', { code: WARNING_CODES.AHREFS_WIDGET_NOT_FOUND });
    return {
      items: [],
      source: 'none',
      widget: null,
      warnings: [WARNING_CODES.AHREFS_WIDGET_NOT_FOUND, WARNING_CODES.AHREFS_KEYWORD_IDEAS_UNAVAILABLE],
    };
  }

  await openTab(widget, sel.tabs?.keywords_ideas, logger, 'ahrefs_widget.tabs.keywords_ideas', args.memory);

  let source = 'ahrefs_widget_dom';
  let raw = (await readList(page, selectors, noise, logger)).items;

  if (!raw.length) {
    logger?.info('DOM widget khong doc duoc Keywords Ideas, thu nut Copy + clipboard.');
    raw = await readViaClipboard({ page, widget }, selectors, logger, args.lock);
    if (raw.length) source = 'ahrefs_widget_clipboard';
  }

  const items = normalizeList(raw, { noise, minLength: 2 });
  if (!items.length) {
    logger?.warn(
      'Ahrefs khong tra ve Keywords Ideas. Khong dung nguon khac de thay the.',
      { code: WARNING_CODES.AHREFS_KEYWORD_IDEAS_UNAVAILABLE },
    );
    warnings.push(WARNING_CODES.AHREFS_KEYWORD_IDEAS_UNAVAILABLE);
    return { items: [], source: 'none', widget, warnings };
  }

  logger?.info(`Keywords Ideas: ${items.length} muc (nguon ${source}).`);
  return { items, source, widget, warnings };
}

/**
 * People also ask tu tab Ahrefs (nguon uu tien 1 o Step 4).
 */
export async function collectPaaFromAhrefs(args) {
  const { page, config, selectors, logger } = args;
  const sel = selectors.ahrefs_widget ?? {};
  const noise = sel.ui_noise ?? [];

  const widget = await resolveWidget({
    page, selectors, config, logger, memory: args.memory, cache: args.cache,
  });
  if (!widget) return { items: [], source: 'none', widget: null, warnings: [WARNING_CODES.AHREFS_WIDGET_NOT_FOUND] };

  const opened = await openTab(widget, sel.tabs?.people_also_ask, logger, 'ahrefs_widget.tabs.people_also_ask', args.memory);
  if (!opened) return { items: [], source: 'none', widget, warnings: [WARNING_CODES.AHREFS_PAA_UNAVAILABLE] };

  let raw = (await readList(page, selectors, noise, logger)).items;
  let source = 'ahrefs_widget_dom';
  if (!raw.length) {
    raw = await readViaClipboard({ page, widget }, selectors, logger, args.lock);
    if (raw.length) source = 'ahrefs_widget_clipboard';
  }

  const items = normalizeList(raw, { noise, minLength: 5 });
  if (!items.length) return { items: [], source: 'none', widget, warnings: [WARNING_CODES.AHREFS_PAA_UNAVAILABLE] };

  logger?.info(`PAA tu Ahrefs: ${items.length} cau hoi.`);
  return { items, source, widget, warnings: [] };
}

/** Lay danh sach css tu cac spec (extractor chi hieu CSS selector). */
function cssSpecs(specs) {
  return (specs ?? []).filter((s) => s && s.type === 'css' && s.css).map((s) => s.css);
}

export const _internals = {
  cssSpecs, readList, readViaClipboard, readClipboardText, readCountry, normalizeMarket, isAlive,
};
