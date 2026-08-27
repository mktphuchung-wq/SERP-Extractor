/**
 * Ahrefs SEO Toolbar adapter: xac nhan thi truong US, lay Keywords Ideas va PAA.
 *
 * Quy tac bat buoc (dac ta muc 19.5): KHONG duoc thay Keywords Ideas bang nguon
 * khac ma khong ghi nhan; mac dinh allow_keyword_ideas_fallback = false.
 */
import { firstVisible, clickFirstVisible } from '../browser/locator.mjs';
import { runExtractor } from '../browser/page-eval.mjs';
import { extractAhrefsList, readAhrefsCountry, parseCopiedList } from '../extractors/ahrefs-dom.mjs';
import { normalizeList } from '../core/text.mjs';
import { WARNING_CODES } from '../core/errors.mjs';
import { sleep } from '../core/retry.mjs';
import { NO_LOCK } from '../core/mutex.mjs';

const PANEL_SELECTOR = '[role="tabpanel"]';

/** Cho widget Ahrefs xuat hien tren SERP. */
export async function waitForWidget(page, selectors, timeoutMs, logger) {
  const found = await firstVisible(page, selectors.ahrefs_widget?.container, {
    timeout: timeoutMs, perSpec: Math.min(timeoutMs, 4000), logger, block: 'ahrefs_widget.container',
  });
  return Boolean(found);
}

/** Doc va (neu can) doi country cua toolbar sang United States. */
export async function verifyUsMarket(page, selectors, logger) {
  const sel = selectors.ahrefs_widget ?? {};
  const state = await runExtractor(page, readAhrefsCountry, {
    options: {
      containerSelectors: cssSpecs(sel.container),
      controlSelectors: cssSpecs(sel.country_control),
      usMarkers: sel.country_us_markers ?? ['(?i)united states'],
    },
  });

  if (!state?.found) {
    logger?.warn(
      'Khong doc duoc trang thai country cua Ahrefs Toolbar. Van dung gl=us&hl=en&pws=0.',
      { code: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED },
    );
    return { verified: false, warning: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED, text: '' };
  }
  if (state.isUS) {
    logger?.info(`Ahrefs Toolbar dang o thi truong: ${state.text}`);
    return { verified: true, text: state.text };
  }

  logger?.info(`Ahrefs Toolbar dang o "${state.text}", thu doi sang United States.`);
  const clicked = await clickFirstVisible(page, sel.country_control, {
    logger, block: 'ahrefs_widget.country_control', perSpec: 2000,
  });
  if (clicked) {
    await sleep(1500);
    const after = await runExtractor(page, readAhrefsCountry, {
      options: {
        containerSelectors: cssSpecs(sel.container),
        controlSelectors: cssSpecs(sel.country_control),
        usMarkers: sel.country_us_markers ?? ['(?i)united states'],
      },
    });
    if (after?.isUS) return { verified: true, text: after.text };
  }

  logger?.warn(
    'Khong doi duoc Ahrefs Toolbar sang United States. Van dung gl=us&hl=en&pws=0.',
    { code: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED },
  );
  return { verified: false, warning: WARNING_CODES.AHREFS_REGION_NOT_VERIFIED, text: state.text };
}

/** Doi sang tab trong widget theo text/role. */
async function openTab(page, specs, logger, block) {
  const clicked = await clickFirstVisible(page, specs, { logger, block, perSpec: 2500 });
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
async function readViaClipboard(page, selectors, logger, lock = NO_LOCK) {
  // navigator.clipboard.readText() yeu cau tab dang duoc focus -> doc quyen
  return lock.run(() => readClipboardUnlocked(page, selectors, logger));
}

async function readClipboardUnlocked(page, selectors, logger) {
  const sel = selectors.ahrefs_widget ?? {};
  const clicked = await clickFirstVisible(page, sel.copy_button, {
    logger, block: 'ahrefs_widget.copy_button', perSpec: 2000,
  });
  if (!clicked) return [];
  await sleep(800);
  try {
    const text = await readClipboardText(page);
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
 * @returns {Promise<{items:string[], source:string, warnings:string[]}>}
 */
export async function collectKeywordIdeas(args) {
  const { page, config, selectors, logger } = args;
  const sel = selectors.ahrefs_widget ?? {};
  const noise = sel.ui_noise ?? [];
  const warnings = [];

  const hasWidget = await waitForWidget(page, selectors, config.extractors.ahrefs_timeout_ms ?? 15000, logger);
  if (!hasWidget) {
    logger?.warn('Khong tim thay widget Ahrefs tren SERP.', { code: WARNING_CODES.AHREFS_WIDGET_NOT_FOUND });
    return { items: [], source: 'none', warnings: [WARNING_CODES.AHREFS_WIDGET_NOT_FOUND, WARNING_CODES.AHREFS_KEYWORD_IDEAS_UNAVAILABLE] };
  }

  await openTab(page, sel.tabs?.keywords_ideas, logger, 'ahrefs_widget.tabs.keywords_ideas');

  let source = 'ahrefs_widget_dom';
  let raw = (await readList(page, selectors, noise, logger)).items;

  if (!raw.length) {
    logger?.info('DOM widget khong doc duoc Keywords Ideas, thu nut Copy + clipboard.');
    raw = await readViaClipboard(page, selectors, logger, args.lock);
    if (raw.length) source = 'ahrefs_widget_clipboard';
  }

  const items = normalizeList(raw, { noise, minLength: 2 });
  if (!items.length) {
    logger?.warn(
      'Ahrefs khong tra ve Keywords Ideas. Khong dung nguon khac de thay the.',
      { code: WARNING_CODES.AHREFS_KEYWORD_IDEAS_UNAVAILABLE },
    );
    warnings.push(WARNING_CODES.AHREFS_KEYWORD_IDEAS_UNAVAILABLE);
    return { items: [], source: 'none', warnings };
  }

  logger?.info(`Keywords Ideas: ${items.length} muc (nguon ${source}).`);
  return { items, source, warnings };
}

/**
 * People also ask tu tab Ahrefs (nguon uu tien 1 o Step 4).
 */
export async function collectPaaFromAhrefs(args) {
  const { page, config, selectors, logger } = args;
  const sel = selectors.ahrefs_widget ?? {};
  const noise = sel.ui_noise ?? [];

  const hasWidget = await waitForWidget(page, selectors, config.extractors.ahrefs_timeout_ms ?? 15000, logger);
  if (!hasWidget) return { items: [], source: 'none', warnings: [WARNING_CODES.AHREFS_WIDGET_NOT_FOUND] };

  const opened = await openTab(page, sel.tabs?.people_also_ask, logger, 'ahrefs_widget.tabs.people_also_ask');
  if (!opened) return { items: [], source: 'none', warnings: [WARNING_CODES.AHREFS_PAA_UNAVAILABLE] };

  let raw = (await readList(page, selectors, noise, logger)).items;
  let source = 'ahrefs_widget_dom';
  if (!raw.length) {
    raw = await readViaClipboard(page, selectors, logger, args.lock);
    if (raw.length) source = 'ahrefs_widget_clipboard';
  }

  const items = normalizeList(raw, { noise, minLength: 5 });
  if (!items.length) return { items: [], source: 'none', warnings: [WARNING_CODES.AHREFS_PAA_UNAVAILABLE] };

  logger?.info(`PAA tu Ahrefs: ${items.length} cau hoi.`);
  return { items, source, warnings: [] };
}

/** Lay danh sach css tu cac spec (extractor chi hieu CSS selector). */
function cssSpecs(specs) {
  return (specs ?? []).filter((s) => s && s.type === 'css' && s.css).map((s) => s.css);
}

export const _internals = { cssSpecs, readList, readViaClipboard, readClipboardText };
