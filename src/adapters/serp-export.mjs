/**
 * SERP CSV adapter: native Google DOM la nguon production duy nhat.
 *
 * Nhanh popup/download cua SEO SERP Extraction Tool da bi loai bo vi khong the
 * kich hoat on dinh tu automation, cham, va tao schema CSV khong nhat quan.
 */
import { runExtractor } from '../browser/page-eval.mjs';
import { extractOrganicResults } from '../extractors/native-serp.mjs';
import { rowsToCsv } from '../extractors/csv-normalizer.mjs';
import { WARNING_CODES, AppError } from '../core/errors.mjs';

/** @returns {Promise<{csvText:string, source:string, rowCount:number, warnings:string[]}>} */
export async function collectSerpCsv(args) {
  return tryNativeExtract(args);
}

/** Native DOM extractor - schema canonical, khong phu thuoc extension/download. */
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
    logger?.warn(`Khong lay duoc ket qua organic nao o page ${sourcePage}.`, {
      code: WARNING_CODES.SERP_EMPTY_PAGE,
    });
    warnings.push(WARNING_CODES.SERP_EMPTY_PAGE);
    return { csvText: rowsToCsv([]), source: 'native_serp_dom', rowCount: 0, warnings };
  }

  logger?.info(`SERP Page ${sourcePage}: ${rows.length} ket qua organic.`);
  return { csvText: rowsToCsv(rows), source: 'native_serp_dom', rowCount: rows.length, warnings };
}

/** Page 2 tiep sau so dong that cua Page 1 khi Google bo qua num=10. */
export function nextPagePositionOffset(page1Rows, resultsPerPage) {
  const num = Number(resultsPerPage) > 0 ? Number(resultsPerPage) : 10;
  const rows = Number(page1Rows) > 0 ? Number(page1Rows) : 0;
  return Math.max(num, rows);
}

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
