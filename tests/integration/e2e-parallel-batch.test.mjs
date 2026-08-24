/**
 * E2E cuc bo cho hai tinh nang moi:
 *  1. Che do chay SONG SONG cho ket qua giong het che do TUAN TU (va nhanh hon).
 *  2. Nhieu tu khoa ngan cach bang ";" -> nhieu thu muc output rieng biet.
 *
 * Van chay tren server gia lap SERP o 127.0.0.1 + Chrome that qua CDP.
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
import { parseKeywordList, parsePromptList, pairKeywordsAndPrompts } from '../../src/core/input.mjs';

let chromePath = null;
try { chromePath = findChrome('auto'); } catch { chromePath = null; }
const skip = chromePath ? false : 'Khong tim thay Google Chrome tren may nay';

function startFakeSerpServer() {
  const page1 = fs.readFileSync(fixturePath('local-serp-page1.html'), 'utf8');
  const page2 = fs.readFileSync(fixturePath('local-serp-page2.html'), 'utf8');
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(url.searchParams.get('start') === '10' ? page2 : page1);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function buildConfig({ tmpDir, profileDir, port, debugPort }) {
  return loadConfig({
    overrides: {
      browser: {
        remote_debugging_port: debugPort,
        user_data_dir: profileDir,
        headless: true,
      },
      search: {
        scheme: 'http', domain: `127.0.0.1:${port}`,
        min_delay_ms: 10, max_delay_ms: 20, page_timeout_ms: 15000,
      },
      ai: {
        overview_timeout_ms: 4000, response_timeout_ms: 15000,
        stable_ms: 800, min_response_chars: 20, poll_interval_ms: 200,
        direct_ai_mode_fallback: false,
      },
      extractors: { ahrefs_timeout_ms: 1200, extension_timeout_ms: 1500, download_timeout_ms: 1500 },
      output: { root: path.join(tmpDir, 'output'), logs_root: path.join(tmpDir, 'logs') },
      notifications: { console: false, sound: false, windows_toast: false, open_result: false },
      recovery: { retries_per_step: 0, backoff_ms: [10] },
      performance: { stagger_ms: 200 },
    },
  });
}

async function withEnvironment(debugPort, fn) {
  const tmp = makeTempDir('auto-serp-e2e-par-');
  const { server, port } = await startFakeSerpServer();
  // Mot profile duy nhat cho ca moi truong test, dung nhu luc chay that
  const profileDir = path.join(tmp.dir, 'chrome-profile');
  const browserContext = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: true,
    args: [`--remote-debugging-port=${debugPort}`],
  });
  try {
    return await fn({ tmpDir: tmp.dir, profileDir, port });
  } finally {
    await browserContext.close().catch(() => {});
    await new Promise((r) => server.close(r));
    tmp.cleanup();
  }
}

test('E2E: che do song song va tuan tu cho ket qua giong nhau', { skip }, async (t) => {
  await withEnvironment(9335, async ({ tmpDir, profileDir, port }) => {
    const selectors = loadSelectors();
    const job = {
      keyword: 'Filipino vs Samoan',
      prompt: 'What are the main similarities and differences?',
      selectors,
    };

    const parallelConfig = buildConfig({ tmpDir: path.join(tmpDir, 'par'), profileDir, port, debugPort: 9335 });
    const startPar = Date.now();
    const parallel = await runWorkflow({
      ...job, config: parallelConfig, options: { interactive: false, parallel: true },
    });
    const parallelMs = Date.now() - startPar;

    const sequentialConfig = buildConfig({ tmpDir: path.join(tmpDir, 'seq'), profileDir, port, debugPort: 9335 });
    const startSeq = Date.now();
    const sequential = await runWorkflow({
      ...job, config: sequentialConfig, options: { interactive: false, parallel: false },
    });
    const sequentialMs = Date.now() - startSeq;

    // Cung tao du 3 file
    for (const result of [parallel, sequential]) {
      assert.equal(fs.readdirSync(result.outputDir).length, 3);
    }

    // Noi dung CSV phai giong het nhau (tru captured_at vi hai run khac thoi diem)
    const readCsv = (result, page) => fs.readFileSync(
      path.join(result.outputDir, `Filipino vs Samoan page ${page}.csv`), 'utf8',
    );
    const rowsWithoutTimestamp = (text) => parseCsv(text).records.map((row) => {
      const { captured_at: _ignored, ...rest } = row;
      return rest;
    });
    assert.deepEqual(rowsWithoutTimestamp(readCsv(parallel, 1)), rowsWithoutTimestamp(readCsv(sequential, 1)));
    assert.deepEqual(rowsWithoutTimestamp(readCsv(parallel, 2)), rowsWithoutTimestamp(readCsv(sequential, 2)));

    // Vi tri Page 2 phai duoc danh so lai dung o che do song song
    const p2 = parseCsv(readCsv(parallel, 2));
    assert.deepEqual(p2.records.map((r) => r.position), ['11', '12', '13']);

    // Cac khoi du lieu giong nhau
    assert.deepEqual(parallel.counts, sequential.counts);
    assert.equal(parallel.sources.ai, sequential.sources.ai);
    assert.equal(parallel.sources.paa, sequential.sources.paa);
    assert.equal(parallel.sources.suggestions, sequential.sources.suggestions);

    t.diagnostic(`song song: ${parallelMs}ms | tuan tu: ${sequentialMs}ms`);
    // Dung nguong co dung sai: khi chay ca bo test, nhieu Chrome cung chay nen
    // do thoi gian bi nhieu. Nguong nay van bat duoc hoi quy that (song song
    // cham han tuan tu), ma khong fail vi lich CPU.
    assert.ok(parallelMs < sequentialMs * 1.3,
      `che do song song khong duoc cham hon tuan tu dang ke (${parallelMs}ms vs ${sequentialMs}ms)`);
  });
});

test('E2E: nhieu tu khoa ngan cach bang ";" tao nhieu thu muc rieng', { skip }, async () => {
  await withEnvironment(9336, async ({ tmpDir, profileDir, port }) => {
    const selectors = loadSelectors();
    const config = buildConfig({ tmpDir, profileDir, port, debugPort: 9336 });

    const jobs = pairKeywordsAndPrompts(
      parseKeywordList('Filipino vs Samoan; Samoan Food Guide'),
      parsePromptList('Prompt cho tu khoa mot; Prompt cho tu khoa hai'),
      (kw) => `template ${kw}`,
    );
    assert.equal(jobs.length, 2);
    assert.equal(jobs[1].prompt, 'Prompt cho tu khoa hai');

    const results = [];
    for (const job of jobs) {
      results.push(await runWorkflow({
        ...job, config, selectors, options: { interactive: false },
      }));
    }

    // Hai thu muc khac nhau, moi thu muc dung 3 file dung ten
    assert.notEqual(results[0].outputDir, results[1].outputDir);
    assert.equal(path.basename(results[0].outputDir), 'Filipino vs Samoan');
    assert.equal(path.basename(results[1].outputDir), 'Samoan Food Guide');

    for (const [index, result] of results.entries()) {
      const base = path.basename(result.outputDir);
      assert.deepEqual(fs.readdirSync(result.outputDir).sort(), [
        `${base} page 1.csv`,
        `${base} page 2.csv`,
        `${base}.md`,
      ], `thu muc thu ${index + 1} phai co dung 3 file`);
    }

    // Log cua hai run tach biet nhau va nam ngoai thu muc ket qua
    assert.notEqual(results[0].logDir, results[1].logDir);
    for (const result of results) {
      assert.ok(!result.manifestPath.startsWith(result.outputDir));
    }
  });
});
