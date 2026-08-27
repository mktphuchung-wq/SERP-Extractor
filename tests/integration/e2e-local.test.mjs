/**
 * E2E cuc bo: chay TOAN BO orchestrator (Step 1 -> Step 10) tren mot server
 * gia lap SERP chay o 127.0.0.1, dung Chrome that qua CDP.
 *
 * Muc dich: kiem chung day chuyen that (browser -> adapter -> normalizer ->
 * artifact writer -> quality gate -> manifest) ma khong dung toi Google.
 * Cac phan phu thuoc Google/extension that duoc kiem tra rieng khi co profile that.
 *
 * VI SAO GHIM engine: 'playwright':
 * Cac test nay tu dung san mot Chrome rieng va dua cong debug cho tool. Do la
 * mo hinh cua engine playwright. Engine bridge (mac dinh tu V2) lai doi mot
 * trinh duyet DA CO NGUOI DUNG voi extension cau noi da cai, nen khong chay
 * duoc trong moi truong test tu dong. Engine bridge duoc kiem chung rieng o
 * tests/integration/bridge-engine.test.mjs.
 *
 * Tu dong SKIP neu may khong co Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright-core';

import { fixturePath, makeTempDir } from '../helpers/dom.mjs';
import { loadConfig, loadSelectors } from '../../src/core/config.mjs';
import { findChrome } from '../../src/browser/chrome-launcher.mjs';
import { runWorkflow } from '../../src/orchestrator.mjs';
import { parseCsv } from '../../src/extractors/csv-normalizer.mjs';
import { REQUIRED_HEADINGS } from '../../src/output/markdown-builder.mjs';

let chromePath = null;
try { chromePath = findChrome('auto'); } catch { chromePath = null; }
const skip = chromePath ? false : 'Khong tim thay Google Chrome tren may nay';

const DEBUG_PORT = 9333;

function startFakeSerpServer() {
  const page1 = fs.readFileSync(fixturePath('local-serp-page1.html'), 'utf8');
  const page2 = fs.readFileSync(fixturePath('local-serp-page2.html'), 'utf8');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const start = url.searchParams.get('start');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(start === '10' ? page2 : page1);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('E2E cuc bo: mot run tao dung 1 MD + 2 CSV va qua quality gate', { skip }, async (t) => {
  const tmp = makeTempDir('auto-serp-e2e-');
  const { server, port } = await startFakeSerpServer();

  // Khoi dong Chrome DUNG bang profile ma config tro toi, giong het luc chay that
  const profileDir = path.join(tmp.dir, 'chrome-profile');
  const browserContext = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: true,
    args: [`--remote-debugging-port=${DEBUG_PORT}`],
  });

  try {
    const config = loadConfig({
      overrides: {
        browser: {
          remote_debugging_port: DEBUG_PORT,
          user_data_dir: profileDir,
          headless: true,
        },
        search: {
          scheme: 'http',
          domain: `127.0.0.1:${port}`,
          min_delay_ms: 10,
          max_delay_ms: 20,
          page_timeout_ms: 15000,
        },
        ai: {
          overview_timeout_ms: 4000,
          response_timeout_ms: 15000,
          stable_ms: 800,
          min_response_chars: 20,
          poll_interval_ms: 200,
          direct_ai_mode_fallback: false,
        },
        extractors: {
          ahrefs_timeout_ms: 1500,
          extension_timeout_ms: 2000,
          download_timeout_ms: 2000,
        },
        output: {
          root: path.join(tmp.dir, 'output'),
          logs_root: path.join(tmp.dir, 'logs'),
        },
        notifications: { console: false, sound: false, windows_toast: false },
        recovery: { retries_per_step: 0, backoff_ms: [10] },
      },
    });

    const result = await runWorkflow({
      keyword: 'Filipino vs Samoan',
      prompt: 'What are the main similarities and differences between Filipino and Samoan people?',
      config,
      selectors: loadSelectors(),
      options: { interactive: false, engine: 'playwright' },
    });

    // --- Thu muc ket qua: dung 3 file, dung ten -----------------------------
    const files = fs.readdirSync(result.outputDir).sort();
    assert.deepEqual(files, [
      'Filipino vs Samoan page 1.csv',
      'Filipino vs Samoan page 2.csv',
      'Filipino vs Samoan.md',
    ]);
    assert.equal(result.status, 'COMPLETED_WITH_WARNINGS', 'thieu Ahrefs/extension nen phai co canh bao');

    // --- Markdown: dung 4 heading, co noi dung AI that ----------------------
    const markdown = fs.readFileSync(path.join(result.outputDir, 'Filipino vs Samoan.md'), 'utf8');
    const headings = markdown.split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.trim());
    assert.deepEqual(headings, REQUIRED_HEADINGS);
    assert.ok(markdown.includes('**Austronesian**'), 'phai co noi dung AI Mode that');
    assert.ok(markdown.includes('[this study](https://source.example.com/study)'), 'link nguon -> markdown link');
    assert.ok(!markdown.includes('N/A'));
    assert.ok(!markdown.includes('undefined'));

    // --- Keywords Ideas: khong co Ahrefs -> canh bao, KHONG bia du lieu -----
    assert.ok(markdown.includes('Khong lay duoc Keywords Ideas'));
    assert.ok(result.warnings.includes('AHREFS_KEYWORD_IDEAS_UNAVAILABLE'));
    assert.equal(result.counts.keyword_ideas, 0);

    // --- PAA: fallback DOM Google, deduplicate ------------------------------
    assert.ok(markdown.includes('- Are Filipinos and Samoans related?'));
    assert.ok(markdown.includes('- Is Samoan closer to Hawaiian than Filipino?'));
    assert.equal(result.counts.paa, 2, 'cau hoi trung phai bi loai');
    assert.equal(result.sources.paa, 'google_serp_dom');

    // --- Suggestions: extension thieu -> DOM fallback -----------------------
    assert.equal(result.sources.suggestions, 'google_suggest_dom');
    assert.ok(markdown.includes('- filipino vs samoan culture'));
    assert.ok(!markdown.includes('cultureTopic'), 'phai bo entity label');

    // --- CSV: native fallback, khong lay ads/PAA/extension node -------------
    const csv1 = fs.readFileSync(path.join(result.outputDir, 'Filipino vs Samoan page 1.csv'), 'utf8');
    const csv2 = fs.readFileSync(path.join(result.outputDir, 'Filipino vs Samoan page 2.csv'), 'utf8');
    const p1 = parseCsv(csv1);
    const p2 = parseCsv(csv2);

    assert.deepEqual(p1.records.map((r) => r.title), ['First Organic Result', 'Second Organic Result']);
    assert.deepEqual(p2.records.map((r) => r.title), ['Eleventh Result', 'Twelfth Result', 'Thirteenth Result']);
    assert.deepEqual(p2.records.map((r) => r.position), ['11', '12', '13']);
    assert.equal(p1.records[0].url, 'https://www.first.com/page', 'phai giai ma /url?q=');
    assert.ok(!csv1.includes('chrome-extension://'));
    assert.ok(!csv1.includes('Sponsored'));
    assert.equal(result.sources.serp_page_1, 'native_serp_dom');

    // --- Log/manifest nam NGOAI thu muc ket qua ----------------------------
    assert.ok(fs.existsSync(result.manifestPath));
    assert.ok(!result.manifestPath.startsWith(result.outputDir));
    assert.ok(fs.existsSync(path.join(result.logDir, 'run.log')));
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));
    assert.equal(manifest.status, 'COMPLETED_WITH_WARNINGS');
    assert.equal(manifest.counts.serp_page_1_rows, 2);
    assert.equal(manifest.counts.serp_page_2_rows, 3);
    assert.equal(manifest.market.country, 'us');
    assert.ok(manifest.warnings.length > 0);

    t.diagnostic(`sources: ${JSON.stringify(result.sources)}`);
  } finally {
    await browserContext.close().catch(() => {});
    await new Promise((r) => server.close(r));
    tmp.cleanup();
  }
});

test('E2E cuc bo: chay lai cung keyword thi tao thu muc timestamp, khong ghi de', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-e2e2-');
  const { server, port } = await startFakeSerpServer();
  const profileDir = path.join(tmp.dir, 'chrome-profile');
  const browserContext = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: true,
    args: [`--remote-debugging-port=${DEBUG_PORT + 1}`],
  });

  try {
    const overrides = {
      browser: {
        remote_debugging_port: DEBUG_PORT + 1,
        user_data_dir: profileDir,
        headless: true,
      },
      search: {
        scheme: 'http', domain: `127.0.0.1:${port}`,
        min_delay_ms: 10, max_delay_ms: 20, page_timeout_ms: 15000,
      },
      ai: { overview_timeout_ms: 1200, response_timeout_ms: 8000, stable_ms: 500, poll_interval_ms: 200, direct_ai_mode_fallback: false },
      extractors: { ahrefs_timeout_ms: 800, extension_timeout_ms: 1000, download_timeout_ms: 1000 },
      output: { root: path.join(tmp.dir, 'output'), logs_root: path.join(tmp.dir, 'logs') },
      notifications: { console: false, sound: false, windows_toast: false },
      recovery: { retries_per_step: 0, backoff_ms: [10] },
    };
    const config = loadConfig({ overrides });
    const selectors = loadSelectors();

    const first = await runWorkflow({
      keyword: 'Filipino vs Samoan', prompt: 'Prompt one.', config, selectors,
      options: { interactive: false, engine: 'playwright' },
    });
    const second = await runWorkflow({
      keyword: 'Filipino vs Samoan', prompt: 'Prompt two.', config, selectors,
      options: { interactive: false, engine: 'playwright' },
    });

    assert.notEqual(first.outputDir, second.outputDir);
    assert.ok(path.basename(second.outputDir).startsWith('Filipino vs Samoan__'));
    assert.equal(fs.readdirSync(first.outputDir).length, 3);
    assert.equal(fs.readdirSync(second.outputDir).length, 3);
  } finally {
    await browserContext.close().catch(() => {});
    await new Promise((r) => server.close(r));
    tmp.cleanup();
  }
});
