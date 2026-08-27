/**
 * Integration test chay tren Google Chrome that (headless) voi fixture file://
 *
 * Kiem chung phan KHONG the test bang linkedom:
 *   - selector registry (role/text/css) qua Playwright locator
 *   - page.evaluate voi extractor duoc ghep source (composeExtractor)
 *   - state machine AI Overview: Show more -> Paste Prompt -> Load -> Copy
 *   - bat su kien download khi bam Export CSV
 *
 * Tu dong SKIP neu may khong co Chrome hoac khong khoi dong duoc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

import { fixturePath, makeTempDir } from '../helpers/dom.mjs';
import { loadSelectors } from '../../src/core/config.mjs';
import { findChrome } from '../../src/browser/chrome-launcher.mjs';
import { firstVisible, clickFirstVisible, anyPresent } from '../../src/browser/locator.mjs';
import { runExtractor } from '../../src/browser/page-eval.mjs';
import { extractOrganicResults } from '../../src/extractors/native-serp.mjs';
import { extractSuggestionDropdown } from '../../src/extractors/suggestions-dom.mjs';
import { collectAiAnswer, AI_MISSING_NOTE } from '../../src/adapters/ai-mode.mjs';
import { nullLogger } from '../../src/core/logger.mjs';
import { parseCsv } from '../../src/extractors/csv-normalizer.mjs';

const selectors = loadSelectors();
const logger = nullLogger();

let chromePath = null;
try {
  chromePath = findChrome('auto');
} catch {
  chromePath = null;
}

const skip = chromePath ? false : 'Khong tim thay Google Chrome tren may nay';

function fixtureUrl(name) {
  return pathToFileURL(fixturePath(name)).href;
}

const AI_CONFIG = {
  ai: {
    open_overview_first: true,
    direct_ai_mode_fallback: false,
    overview_timeout_ms: 4000,
    response_timeout_ms: 15000,
    stable_ms: 1000,
    min_response_chars: 20,
    poll_interval_ms: 250,
  },
};

async function withPage(fn) {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  try {
    return await fn(page, context);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

test('browser: locator registry tim duoc AI Overview, Show more va prompt box', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('ai-overview-show-more.html'));

    const container = await firstVisible(page, selectors.ai_overview.container, { timeout: 4000 });
    assert.ok(container, 'phai tim thay container AI Overview');

    const showMore = await firstVisible(container.locator, selectors.ai_overview.show_more, { perSpec: 2000 });
    assert.ok(showMore, 'phai tim thay nut Show more');
    assert.equal(showMore.index, 0, 'phai dung selector uu tien dau tien (role)');

    const input = await firstVisible(container.locator, selectors.ai_prompt_box.input, { perSpec: 2000 });
    assert.ok(input, 'phai tim thay o nhap prompt');
  });
});

test('browser: AI Overview khong co prompt box thi khong tim thay input', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('ai-overview-no-prompt.html'));
    const container = await firstVisible(page, selectors.ai_overview.container, { timeout: 4000 });
    assert.ok(container);
    const input = await firstVisible(container.locator, selectors.ai_prompt_box.input, { perSpec: 1200 });
    assert.equal(input, null);
    const entry = await firstVisible(page, selectors.ai_overview.ai_mode_entry, { perSpec: 1500 });
    assert.ok(entry, 'phai tim thay loi vao AI Mode');
  });
});

test('browser: AI Overview thao tac Show more -> Paste Prompt -> Load -> Copy', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('ai-mode-streaming.html'));
    page.readClipboardText = () => page.evaluate(() => window.__copiedText ?? '');

    const result = await collectAiAnswer({
      page, config: AI_CONFIG, selectors, logger,
      keyword: 'Filipino vs Samoan',
      prompt: 'What are the main similarities and differences?',
    });

    assert.deepEqual(result.states, [
      'SearchLoaded', 'OverviewFound', 'Expanded', 'PromptBox', 'Submitted', 'CopyReady', 'Captured',
    ]);
    assert.equal(result.source, 'google_ai_overview_clipboard');
    assert.ok(result.markdown.includes('### Main similarities'));
    assert.ok(result.markdown.includes('**Austronesian**'));
    assert.ok(result.markdown.includes('- Related language families'));
    assert.ok(result.markdown.includes('[this study](https://source.example.com/study)'));
    assert.ok(!result.markdown.includes('What are the main similarities'), 'khong duoc lay lai prompt');
    assert.ok(result.chars > 50);
  });
});

/**
 * Hoi quy run that 2026-08-27, keyword "Scottish Girl Names".
 * Fixture dung lai hai cai bay da lam hong hai run lien tiep - xem chu thich
 * dau file tests/fixtures/ai-overview-submit-traps.html.
 */
test('browser: khong bam nham nut Search cua Google va nut Copy cua Ahrefs', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('ai-overview-submit-traps.html'));
    page.readClipboardText = () => page.evaluate(() => window.__copiedText ?? '');

    const result = await collectAiAnswer({
      page, config: AI_CONFIG, selectors, logger,
      keyword: 'Scottish Girl Names',
      prompt: 'Analyze the search intent behind this keyword.',
    });

    const clicked = await page.evaluate(() => window.__clicked);
    assert.ok(
      !clicked.includes('search-submit'),
      `khong duoc bam nut Search cua Google (da bam: ${clicked.join(', ')})`,
    );
    assert.ok(
      !clicked.includes('ahrefs-copy'),
      `khong duoc bam nut Copy cua thanh Ahrefs (da bam: ${clicked.join(', ')})`,
    );
    assert.ok(clicked.includes('send'), 'phai bam dung nut gui cua o prompt');
    assert.ok(clicked.includes('answer-copy'), 'phai bam dung nut Copy cua cau tra loi');

    assert.equal(result.source, 'google_ai_overview_clipboard');
    assert.ok(result.markdown.includes('### Scottish girl names'));
    assert.ok(
      !result.markdown.includes('What is the prettiest'),
      'khong duoc lay noi dung PAA con sot trong clipboard',
    );
    assert.deepEqual(result.warnings, []);
  });
});

test('browser: answer khong co nut Copy thi bao thieu, khong bam nut Copy cua Ahrefs', { skip }, async () => {
  await withPage(async (page) => {
    // #nocopy: prompt gui duoc nhung cau tra loi khong kem nut Copy - dung tinh
    // huong cuoi cua run 20260827-153106. Code cu roi xuong selector
    // `text=^copy$` va bam trung nut Copy cua thanh Ahrefs o cuoi trang.
    await page.goto(`${fixtureUrl('ai-overview-submit-traps.html')}#nocopy`);
    page.readClipboardText = () => page.evaluate(() => window.__copiedText ?? '');

    const result = await collectAiAnswer({
      page,
      config: { ai: { ...AI_CONFIG.ai, response_timeout_ms: 3000 } },
      selectors,
      logger,
      keyword: 'Scottish Girl Names',
      prompt: 'Analyze the search intent behind this keyword.',
    });

    const clicked = await page.evaluate(() => window.__clicked);
    assert.ok(clicked.includes('send'), 'prompt van phai duoc gui di');
    assert.ok(
      !clicked.includes('ahrefs-copy'),
      `khong duoc bam nut Copy cua thanh Ahrefs (da bam: ${clicked.join(', ')})`,
    );
    assert.ok(result.warnings.includes('AI_RESPONSE_TIMEOUT'));
    assert.equal(result.source, 'none');
    assert.ok(
      !result.markdown.includes('What is the prettiest'),
      'khong duoc lay noi dung PAA con sot trong clipboard',
    );
  });
});

test('browser: clipboard khong doi sau khi bam Copy thi bao loi, khong lay noi dung cu', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('ai-overview-submit-traps.html'));
    // Mo phong dung tinh huong run 20260827-152533: nut Copy khong ghi gi moi,
    // clipboard van giu nguyen noi dung cua buoc PAA truoc do.
    await page.evaluate(() => {
      window.__copyFrozen = window.__copiedText;
      Object.defineProperty(window, '__copiedText', {
        get: () => window.__copyFrozen,
        set: () => {},
      });
    });
    page.readClipboardText = () => page.evaluate(() => window.__copiedText ?? '');

    const result = await collectAiAnswer({
      page, config: { ai: { ...AI_CONFIG.ai, clipboard_timeout_ms: 1500 } }, selectors, logger,
      keyword: 'Scottish Girl Names',
      prompt: 'Analyze the search intent behind this keyword.',
    });

    assert.ok(result.warnings.includes('AI_COPY_STALE_CLIPBOARD'));
    assert.equal(result.source, 'none');
    assert.ok(
      !result.markdown.includes('What is the prettiest'),
      'noi dung cu cua buoc PAA khong duoc lot vao muc AI Mode',
    );
    assert.match(result.markdown, /^>/, 'phai la blockquote canh bao');
  });
});

test('browser: khong co AI Overview thi ghi canh bao, khong bia noi dung', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('serp-page2.html'));
    const result = await collectAiAnswer({
      page, config: AI_CONFIG, selectors, logger, keyword: 'x', prompt: 'y',
    });
    assert.equal(result.source, 'none');
    assert.equal(result.markdown, AI_MISSING_NOTE);
    assert.ok(result.warnings.includes('AI_OVERVIEW_NOT_FOUND'));
  });
});

test('browser: page.evaluate voi extractor ghep source cho ket qua giong linkedom', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('serp-mixed.html'));
    const rows = await runExtractor(page, extractOrganicResults, {
      options: {
        resultContainers: selectors.native_serp.result_containers,
        excludeContainers: selectors.native_serp.exclude_containers,
        excludeTextAnchors: selectors.native_serp.exclude_text_anchors,
        excludeUrlPatterns: selectors.native_serp.exclude_url_patterns,
        featuredSnippetContainers: selectors.native_serp.featured_snippet_containers,
        capturedAt: '2026-08-21T04:15:30.000Z',
        sourcePage: 1,
        startOffset: 0,
      },
    });
    assert.deepEqual(rows.map((r) => r.title), [
      'Featured Result Title', 'First Organic Result', 'Second Organic Result',
    ]);
    assert.equal(rows[0].result_type, 'featured_snippet');
  });
});

test('browser: doc suggestion dropdown qua page.evaluate', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('google-suggest-dropdown.html'));
    const result = await runExtractor(page, extractSuggestionDropdown, {
      options: {
        listboxSelectors: ['ul[role="listbox"]'],
        optionSelectors: ['li[role="presentation"]'],
        entityMarkers: selectors.google_suggestions.entity_label_markers,
        stripEntityLabels: true,
      },
    });
    assert.deepEqual(result.items, [
      'filipino vs samoan', 'filipino vs samoan culture', 'filipino vs samoan food',
    ]);
  });
});

test('browser: bam Export CSV bat duoc download va CSV parse duoc', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-download-');
  try {
    await withPage(async (page) => {
      await page.goto(fixtureUrl('extension-serp-results.html'));

      const trigger = await firstVisible(page, selectors.extension_serp_export.trigger, { perSpec: 2000 });
      assert.ok(trigger, 'phai tim thay nut Extract');

      const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
      const clicked = await clickFirstVisible(page, selectors.extension_serp_export.export_csv, {
        logger, block: 'extension_serp_export.export_csv', perSpec: 2500,
      });
      assert.equal(clicked, true, 'phai bam duoc nut Export CSV');

      const download = await downloadPromise;
      const target = path.join(tmp.dir, 'serp-page-1-extension.csv');
      await download.saveAs(target);

      const text = fs.readFileSync(target, 'utf8');
      const parsed = parseCsv(text);
      assert.equal(parsed.rowCount, 3);
      assert.deepEqual(parsed.header, ['Position', 'Title', 'URL']);
      assert.equal(parsed.records[1].Title, 'First Organic Result, with comma');
    });
  } finally {
    tmp.cleanup();
  }
});

test('browser: anyPresent nhan dien indicator dang tao noi dung', { skip }, async () => {
  await withPage(async (page) => {
    await page.goto(fixtureUrl('ai-mode-streaming.html'));
    await page.click('#showmore');
    await page.click('#showmore');
    assert.equal(await anyPresent(page, selectors.ai_prompt_box.generating_markers), false);
    await page.click('#load');
    assert.equal(await anyPresent(page, selectors.ai_prompt_box.generating_markers), true);
  });
});
