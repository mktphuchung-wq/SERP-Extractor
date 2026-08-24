/**
 * SERP CSV adapter (dac ta Step 6 va Step 7).
 * Uu tien SEO SERP Extraction Tool, bat buoc co native DOM fallback.
 *
 * Kich hoat extension bang extension adapter (mo popup page lay tu manifest),
 * TUYET DOI khong click toa do icon tren Chrome toolbar.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { firstVisible, clickFirstVisible } from '../browser/locator.mjs';
import { runExtractor } from '../browser/page-eval.mjs';
import { extractOrganicResults } from '../extractors/native-serp.mjs';
import { rowsToCsv, parseCsv, normalizeCsvText } from '../extractors/csv-normalizer.mjs';
import { WARNING_CODES, AppError } from '../core/errors.mjs';
import { sleep } from '../core/retry.mjs';
import { NO_LOCK } from '../core/mutex.mjs';

/**
 * @returns {Promise<{csvText:string, source:string, rowCount:number, warnings:string[]}>}
 */
export async function collectSerpCsv(args) {
  const { config, logger } = args;
  const mode = config.extractors.serp_source ?? 'extension_then_dom';
  const warnings = [];

  if (mode !== 'dom_only') {
    const lock = args.lock ?? NO_LOCK;
    // Luong extension phu thuoc TAB DANG ACTIVE -> phai doc quyen khi chay song song
    const viaExtension = await lock.run(() => tryExtensionExport(args)).catch((err) => {
      logger?.warn(`Extension export loi: ${err.message}`, { code: WARNING_CODES.EXTENSION_POPUP_UNUSABLE });
      return null;
    });
    if (viaExtension?.csvText) {
      const parsed = parseCsv(viaExtension.csvText);
      if (parsed.rowCount > 0) {
        logger?.info(`CSV page ${args.sourcePage} tu extension: ${parsed.rowCount} dong.`);
        const csvText = config.extractors.normalize_serp_csv
          ? normalizeCsvText(viaExtension.csvText, { sourcePage: args.sourcePage, capturedAt: args.capturedAt })
          : viaExtension.csvText;
        return { csvText, source: 'seo_serp_extension', rowCount: parsed.rowCount, warnings };
      }
      logger?.warn('File CSV tu extension khong co dong du lieu nao.', {
        code: WARNING_CODES.SERP_FALLBACK_USED,
      });
    }
    warnings.push(WARNING_CODES.SERP_FALLBACK_USED);
    logger?.info('Chuyen sang native SERP extractor.');
  }

  return tryNativeExtract(args, warnings);
}

/** Native DOM fallback - luon kha dung. */
export async function tryNativeExtract(args, warnings = []) {
  const { page, selectors, logger, sourcePage, startOffset, capturedAt } = args;
  const sel = selectors.native_serp ?? {};

  const rows = await runExtractor(page, extractOrganicResults, {
    options: {
      resultContainers: sel.result_containers ?? ['#rso', '#search'],
      excludeContainers: sel.exclude_containers ?? [],
      excludeTextAnchors: sel.exclude_text_anchors ?? [],
      excludeUrlPatterns: sel.exclude_url_patterns ?? [],
      featuredSnippetContainers: sel.featured_snippet_containers ?? [],
      startOffset: startOffset ?? 0,
      sourcePage: sourcePage ?? 1,
      capturedAt: capturedAt ?? new Date().toISOString(),
      baseUrl: page.url(),
      maxResults: 50,
    },
  });

  if (!rows || rows.length === 0) {
    await logger?.screenshot(page, `serp-empty-page-${sourcePage}`);
    logger?.warn(`Native extractor khong lay duoc ket qua organic nao o page ${sourcePage}.`, {
      code: WARNING_CODES.SERP_EMPTY_PAGE,
    });
    warnings.push(WARNING_CODES.SERP_EMPTY_PAGE);
    return { csvText: rowsToCsv([]), source: 'native_serp_dom', rowCount: 0, warnings };
  }

  logger?.info(`CSV page ${sourcePage} tu native extractor: ${rows.length} ket qua organic.`);
  return { csvText: rowsToCsv(rows), source: 'native_serp_dom', rowCount: rows.length, warnings };
}

/**
 * Kich hoat extension va bat file CSV.
 * Bat download bang hai duong: Playwright download event + theo doi thu muc Downloads.
 */
async function tryExtensionExport(args) {
  const { page, config, selectors, logger, extensions, stagingDir, sourcePage } = args;
  const meta = extensions?.serp_export;
  if (!meta?.installed) {
    logger?.warn('Chua cai "SEO SERP Extraction Tool".', {
      code: WARNING_CODES.EXTENSION_MISSING, extension: meta?.id,
    });
    return null;
  }
  const entryUrl = meta.popupUrl || meta.optionsUrl;
  if (!entryUrl) {
    logger?.warn('Extension SERP khong khai bao popup/options page trong manifest.', {
      code: WARNING_CODES.EXTENSION_POPUP_UNUSABLE,
    });
    return null;
  }

  const context = page.context();
  const sel = selectors.extension_serp_export ?? {};
  const timeout = config.extractors.extension_timeout_ms ?? 20000;
  const downloadTimeout = config.extractors.download_timeout_ms ?? 30000;
  const watchDirs = downloadDirs(config);
  const since = Date.now();

  // Giu tab Google la target dang xem truoc khi kich hoat extension
  await page.bringToFront().catch(() => {});

  const popup = await context.newPage();
  const openedPages = [];
  const onPage = (p) => openedPages.push(p);
  context.on('page', onPage);

  try {
    await popup.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout });
    await sleep(1500);

    await clickFirstVisible(popup, sel.trigger, {
      logger, block: 'extension_serp_export.trigger', perSpec: 2000,
    });
    await sleep(2000);

    // Trang ket qua co the mo o tab moi
    const resultPage = openedPages.find((p) => p !== popup && !p.isClosed()) ?? popup;
    if (resultPage !== popup) {
      await resultPage.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
    }

    const exportBtn = await firstVisible(resultPage, sel.export_csv, {
      timeout, perSpec: 2500, logger, block: 'extension_serp_export.export_csv',
    });
    if (!exportBtn) {
      logger?.warn('Khong tim thay nut Export CSV trong trang extension.', {
        code: WARNING_CODES.EXTENSION_POPUP_UNUSABLE,
      });
      return null;
    }

    const downloadPromise = resultPage
      .waitForEvent('download', { timeout: downloadTimeout })
      .catch(() => null);

    await exportBtn.locator.click({ timeout: 8000 });

    const download = await downloadPromise;
    if (download) {
      const target = path.join(stagingDir, `serp-page-${sourcePage}-extension.csv`);
      await download.saveAs(target);
      logger?.info(`Da nhan download tu extension: ${download.suggestedFilename()}`);
      return { csvText: fs.readFileSync(target, 'utf8'), savedPath: target };
    }

    // Duong 2: Chrome tu tai ve thu muc Downloads (khi CDP khong phat su kien)
    const file = await waitForNewCsv(watchDirs, since, downloadTimeout, logger);
    if (!file) {
      logger?.warn('Het thoi gian cho file CSV tu extension.', { code: 'DOWNLOAD_TIMEOUT' });
      return null;
    }
    const target = path.join(stagingDir, `serp-page-${sourcePage}-extension.csv`);
    fs.copyFileSync(file, target);
    logger?.info(`Da lay CSV tu thu muc tai ve: ${file}`);
    return { csvText: fs.readFileSync(target, 'utf8'), savedPath: target, originalPath: file };
  } finally {
    context.off('page', onPage);
    for (const p of [...openedPages, popup]) {
      if (p !== page && !p.isClosed()) await p.close().catch(() => {});
    }
    await page.bringToFront().catch(() => {});
  }
}

export function downloadDirs(config) {
  const dirs = [];
  if (config?.browser?.download_dir) dirs.push(config.browser.download_dir);
  const home = os.homedir();
  if (home) dirs.push(path.join(home, 'Downloads'));
  return dirs.filter((d) => {
    try { return fs.existsSync(d); } catch { return false; }
  });
}

/** Cho file .csv moi xuat hien va on dinh kich thuoc. */
export async function waitForNewCsv(dirs, sinceMs, timeoutMs, logger) {
  const deadline = Date.now() + timeoutMs;
  const sizes = new Map();

  while (Date.now() < deadline) {
    for (const dir of dirs) {
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch { continue; }
      for (const name of entries) {
        if (!/\.csv$/i.test(name)) continue;
        const full = path.join(dir, name);
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.mtimeMs < sinceMs - 1000) continue;
        const prev = sizes.get(full);
        if (prev !== undefined && prev === stat.size && stat.size > 0) {
          logger?.debug(`File tai ve on dinh: ${full} (${stat.size} bytes)`);
          return full;
        }
        sizes.set(full, stat.size);
      }
    }
    await sleep(700);
  }
  return null;
}

/**
 * Vi tri bat dau danh so cho Page 2.
 * Google thuong bo qua `num=10` va tra ve nhieu hon 10 ket qua o Page 1;
 * khi do phai danh so Page 2 tiep sau Page 1 de hai file khong chong lan vi tri.
 * @param {number} page1Rows so dong that su lay duoc o Page 1
 * @param {number} resultsPerPage gia tri num trong URL
 */
export function nextPagePositionOffset(page1Rows, resultsPerPage) {
  const num = Number(resultsPerPage) > 0 ? Number(resultsPerPage) : 10;
  const rows = Number(page1Rows) > 0 ? Number(page1Rows) : 0;
  return Math.max(num, rows);
}

/** Kiem tra Page 2 khong trung Page 1 (dac ta Step 7 muc 6). */
export function assertPagesDiffer(csvPage1, csvPage2, areIdentical) {
  if (areIdentical(csvPage1, csvPage2)) {
    throw new AppError(
      'SERP_PAGE_DUPLICATE',
      'CSV Page 2 trung hoan toan Page 1. Dieu huong start=10 co the that bai.',
      { retryable: true },
    );
  }
  return true;
}
