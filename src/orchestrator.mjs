/**
 * Orchestrator: state machine cap run, dieu phoi toan bo workflow Step 0 -> Step 10.
 *
 * Hai che do chay:
 *  - PARALLEL (mac dinh): cac buoc KHONG phu thuoc nhau chay dong thoi tren
 *    cac tab rieng => giam manh thoi gian chay (AI Mode thuong chiem 60-70% tong thoi gian).
 *  - SEQUENTIAL: chay lan luot nhu dac ta mo ta, dung khi can debug hoac khi
 *    Google/extension nhay cam voi nhieu tab.
 *
 * Nhung viec PHU THUOC TAB DANG ACTIVE (mo popup extension, doc clipboard,
 * bringToFront) luon duoc bao ve bang mot mutex, du o che do song song,
 * de khong lay nham du lieu giua cac tab.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  AppError, ManualActionRequired, WARNING_CODES, groupBySeverity, SEVERITY,
} from './core/errors.mjs';
import { RunLogger } from './core/logger.mjs';
import { buildRunId, sanitizeFileBase, resolveOutputDir, timestampStamp } from './core/sanitize.mjs';
import { withRetry, softly, humanDelay, sleep } from './core/retry.mjs';
import { waitForEnter, isInteractive } from './core/prompt.mjs';
import { Mutex, NO_LOCK } from './core/mutex.mjs';

import { startEngine, ENGINES } from './engine/index.mjs';
import { discoverLive } from './engine/live-extensions.mjs';
import { discoverEffective } from './browser/bundled-extensions.mjs';
import { createCapture, NO_CAPTURE } from './browser/dom-capture.mjs';

import { buildSearchUrl, openSerp, verifySerpUrl } from './adapters/google-search.mjs';
import { collectAiAnswer } from './adapters/ai-mode.mjs';
import { collectKeywordIdeas, verifyUsMarket } from './adapters/ahrefs-widget.mjs';
import { collectPaa } from './adapters/paa.mjs';
import { collectSuggestions } from './adapters/suggestions.mjs';
import { collectSerpCsv, nextPagePositionOffset } from './adapters/serp-export.mjs';

import { areCsvIdentical, renumberPositions } from './extractors/csv-normalizer.mjs';
import { buildMarkdown } from './output/markdown-builder.mjs';
import { writeStagingArtifacts, moveToOutput, cleanStaging } from './output/artifact-writer.mjs';
import { validateRun } from './output/validator.mjs';
import { buildManifest, writeManifest, collectSelectorVersions } from './output/manifest.mjs';
import { notify, notifyFailure, openInEditor, openFolder } from './output/notifier.mjs';

const STEPS_SEQUENTIAL = 8;
const STEPS_PARALLEL = 5;

/**
 * @param {{keyword:string, prompt:string, config:object, selectors:object, options?:object}} args
 */
export async function runWorkflow(args) {
  const { config, selectors } = args;
  const keyword = String(args.keyword ?? '').trim();
  const prompt = String(args.prompt ?? '').trim();
  const options = args.options ?? {};

  if (!keyword) throw new AppError('INVALID_INPUT', 'Keyword khong duoc de trong.');
  if (!prompt) throw new AppError('INVALID_INPUT', 'AI prompt khong duoc de trong.');

  const parallel = resolveParallelMode(config, options);
  const startedAt = new Date();
  const runId = buildRunId(keyword, startedAt);
  const logDir = path.join(config.output.logs_root, runId);
  const stagingDir = path.join(config.paths.staging_root, runId);
  fs.mkdirSync(stagingDir, { recursive: true });

  const logger = new RunLogger({
    runDir: logDir,
    console: config.notifications?.console !== false,
    level: options.verbose ? 'debug' : 'info',
    redact: config.privacy?.redact_logs !== false,
    strictSelectors: config.logging?.strict_selectors === true,
  });

  const base = sanitizeFileBase(keyword, { maxLength: config.output.max_filename_length ?? 120 });
  const resolved = resolveOutputDir({
    root: config.output.root,
    base,
    policy: options.overwrite ? 'overwrite' : config.output.on_conflict,
    stamp: timestampStamp(startedAt),
    allowOverwrite: Boolean(options.overwrite),
  });

  logger.info(`Run ID: ${runId}`);
  logger.info(`Keyword: ${keyword}`);
  logger.info(`Che do: ${parallel ? 'SONG SONG' : 'TUAN TU'}`);
  logger.info(`Thu muc ket qua: ${resolved.dir}`);
  if (resolved.conflict) {
    logger.warn(`Thu muc goc da ton tai, ap dung chinh sach "${config.output.on_conflict}".`, {
      code: 'OUTPUT_CONFLICT_RESOLVED', action: resolved.action,
    });
  }

  const state = {
    runId, keyword, prompt, config, selectors, logger, stagingDir,
    startedAt,
    // TEN FILE luon la keyword da sanitize, KHONG mang hau to chong trung.
    // Chi TEN THU MUC moi nhan hau to timestamp khi bi trung (dac ta muc 3.2 va 8.2):
    //   output\Filipino vs Samoan__20260821-111530\Filipino vs Samoan.md
    base,
    folderBase: resolved.base,
    outputDir: resolved.dir,
    sources: {}, counts: {}, warnings: [], extensions: {},
    parallel,
    totalSteps: parallel ? STEPS_PARALLEL : STEPS_SEQUENTIAL,
    activeTabLock: parallel ? new Mutex('active-tab') : NO_LOCK,
    pauseLock: new Mutex('manual-pause'),
    extraPages: [],
  };

  // --capture-dom: chup DOM that de soan selector tu bang chung
  const captureBlocks = Array.isArray(options.captureDom) ? options.captureDom : (config.capture?.blocks ?? []);
  state.capture = (options.captureDom || config.capture?.enabled)
    ? createCapture({
      enabled: true, blocks: captureBlocks, runDir: logDir, config, selectors, logger,
    })
    : NO_CAPTURE;
  if (state.capture.enabled) {
    logger.info(`Che do --capture-dom: dang bat${captureBlocks.length ? ` (${captureBlocks.join(', ')})` : ' (tat ca block)'}`);
  }

  let engineSession = null;
  try {
    await stepStartBrowser(state, (s) => { engineSession = s; }, options);
    await stepOpenSerp(state);

    if (parallel) {
      await stepCollectParallel(state);
      await stepFinishSerpPages(state);
    } else {
      await stepAi(state);
      await stepKeywordIdeas(state);
      await stepPaa(state);
      await stepSuggestions(state);
      await stepSerpPages(state);
    }

    return await stepWriteAndValidate(state, options);
  } catch (err) {
    logger.error(`Run that bai: ${err.message}`, {
      code: err instanceof AppError ? err.code : 'UNEXPECTED_ERROR',
      stack: options.verbose ? err.stack : undefined,
    });
    writeManifest(logDir, buildManifest({
      runId, keyword, prompt, config,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: 'FAILED',
      sources: state.sources,
      counts: state.counts,
      selectorVersions: collectSelectorVersions(selectors),
      files: [],
      outputDir: resolved.dir,
      warnings: logger.warnings,
      errors: [{ code: err instanceof AppError ? err.code : 'UNEXPECTED_ERROR', message: err.message }],
      extensions: summariseExtensions(state.extensions),
      chromeVersion: state.chromeVersion,
      engine: state.engine ?? null,
    }));
    notifyFailure(config, {
      keyword,
      code: err instanceof AppError ? err.code : 'UNEXPECTED_ERROR',
      message: err.message,
      logDir,
    }, logger);
    logger.info(`Staging duoc giu lai de debug: ${stagingDir}`);
    throw err;
  } finally {
    try {
      const reportPath = state.capture?.finish();
      if (reportPath) announceCapture(state, reportPath, options);
    } catch { /* khong lam hong run */ }
    await closeExtraTabs(state);
    // close() cua engine chi dong nhung tab do tool mo va ngat cau noi.
    // Voi engine bridge, trinh duyet cua nguoi dung KHONG bi dong.
    if (engineSession) await engineSession.close().catch(() => {});
    await logger.close();
  }
}

function resolveParallelMode(config, options) {
  if (options.parallel === false) return false;
  if (options.parallel === true) return true;
  return config.performance?.parallel_steps !== false;
}

/* ------------------------------------------------------------------ Step 1 */
async function stepStartBrowser(state, setEngine, options) {
  const { config, logger } = state;
  const useBridge = (options.engine ?? config.browser?.engine ?? ENGINES.BRIDGE) === ENGINES.BRIDGE;
  logger.step(1, state.totalSteps, useBridge
    ? 'Ket noi vao trinh duyet dang mo cua ban...'
    : 'Khoi dong Chrome profile rieng...');

  const session = await startEngine({ config, logger, options });
  setEngine(session);

  state.engine = session.engine;
  state.chromeVersion = session.chromeVersion;
  state.context = session.context;
  state.page = session.page;

  // Engine bridge lam viec tren chinh profile cua nguoi dung, nen cac extension
  // ho da cai (Ahrefs, SEO SERP, Suggestion Extractor) co san va dang dang nhap.
  // Engine playwright thi phai dua vao ban dong goi trong vendor\extensions.
  //
  // LUU Y LICH SU: truoc day nhanh bridge dat state.extensions = {} vi khong doc
  // duoc thu muc profile that. Hau qua la moi adapter thay "chua cai" va
  // SEO SERP Extraction Tool khong bao gio duoc dung. Bay gio ta hoi thang
  // trinh duyet dang chay - xem src/engine/live-extensions.mjs.
  if (session.engine === ENGINES.BRIDGE) {
    logger.info(
      'Dang dung profile that cua ban: dang kiem tra cac extension co trong '
      + 'trinh duyet nay...',
    );
    state.extensions = await discoverLive({
      context: state.context,
      config,
      logger,
      timeoutMs: config.extractors?.extension_timeout_ms ?? 20000,
    });
  } else {
    state.extensions = discoverEffective(config);
  }

  const howToFix = session.engine === ENGINES.BRIDGE
    ? 'Cai/bat extension trong chinh Chrome nay roi chay lai'
    : 'Chay INSTALL.bat de cai lai, hoac cai tay tai';
  for (const [key, meta] of Object.entries(state.extensions)) {
    if (meta.installed) {
      const where = { bundled: 'dong goi san', live: 'trinh duyet cua ban' }[meta.source]
        ?? `profile: ${meta.profileDir}`;
      logger.info(
        `Extension OK: ${meta.name ?? meta.configuredName}`
        + `${meta.version ? ` v${meta.version}` : ''} [${where}]`,
      );
    } else {
      logger.warn(
        `Khong dung duoc extension "${meta.configuredName}" (${meta.id}): ` +
        `${meta.bundleReason ?? meta.reason}. ${howToFix}: ${meta.webstore}`,
        { code: WARNING_CODES.EXTENSION_MISSING, extension: key, reason: meta.bundleReason ?? meta.reason },
      );
    }
  }
  if (options.requireExtensions && Object.values(state.extensions).some((m) => !m.installed)) {
    throw new AppError('EXTENSION_MISSING', 'Thieu extension bat buoc. Chay RUN.bat va cai dat khi duoc hoi.');
  }
}

/* ------------------------------------------------------------------ Step 2 */
async function stepOpenSerp(state) {
  const { config, selectors, logger } = state;
  logger.step(2, state.totalSteps, 'Mo Google SERP (US/English, pws=0)...');

  state.page1Url = buildSearchUrl({
    domain: config.search.domain,
    scheme: config.search.scheme,
    keyword: state.keyword,
    language: config.search.language,
    country: config.search.country,
    personalization: config.search.personalization,
    num: config.search.results_per_page,
    start: 0,
  });
  state.page2Url = buildSearchUrl({
    domain: config.search.domain,
    scheme: config.search.scheme,
    keyword: state.keyword,
    language: config.search.language,
    country: config.search.country,
    personalization: config.search.personalization,
    num: config.search.results_per_page,
    start: config.search.results_per_page ?? 10,
  });

  await runStep(state, 'open-serp-page-1', async () => {
    await openSerp(state.page, state.page1Url, state);
  });

  const check = verifySerpUrl(state.page.url(), {
    hl: config.search.language,
    gl: config.search.country,
    pws: config.search.personalization ? 1 : 0,
  });
  if (!check.ok) {
    logger.warn(`Query param SERP khong khop mong doi: ${check.mismatches.join('; ')}`, {
      code: 'SERP_PARAM_MISMATCH',
    });
  }

  // Chup DOM cac block tren SERP truoc khi bat ky adapter nao dung toi trang
  if (state.capture.enabled) {
    for (const block of ['ahrefs_widget', 'ai_overview', 'google_paa', 'native_serp']) {
      await state.capture.snapshot(state.page, block, {
        cssSelectors: captureSelectorsFor(selectors, block),
      });
    }
  }

  const market = await softly('ahrefs-us-market', () => verifyUsMarket(state.page, selectors, logger), logger);
  if (market.value?.warning) state.warnings.push(market.value.warning);
  state.sources.market_verified = Boolean(market.value?.verified);
}

/* --------------------------------------------------- Step 3 (che do song song) */
/**
 * Cac nhom viec doc lap nhau, moi nhom mot tab rieng:
 *   T1  tab chinh   : Ahrefs Keywords Ideas -> PAA -> CSV Page 1  (cung widget/tab nen phai tuan tu)
 *   T2  tab moi     : AI Mode
 *   T3  tab moi     : Google Search Suggestions
 *   T4  tab moi     : CSV Page 2 (start=10)
 */
async function stepCollectParallel(state) {
  const { config, logger } = state;
  logger.step(3, state.totalSteps, 'Thu thap song song (AI Mode, Ahrefs, PAA, Suggestions, CSV)...');

  const stagger = config.performance?.stagger_ms ?? 1200;
  state.capturedAt = new Date().toISOString();

  // AI Overview va Ahrefs cung thay doi UI tren SERP va cung dung clipboard.
  // Cho phep CSV Page 1 chay song song, nhung Ahrefs phai doi AI Copy xong.
  const aiTask = runParallelTask({ name: 'ai-mode', delay: 0, run: () => taskAi(state) }, logger);
  const tasks = [
    { name: 'ahrefs-paa-csv1', delay: stagger, run: () => taskMainTab(state, aiTask) },
    { name: 'suggestions', delay: stagger * 2, run: () => taskSuggestions(state) },
    { name: 'serp-page-2', delay: stagger * 3, run: () => taskPage2(state) },
  ];

  await Promise.all([aiTask, ...tasks.map((task) => runParallelTask(task, logger))]);

  applyDefaultsForMissingBlocks(state);
}

async function taskAi(state) {
  const page = await newTab(state);
  try {
    await runStep(state, 'open-serp-for-ai', async () => {
      await openSerp(page, state.page1Url, state);
    });
    const value = await collectAiAnswer({
      page,
      config: state.config,
      selectors: state.selectors,
      logger: state.logger,
      keyword: state.keyword,
      prompt: state.prompt,
      lock: state.activeTabLock,
    });
    setAiResult(state, value);
  } finally {
    await closeTab(state, page);
  }
}

async function runParallelTask(task, logger) {
  if (task.delay) await sleep(task.delay);
  logger.debug(`Bat dau nhom "${task.name}"`);
  const result = await softly(task.name, task.run, logger);
  logger.info(`Xong nhom "${task.name}"${result.ok ? '' : ' (co loi, xem canh bao)'}`);
  return result;
}

async function taskMainTab(state, aiTask = null) {
  const args = {
    page: state.page,
    config: state.config,
    selectors: state.selectors,
    logger: state.logger,
    extensions: state.extensions,
    lock: state.activeTabLock,
  };

  // THU TU QUAN TRONG: trich xuat CSV Page 1 TRUOC khi dung toi Ahrefs.
  //
  // Ly do (run that 2026-08-22): Ahrefs doi tab / bam Copy lam trang SERP
  // render lai, sau do native extractor chi con thay 3 ket qua trong khi
  // Page 2 (tab sach, khong bi dung toi) lay duoc 9. CSV phai la anh chup
  // cua SERP nguyen ban, truoc moi tuong tac.
  const page1 = await softly('serp-page-1', () => collectSerpCsv({
    ...args,
    stagingDir: state.stagingDir,
    sourcePage: 1,
    startOffset: 0,
    capturedAt: state.capturedAt,
    keyword: state.keyword,
  }), state.logger);
  setPage1(state, page1.value);

  if (aiTask) {
    state.logger.info('Cho AI Overview Copy xong truoc khi thao tac Ahrefs widget.');
    await aiTask;
  }

  const ideas = await softly('keyword-ideas', () => collectKeywordIdeas(args), state.logger);
  setKeywordIdeas(state, ideas.value);

  const paa = await softly('paa', () => collectPaa(args), state.logger);
  setPaa(state, paa.value);
}

async function taskSuggestions(state) {
  const page = await newTab(state);
  try {
    await runStep(state, 'open-serp-for-suggestions', async () => {
      await openSerp(page, state.page1Url, state);
    });
    const value = await collectSuggestions({
      page,
      config: state.config,
      selectors: state.selectors,
      logger: state.logger,
      extensions: state.extensions,
      keyword: state.keyword,
      lock: state.activeTabLock,
      capture: state.capture,
    });
    setSuggestions(state, value);
  } finally {
    await closeTab(state, page);
  }
}

async function taskPage2(state) {
  const page = await newTab(state);
  try {
    await runStep(state, 'open-serp-page-2', async () => {
      await openSerp(page, state.page2Url, state);
    });
    assertPage2Url(state, page);

    // Chua biet Page 1 co bao nhieu dong -> danh so tam tu 0, se danh so lai sau.
    const value = await collectSerpCsv({
      page,
      config: state.config,
      selectors: state.selectors,
      logger: state.logger,
      extensions: state.extensions,
      lock: state.activeTabLock,
      stagingDir: state.stagingDir,
      sourcePage: 2,
      startOffset: 0,
      capturedAt: state.capturedAt,
      keyword: state.keyword,
    });
    setPage2(state, value, { needsRenumber: true });
  } finally {
    await closeTab(state, page);
  }
}

/* --------------------------------------------- Step 4 (che do song song) */
/** Danh so lai Page 2 va kiem tra trung lap sau khi ca hai trang da xong. */
async function stepFinishSerpPages(state) {
  const { config, logger } = state;
  logger.step(4, state.totalSteps, 'Doi chieu Page 1 / Page 2...');

  const startParam = config.search.results_per_page ?? 10;
  const page1Rows = state.counts.serp_page_1_rows ?? 0;
  state.page2PositionOffset = nextPagePositionOffset(page1Rows, startParam);

  if (page1Rows > startParam) {
    logger.warn(
      `Google tra ve ${page1Rows} ket qua o Page 1 (num=${startParam}). ` +
      `Page 2 danh so tu ${state.page2PositionOffset + 1}.`,
      { code: 'SERP_MORE_RESULTS_THAN_EXPECTED', page1Rows, num: startParam },
    );
  }

  if (state.page2NeedsRenumber && state.csvPage2) {
    state.csvPage2 = renumberPositions(state.csvPage2, state.page2PositionOffset);
    logger.debug(`Da danh so lai Page 2 tu ${state.page2PositionOffset + 1}`);
  }

  if ((state.counts.serp_page_2_rows ?? 0) > 0 && page1Rows > 0
    && areCsvIdentical(state.csvPage1, state.csvPage2)) {
    logger.warn('Page 2 trung Page 1, thu lai mot lan tren tab chinh.', { code: 'SERP_PAGE_DUPLICATE' });
    const retry = await softly('serp-page-2-retry', () => retryPage2(state), logger);
    if (!retry.ok || areCsvIdentical(state.csvPage1, state.csvPage2)) {
      throw new AppError(
        'SERP_PAGE_DUPLICATE',
        'CSV Page 2 van trung hoan toan Page 1 sau khi thu lai. Dung de tranh ghi du lieu sai.',
      );
    }
  }
}

async function retryPage2(state) {
  await runStep(state, 'reopen-serp-page-2', async () => {
    await openSerp(state.page, state.page2Url, state);
    await state.page.reload({ waitUntil: 'domcontentloaded' });
  });
  assertPage2Url(state, state.page);

  const value = await collectSerpCsv({
    page: state.page,
    config: state.config,
    selectors: state.selectors,
    logger: state.logger,
    extensions: state.extensions,
    lock: state.activeTabLock,
    stagingDir: state.stagingDir,
    sourcePage: 2,
    startOffset: state.page2PositionOffset,
    capturedAt: state.capturedAt,
    keyword: state.keyword,
  });
  setPage2(state, value, { needsRenumber: false });
}

/* ---------------------------------------------- Step 3-7 (che do tuan tu) */
async function stepAi(state) {
  const { logger } = state;
  logger.step(3, state.totalSteps, 'Thu thap AI Overview / AI Mode...');

  const result = await softly('ai-mode', () => collectAiAnswer({
    page: state.page,
    config: state.config,
    selectors: state.selectors,
    logger,
    keyword: state.keyword,
    prompt: state.prompt,
  }), logger);
  setAiResult(state, result.value);

  // AI Mode co the dieu huong sang trang khac -> quay lai SERP Page 1
  if (!state.page.url().startsWith(state.page1Url.split('&start=')[0])) {
    logger.info('Quay lai SERP Page 1 sau khi thu thap AI Mode.');
    await runStep(state, 'return-to-serp', async () => {
      await openSerp(state.page, state.page1Url, state);
    });
  }
}

async function stepKeywordIdeas(state) {
  const { logger } = state;
  logger.step(4, state.totalSteps, 'Thu thap Keywords Ideas tu Ahrefs...');
  const result = await softly('keyword-ideas', () => collectKeywordIdeas({
    page: state.page, config: state.config, selectors: state.selectors, logger, lock: NO_LOCK,
  }), logger);
  setKeywordIdeas(state, result.value);
  await humanDelay(state.config, logger);
}

async function stepPaa(state) {
  const { logger } = state;
  logger.step(5, state.totalSteps, 'Thu thap People Also Asked...');
  const result = await softly('paa', () => collectPaa({
    page: state.page, config: state.config, selectors: state.selectors, logger, lock: NO_LOCK,
  }), logger);
  setPaa(state, result.value);
  await humanDelay(state.config, logger);
}

async function stepSuggestions(state) {
  const { logger } = state;
  logger.step(6, state.totalSteps, 'Thu thap Google Search Suggestions...');
  const result = await softly('suggestions', () => collectSuggestions({
    page: state.page,
    config: state.config,
    selectors: state.selectors,
    logger,
    extensions: state.extensions,
    keyword: state.keyword,
    lock: NO_LOCK,
    capture: state.capture,
  }), logger);
  setSuggestions(state, result.value);
  await humanDelay(state.config, logger);
}

async function stepSerpPages(state) {
  const { config, logger } = state;
  logger.step(7, state.totalSteps, 'Xuat CSV Page 1 va Page 2...');
  state.capturedAt = new Date().toISOString();

  if ((config.search.pages ?? 2) !== 2) {
    logger.warn('MVP chi ho tro dung 2 trang SERP; dang dung pages=2.', { code: 'PAGES_CLAMPED' });
  }

  // LUON nap lai Page 1 truoc khi chup CSV.
  //
  // O che do tuan tu, truoc buoc nay da co AI Mode, Ahrefs (doi tab, bam Copy)
  // va Suggestions (go vao o tim kiem) tac dong len chinh tab nay. Neu chup
  // ngay tren DOM da bi dung toi thi so ket qua bi thieu (run that 2026-08-22:
  // Page 1 chi con 3 dong trong khi Page 2 sach duoc 9).
  await runStep(state, 'reopen-page-1', async () => {
    await openSerp(state.page, state.page1Url, state);
  });

  const page1 = await collectSerpCsv({
    page: state.page, config, selectors: state.selectors, logger,
    extensions: state.extensions, stagingDir: state.stagingDir, lock: NO_LOCK,
    sourcePage: 1, startOffset: 0, capturedAt: state.capturedAt, keyword: state.keyword,
  });
  setPage1(state, page1);

  const startParam = config.search.results_per_page ?? 10;
  state.page2PositionOffset = nextPagePositionOffset(page1.rowCount, startParam);
  if (page1.rowCount > startParam) {
    logger.warn(
      `Google tra ve ${page1.rowCount} ket qua o Page 1 (num=${startParam}). ` +
      `Page 2 danh so tu ${state.page2PositionOffset + 1}.`,
      { code: 'SERP_MORE_RESULTS_THAN_EXPECTED', page1Rows: page1.rowCount, num: startParam },
    );
  }

  await humanDelay(config, logger);

  let page2 = await collectPage2Sequential(state);
  if (page2.rowCount > 0 && page1.rowCount > 0 && areCsvIdentical(state.csvPage1, page2.csvText)) {
    logger.warn('Page 2 trung Page 1, dieu huong lai mot lan.', { code: 'SERP_PAGE_DUPLICATE' });
    page2 = await collectPage2Sequential(state, true);
    if (areCsvIdentical(state.csvPage1, page2.csvText)) {
      throw new AppError(
        'SERP_PAGE_DUPLICATE',
        'CSV Page 2 van trung hoan toan Page 1 sau khi thu lai. Dung de tranh ghi du lieu sai.',
      );
    }
  }
  setPage2(state, page2, { needsRenumber: false });
}

async function collectPage2Sequential(state, forceReload = false) {
  const { config, logger } = state;
  await runStep(state, 'open-serp-page-2', async () => {
    await openSerp(state.page, state.page2Url, state);
    if (forceReload) await state.page.reload({ waitUntil: 'domcontentloaded' });
  });
  assertPage2Url(state, state.page);

  return collectSerpCsv({
    page: state.page, config, selectors: state.selectors, logger,
    extensions: state.extensions, stagingDir: state.stagingDir, lock: NO_LOCK,
    sourcePage: 2,
    startOffset: state.page2PositionOffset ?? (config.search.results_per_page ?? 10),
    capturedAt: state.capturedAt, keyword: state.keyword,
  });
}

/* ------------------------------------------------------------ Step cuoi */
async function stepWriteAndValidate(state, options) {
  const { config, logger } = state;
  logger.step(state.totalSteps, state.totalSteps, 'Ghi file va kiem tra chat luong...');

  const markdown = buildMarkdown({
    ai: state.ai,
    keywordIdeas: state.keywordIdeas ?? [],
    paa: state.paa ?? [],
    suggestions: state.suggestions ?? [],
    paaMode: config.extractors.paa_capture_mode,
  });

  const staged = writeStagingArtifacts({
    stagingDir: state.stagingDir,
    base: state.base,
    markdown,
    csvPage1: state.csvPage1 ?? '',
    csvPage2: state.csvPage2 ?? '',
  });

  const backupDir = path.join(config.output.logs_root, state.runId, 'output-backup');
  const files = moveToOutput({
    files: [staged.md, staged.csv1, staged.csv2],
    outputDir: state.outputDir,
    overwrite: Boolean(options.overwrite),
    backupDir,
  });

  // Cua thoat cho truong hop Google that su khong tra ve ket qua nao: cho phep
  // CSV rong di qua quality gate thay vi lam hong ca run.
  //
  // NHUNG page 1 rong ma page 2 co ket qua la mau thuan - Google khong the tra ve
  // 0 ket qua o start=0 roi 10 ket qua o start=10. Gap the thi gan nhu chac chan
  // la loi trich xuat, khong phai Google. Dong cua thoat lai de quality gate bao
  // that to, thay vi bao "thanh cong" kem mot file CSV rong.
  const page1Rows = state.counts.serp_page_1_rows ?? 0;
  const page2Rows = state.counts.serp_page_2_rows ?? 0;
  const contradictoryEmptyPage1 = page1Rows === 0 && page2Rows > 0;

  if (contradictoryEmptyPage1) {
    logger.error(
      `Page 1 khong co ket qua nao trong khi Page 2 co ${page2Rows}. Day la mau thuan, `
      + 'nhieu kha nang selector cua native extractor da lech so voi layout hien tai cua Google. '
      + 'Chay lai voi --capture-dom de chup DOM that ra logs\\<run_id>\\dom-snapshots\\.',
      { code: WARNING_CODES.SERP_EMPTY_PAGE, page1Rows, page2Rows },
    );
  }

  const allowEmptyCsv = page1Rows === 0
    && state.warnings.includes(WARNING_CODES.SERP_EMPTY_PAGE)
    && !contradictoryEmptyPage1;

  const validation = validateRun({
    dir: state.outputDir,
    base: state.base,
    prompt: state.prompt,
    allowEmptyCsv,
  });

  if (!validation.ok) {
    logger.error('Quality gate that bai:', { problems: validation.problems });
    throw new AppError(
      'OUTPUT_VALIDATION_FAILED',
      `Kiem tra dau ra that bai:\n- ${validation.problems.join('\n- ')}`,
      { details: { problems: validation.problems } },
    );
  }

  const warnings = dedupeWarnings([...state.warnings, ...logger.warnings.map((w) => w.code)]);
  const strictSelectors = config.logging?.strict_selectors === true;
  const bySeverity = groupBySeverity(warnings, { strictSelectors });
  // v2.0: canh bao muc INFO (dung fallback nhung du lieu van dung) KHONG lam ban status.
  const status = (bySeverity.WARN.length || bySeverity.ERROR.length)
    ? 'COMPLETED_WITH_WARNINGS'
    : 'SUCCESS';
  const completedAt = new Date();

  const manifestPath = writeManifest(path.join(config.output.logs_root, state.runId), buildManifest({
    runId: state.runId,
    keyword: state.keyword,
    prompt: state.prompt,
    config,
    startedAt: state.startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    status,
    sources: state.sources,
    counts: state.counts,
    selectorVersions: collectSelectorVersions(state.selectors),
    files: files.map((f) => path.basename(f)),
    outputDir: state.outputDir,
    folderBase: state.folderBase,
    warnings: logger.warnings,
    extensions: summariseExtensions(state.extensions),
    chromeVersion: state.chromeVersion,
    engine: state.engine ?? null,
    mode: state.parallel ? 'parallel' : 'sequential',
    severity: bySeverity,
  }));

  cleanStaging(state.stagingDir, options.keepStaging);

  const markdownPath = files.find((f) => f.endsWith('.md'));
  const summary = {
    status,
    keyword: state.keyword,
    outputDir: state.outputDir,
    counts: state.counts,
    durationMs: completedAt - state.startedAt,
    warnings,
    severity: bySeverity,
  };

  if (options.notify !== false) notify(config, summary, logger);
  if (options.openResult !== false && config.notifications?.open_result !== false) {
    openInEditor(markdownPath, config, logger);
  }

  return {
    status,
    outputDir: state.outputDir,
    markdownPath,
    counts: state.counts,
    sources: state.sources,
    warnings,
    severity: bySeverity,
    manifestPath,
    logDir: path.join(config.output.logs_root, state.runId),
    files,
    durationMs: summary.durationMs,
  };
}

/* --------------------------------------------------------- Gom ket qua */

function setAiResult(state, value) {
  state.ai = value ?? {
    markdown: '> Khong lay duoc AI Mode do loi ky thuat. Xem log de biet chi tiet.',
    source: 'none', warnings: [WARNING_CODES.AI_MODE_UNAVAILABLE], chars: 0,
  };
  state.sources.ai = state.ai.source;
  state.counts.ai_chars = state.ai.chars ?? 0;
  state.warnings.push(...(state.ai.warnings ?? []));
}

function setKeywordIdeas(state, value) {
  const v = value ?? { items: [], source: 'none', warnings: [WARNING_CODES.AHREFS_KEYWORD_IDEAS_UNAVAILABLE] };
  state.keywordIdeas = v.items;
  state.sources.keyword_ideas = v.source;
  state.counts.keyword_ideas = v.items.length;
  state.warnings.push(...(v.warnings ?? []));
}

function setPaa(state, value) {
  const v = value ?? { items: [], source: 'none', warnings: [WARNING_CODES.PAA_NOT_FOUND] };
  state.paa = v.items;
  state.sources.paa = v.source;
  state.counts.paa = v.items.length;
  state.warnings.push(...(v.warnings ?? []));
}

function setSuggestions(state, value) {
  const v = value ?? { items: [], source: 'none', warnings: [WARNING_CODES.SUGGESTIONS_NOT_FOUND] };
  state.suggestions = v.items;
  state.sources.suggestions = v.source;
  state.counts.suggestions = v.items.length;
  state.warnings.push(...(v.warnings ?? []));
}

function setPage1(state, value) {
  const v = value ?? { csvText: '', source: 'none', rowCount: 0, warnings: [WARNING_CODES.SERP_EMPTY_PAGE] };
  state.csvPage1 = v.csvText;
  state.sources.serp_page_1 = v.source;
  state.counts.serp_page_1_rows = v.rowCount;
  state.warnings.push(...(v.warnings ?? []));
}

function setPage2(state, value, opts = {}) {
  const v = value ?? { csvText: '', source: 'none', rowCount: 0, warnings: [WARNING_CODES.SERP_EMPTY_PAGE] };
  state.csvPage2 = v.csvText;
  state.sources.serp_page_2 = v.source;
  state.counts.serp_page_2_rows = v.rowCount;
  state.warnings.push(...(v.warnings ?? []));
  // Chi danh so lai CSV canonical do tool tu sinh, khong dung vao CSV goc cua extension
  state.page2NeedsRenumber = Boolean(opts.needsRenumber) && v.source === 'native_serp_dom';
}

/** Nhom nao that bai hoan toan thi van phai co gia tri mac dinh de ghi file. */
function applyDefaultsForMissingBlocks(state) {
  if (!state.ai) setAiResult(state, null);
  if (!state.keywordIdeas) setKeywordIdeas(state, null);
  if (!state.paa) setPaa(state, null);
  if (!state.suggestions) setSuggestions(state, null);
  if (state.csvPage1 == null) setPage1(state, null);
  if (state.csvPage2 == null) setPage2(state, null);
}

/* ------------------------------------------------------------- Ho tro chung */

async function newTab(state) {
  const page = await state.context.newPage();
  state.extraPages.push(page);
  try {
    if (state.config.browser?.viewport) await page.setViewportSize(state.config.browser.viewport);
  } catch { /* CDP tu quan ly kich thuoc */ }
  return page;
}

async function closeTab(state, page) {
  state.extraPages = state.extraPages.filter((p) => p !== page);
  if (page && !page.isClosed()) await page.close().catch(() => {});
}

async function closeExtraTabs(state) {
  for (const page of state.extraPages ?? []) {
    if (page && !page.isClosed()) await page.close().catch(() => {});
  }
  state.extraPages = [];
}

function assertPage2Url(state, page) {
  const expected = state.config.search.results_per_page ?? 10;
  const check = verifySerpUrl(page.url(), { start: expected });
  if (!check.ok) {
    throw new AppError(
      'SERP_NAVIGATION_FAILED',
      `URL Page 2 khong dung: ${check.mismatches.join('; ')}`,
      { retryable: true },
    );
  }
}

/** Chay mot step co retry + pause thu cong cho login/CAPTCHA. */
async function runStep(state, name, fn) {
  const { config, logger } = state;
  return withRetry(name, async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ManualActionRequired) {
        const handled = await handleManualPause(state, err);
        if (handled) return fn();
      }
      throw err;
    }
  }, {
    retries: config.recovery?.retries_per_step ?? 2,
    backoff: config.recovery?.backoff_ms ?? [2000, 5000],
    logger,
    onError: async () => {
      if (config.recovery?.save_screenshot_on_error !== false) {
        await logger.screenshot(state.page, `error-${name}`);
      }
    },
  });
}

/**
 * Pause co kiem soat - KHONG BAO GIO tu bypass CAPTCHA.
 * Duoc bao ve bang mutex de o che do song song khong hien nhieu prompt cung luc;
 * neu mot tab khac vua xu ly xong thi cac tab con lai chi can thu lai.
 */
async function handleManualPause(state, err) {
  const { config, logger } = state;
  const isCaptcha = err.code === 'MANUAL_CAPTCHA_REQUIRED';
  const allowed = isCaptcha
    ? config.recovery?.pause_for_manual_captcha !== false
    : config.recovery?.pause_for_manual_login !== false;

  if (!allowed || !isInteractive()) {
    logger.error(`${err.code}: can thao tac tay nhung dang chay o che do khong tuong tac.`);
    return false;
  }

  return state.pauseLock.run(async () => {
    const recentlyResolved = state.lastPauseResolvedAt
      && Date.now() - state.lastPauseResolvedAt < 30000;
    if (recentlyResolved) {
      logger.info('Mot tab khac vua xu ly xong thao tac tay, thu lai ngay.');
      return true;
    }

    logger.warn(err.message, { code: err.code });
    process.stdout.write(
      '\n============================================================\n' +
      `  CAN THAO TAC TAY: ${err.code}\n` +
      `  ${err.message}\n` +
      '  Hay xu ly trong cua so Chrome dang mo, sau do nhan Enter.\n' +
      '============================================================\n',
    );

    const resumed = await waitForEnter(
      'Nhan Enter de tiep tuc...',
      config.recovery?.manual_pause_timeout_ms ?? 600000,
    );
    if (!resumed) {
      logger.error('Het thoi gian cho thao tac tay.');
      return false;
    }
    state.lastPauseResolvedAt = Date.now();
    logger.info('Nguoi dung da xu ly xong, tiep tuc tu step dang dung.');
    return true;
  });
}

/**
 * In ro noi chua snapshot va mo thu muc do - nguoi dung khong phai di tim
 * trong logs\<run_id>\ nua.
 */
function announceCapture(state, reportPath, options) {
  const dir = state.capture.snapshotDir;
  const bar = '============================================================';
  process.stdout.write([
    '',
    bar,
    '  DA CHUP DOM',
    bar,
    `  Thu muc  : ${dir}`,
    `  Bao cao  : ${reportPath}`,
    '',
    '  Mo file selector-candidates.md de lay selector de xuat.',
    bar,
    '',
    '',
  ].join('\n'));

  if (options?.openResult !== false && state.config.notifications?.open_result !== false) {
    openFolder(dir, state.logger);
    openInEditor(reportPath, state.config, state.logger);
  }
}


/** Nhom selector dung lam diem vao khi chup tung block. */
function captureSelectorsFor(selectors, block) {
  const b = selectors[block] ?? {};
  if (block === 'native_serp') return b.result_containers ?? [];
  return (b.container ?? []).filter((s) => s?.type === 'css' && s.css).map((s) => s.css);
}

function dedupeWarnings(list) {
  return Array.from(new Set((list ?? []).filter(Boolean)));
}

function summariseExtensions(extensions) {
  const out = {};
  for (const [key, meta] of Object.entries(extensions ?? {})) {
    out[key] = {
      id: meta.id,
      installed: meta.installed,
      version: meta.version ?? null,
      profile: meta.profileDir ?? null,
    };
  }
  return out;
}
