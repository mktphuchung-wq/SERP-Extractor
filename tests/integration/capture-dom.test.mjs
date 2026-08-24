/**
 * Kiem chung che do --capture-dom (dac ta v2.0 §4) tren Chrome that.
 *
 * Tai sao phai la Chrome that: linkedom KHONG mo phong shadow DOM, ma diem
 * chinh cua U2 la tra loi cau hoi "widget nam trong shadow root hay iframe".
 *
 * Tu dong SKIP neu may khong co Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

import { fixturePath, makeTempDir } from '../helpers/dom.mjs';
import { loadConfig, loadSelectors } from '../../src/core/config.mjs';
import { findChrome } from '../../src/browser/chrome-launcher.mjs';
import { captureBlock, writeSnapshot, buildCandidatesReport, createCapture } from '../../src/browser/dom-capture.mjs';
import { nullLogger } from '../../src/core/logger.mjs';

let chromePath = null;
try { chromePath = findChrome('auto'); } catch { chromePath = null; }
const skip = chromePath ? false : 'Khong tim thay Google Chrome tren may nay';

const logger = nullLogger();
const selectors = loadSelectors();
const config = loadConfig();

async function withPage(fixture, fn) {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(fixturePath(fixture)).href, { waitUntil: 'domcontentloaded' });
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

test('capture: XUYEN duoc shadow root va bao dung scopeKind', { skip }, async () => {
  await withPage('ahrefs-widget-shadow.html', async (page) => {
    const capture = await captureBlock({
      page,
      block: 'ahrefs_widget',
      selectors,
      config,
      logger,
      // Selector nay chi khop node NAM TRONG shadow root (host khong co class)
      cssSelectors: ["[class*='ahrefs' i]"],
      probeText: '(?i)keywords? ideas',
    });

    assert.equal(capture.meta.found, true, 'phai tim thay widget du no nam trong shadow root');
    assert.equal(capture.meta.scope_kind, 'shadow');
    assert.ok(capture.meta.shadow_host_path, 'phai bao duoc duong dan shadow host');
    assert.match(capture.meta.shadow_host_path, /ahrefs-host/);
  });
});

test('capture: HTML co danh dau ranh gioi shadow root', { skip }, async () => {
  await withPage('ahrefs-widget-shadow.html', async (page) => {
    const capture = await captureBlock({
      page, block: 'ahrefs_widget', selectors, config, logger,
      cssSelectors: ['#ahrefs-host'],
      probeText: '(?i)keywords? ideas',
    });
    assert.ok(capture.html.includes('<!--shadow-root open-->'),
      'phai chen moc shadow-root de doc duoc bang mat');
    assert.ok(capture.html.includes('Keywords ideas'), 'phai co noi dung ben trong shadow');
    assert.ok(capture.html.includes('data-testid="ahrefs-serp-widget"'));
  });
});

test('capture: de xuat selector on dinh, uu tien data-* duy nhat', { skip }, async () => {
  await withPage('ahrefs-widget-shadow.html', async (page) => {
    const capture = await captureBlock({
      page, block: 'ahrefs_widget', selectors, config, logger,
      cssSelectors: ['[data-testid="ahrefs-serp-widget"]'],
      probeText: '(?i)keywords? ideas',
    });

    const cands = capture.meta.candidates;
    assert.ok(cands.length > 0, 'phai co it nhat mot de xuat');

    const best = cands[0];
    assert.equal(best.hitsTarget, true, 'de xuat dau tien phai tro dung node muc tieu');
    assert.equal(best.unique, true, 'de xuat dau tien phai duy nhat');
    assert.ok(best.rank <= 2, `de xuat dau tien nen thuoc hang cao (dang la ${best.rank})`);
    assert.ok(cands.every((c) => typeof c.matchCount === 'number'));
  });
});

test('capture: probe text tim duoc node trong shadow va de xuat selector cho no', { skip }, async () => {
  await withPage('ahrefs-widget-shadow.html', async (page) => {
    const capture = await captureBlock({
      page, block: 'ahrefs_widget', selectors, config, logger,
      cssSelectors: ['#khong-ton-tai'],
      probeText: '(?i)^keywords ideas$',
    });

    const probes = capture.meta.probe_matches;
    assert.ok(probes.length > 0, 'phai tim thay node text khop probe');
    assert.equal(probes[0].text, 'Keywords ideas');
    assert.equal(probes[0].inShadow, true);
    assert.ok(probes[0].candidates.length > 0);
  });
});

test('capture: selector khop HOST o main document van lay duoc noi dung shadow', { skip }, async () => {
  // Day dung la tinh huong that cua v1.0: "[id*='ahrefs' i]" co khop host,
  // nen firstVisible() bao tim thay, nhung document.querySelector ben trong
  // extractor lai khong doc duoc row vi row nam trong shadow root.
  await withPage('ahrefs-widget-shadow.html', async (page) => {
    const capture = await captureBlock({
      page, block: 'ahrefs_widget', selectors, config, logger,
      cssSelectors: ["[id*='ahrefs' i]"],
      probeText: '(?i)keywords? ideas',
    });

    assert.equal(capture.meta.found, true);
    assert.equal(capture.meta.scope_kind, 'page', 'host nam o main document');
    assert.equal(capture.meta.matched_selector, "[id*='ahrefs' i]");

    // Nhung noi dung that van nam trong shadow, va capture phai lay duoc
    assert.ok(capture.html.includes('<!--shadow-root open-->'));
    assert.ok(capture.html.includes('samoan traditional clothing male'),
      'phai lay duoc row nam trong shadow root');

    // Va probe text phai chi ra rang node muc tieu nam trong shadow
    assert.ok(capture.meta.probe_matches.some((p) => p.inShadow),
      'phai bao duoc rang noi dung nam trong shadow');
  });
});

test('capture: khong tim thay thi bao ro, khong nem loi', { skip }, async () => {
  await withPage('local-serp-page2.html', async (page) => {
    const capture = await captureBlock({
      page, block: 'ahrefs_widget', selectors, config, logger,
      cssSelectors: ["[id*='ahrefs' i]"],
      probeText: '(?i)keywords? ideas',
    });
    assert.equal(capture.meta.found, false);
    assert.equal(capture.meta.scope_kind, 'none');
    assert.deepEqual(capture.meta.candidates, []);
  });
});

test('capture: ghi du 3 file va bao cao doc duoc', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-capture-');
  try {
    await withPage('ahrefs-widget-shadow.html', async (page) => {
      const capture = await captureBlock({
        page, block: 'ahrefs_widget', selectors, config, logger,
        cssSelectors: ['[data-testid="ahrefs-serp-widget"]'], probeText: '(?i)keywords? ideas',
      });

      const snapshotDir = path.join(tmp.dir, 'dom-snapshots');
      const written = writeSnapshot(snapshotDir, capture);
      assert.ok(fs.existsSync(written.htmlPath));
      assert.ok(fs.existsSync(written.metaPath));

      const meta = JSON.parse(fs.readFileSync(written.metaPath, 'utf8'));
      assert.equal(meta.block, 'ahrefs_widget');
      assert.equal(meta.scope_kind, 'shadow');

      const report = buildCandidatesReport([capture]);
      assert.match(report, /# Selector candidates/);
      assert.match(report, /## ahrefs_widget/);
      assert.match(report, /shadow root/);
      assert.match(report, /\| # \| Selector \|/);
    });
  } finally {
    tmp.cleanup();
  }
});

test('capture: bo thu thap chi chup block duoc chi dinh', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-capture2-');
  try {
    await withPage('ahrefs-widget-shadow.html', async (page) => {
      const capture = createCapture({
        enabled: true,
        blocks: ['ahrefs_widget'],
        runDir: tmp.dir,
        config, selectors, logger,
      });

      assert.equal(capture.wants('ahrefs_widget'), true);
      assert.equal(capture.wants('google_suggestions'), false, 'block khong duoc chi dinh thi bo qua');

      await capture.snapshot(page, 'ahrefs_widget', { cssSelectors: ['#ahrefs-host'] });
      const skipped = await capture.snapshot(page, 'google_suggestions', { cssSelectors: ['ul'] });
      assert.equal(skipped, null);

      const reportPath = capture.finish();
      assert.ok(reportPath && fs.existsSync(reportPath));
      const report = fs.readFileSync(reportPath, 'utf8');
      assert.match(report, /## ahrefs_widget/);
      assert.ok(!report.includes('## google_suggestions'));
    });
  } finally {
    tmp.cleanup();
  }
});

test('capture: tat thi khong chup gi ca', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-capture3-');
  try {
    const capture = createCapture({
      enabled: false, blocks: [], runDir: tmp.dir, config, selectors, logger,
    });
    assert.equal(capture.wants('ahrefs_widget'), false);
    assert.equal(await capture.snapshot(null, 'ahrefs_widget'), null);
    assert.equal(capture.finish(), null);
  } finally {
    tmp.cleanup();
  }
});
