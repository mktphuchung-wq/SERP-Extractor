/**
 * Orchestrator: state machine cap run, dieu phoi toan bo workflow Step 0 -> Step 10.
 *
 * Workflow co dinh theo phu thuoc cua giao dien that:
 *   Suggestions -> Ahrefs Keywords Ideas -> Ahrefs PAA -> 2 CSV
 *   -> AI Overview Page 1 -> Show more -> Prompt -> Copy answer.
 *
 * Ahrefs va AI cung dung clipboard va tab dang active. Chay theo phase giup
 * khong doc nham clipboard, khong mat focus va khong lam thay doi DOM truoc
 * khi phase truoc da hoan tat.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  AppError, ManualActionRequired, WARNING_CODES, groupBySeverity, SEVERITY,
} from './core/errors.mjs';
import { RunLogger } from './core/logger.mjs';
import { buildRunId, sanitizeFileBase, resolveOutputDir, timestampStamp } from './core/sanitize.mjs';
import { withRetry, softly, humanDelay } from './core/retry.mjs';
import { waitForEnter, isInteractive } from './core/prompt.mjs';
import { Mutex, NO_LOCK } from './core/mutex.mjs';

import { startEngine, ENGINES } from './engine/index.mjs';
import { discoverLive } from './engine/live-extensions.mjs';
import { discoverEffective } from './browser/bundled-extensions.mjs';
import {
  normalizeCapability, summariseCapability, describeCapability, markObserved,
  isUsable, isDefinitelyMissing, OBSERVED_BY,
} from './engine/capability.mjs';
import { createCapture, NO_CAPTURE } from './browser/dom-capture.mjs';
import { createSelectorMemory } from './browser/selector-memory.mjs';

import { buildSearchUrl, openSerp, verifySerpUrl } from './adapters/google-search.mjs';
import { collectAiAnswer } from './adapters/ai-mode.mjs';
import { collectKeywordIdeas, verifyUsMarket } from './adapters/ahrefs-widget.mjs';
import { collectPaa } from './adapters/paa.mjs';
import { collectSuggestions } from './adapters/suggestions.mjs';
import { collectSerpCsv, nextPagePositionOffset } from './adapters/serp-export.mjs';

import { areCsvIdentical } from './extractors/csv-normalizer.mjs';
import { buildMarkdown } from './output/markdown-builder.mjs';
import { writeStagingArtifacts, moveToOutput, cleanStaging } from './output/artifact-writer.mjs';
import { validateRun } from './output/validator.mjs';
import { buildManifest, writeManifest, collectSelectorVersions } from './output/manifest.mjs';
import { notify, notifyFailure, openInEditor, openFolder } from './output/notifier.mjs';

const STEPS_SEQUENTIAL = 8;
const ORDERED_COLLECTION_STEPS = Object.freeze([
  { name: 'suggestions', run: stepSuggestions },
  { name: 'ahrefs-keyword-ideas', run: stepKeywordIdeas },
  { name: 'ahrefs-paa', run: stepPaa },
  { name: 'serp-page-1-and-page-2', run: stepSerpPages },
  { name: 'ai-overview-page-1', run: stepAi },
]);
export const WORKFLOW_PHASES = Object.freeze(ORDERED_COLLECTION_STEPS.map((phase) => phase.name));

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
  logger.info('Che do: TUAN TU CO DINH (Suggestions -> Ahrefs -> 2 CSV -> AI Overview)');
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
    totalSteps: STEPS_SEQUENTIAL,
    pauseLock: new Mutex('manual-pause'),
    // Bo nho selector dung chung ca run: selector nao da thang thi lan sau thu
    // truoc, khong duyet lai tu dau (dac ta Fast Path v1 - P0).
    selectorMemory: createSelectorMemory(),
    // Widget Ahrefs resolve mot lan, dung cho Keywords Ideas / PAA / country.
    ahrefsCache: {},
    timings: {},
    aiSubmission: null,
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
    await timed(state, 'start-browser', () => stepStartBrowser(state, (s) => { engineSession = s; }, options));
    await timed(state, 'open-serp', () => stepOpenSerp(state));

    for (const phase of ORDERED_COLLECTION_STEPS) {
      // eslint-disable-next-line no-await-in-loop
      await timed(state, phase.name, () => phase.run(state));
    }

    return await timed(state, 'write-and-validate', () => stepWriteAndValidate(state, options));
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
      stageTimings: state.timings,
      fallbacks: state.selectorMemory.fallbacks(),
      aiSubmission: state.aiSubmission,
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
    // close() cua engine chi dong nhung tab do tool mo va ngat cau noi.
    // Voi engine bridge, trinh duyet cua nguoi dung KHONG bi dong.
    if (engineSession) await engineSession.close().catch(() => {});
    await logger.close();
  }
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

  // Moi ban ghi ve cung mot hinh dang tristate (dac ta Fast Path v1 - P0).
  for (const [key, meta] of Object.entries(state.extensions)) {
    state.extensions[key] = normalizeCapability({
      ...meta,
      required: meta.required === true || config.extensions?.[key]?.required === true,
    });
  }

  const howToFix = session.engine === ENGINES.BRIDGE
    ? 'Cai/bat extension trong chinh Chrome nay roi chay lai'
    : 'Chay INSTALL.bat de cai lai, hoac cai tay tai';
  for (const [key, meta] of Object.entries(state.extensions)) {
    const name = meta.name ?? meta.configuredName;
    if (isUsable(meta)) {
      const where = { bundled: 'dong goi san', live: 'trinh duyet cua ban' }[meta.source]
        ?? (meta.profileDir ? `profile: ${meta.profileDir}` : meta.observed_by);
      logger.info(`Extension OK: ${name}${meta.version ? ` v${meta.version}` : ''} [${where}]`);
      continue;
    }
    if (isDefinitelyMissing(meta)) {
      // CHI truong hop nay moi la bang chung that su "chua cai / dang tat".
      logger.warn(
        `Khong dung duoc extension "${meta.configuredName ?? name}" (${meta.id}): `
        + `${meta.reason}. ${howToFix}: ${meta.webstore}`,
        { code: WARNING_CODES.EXTENSION_MISSING, extension: key, reason: meta.reason },
      );
      continue;
    }
    // KHONG doc duoc trang chrome-extension:// thi ta khong biet gi ca. Truoc day
    // cho nay ghi NOT_IN_RUNNING_BROWSER + EXTENSION_MISSING cho ca ba extension,
    // trong khi widget Ahrefs van chay binh thuong ngay sau do
    // (run that 20260827-171404). Ket luan am tinh gia -> chi ghi INFO.
    logger.info(
      `Extension "${meta.configuredName ?? name}": ${describeCapability(meta)}. `
      + (meta.detect === 'widget'
        ? 'Se xac minh bang chinh widget tren SERP.'
        : 'Workflow dung nguon thay the (DOM/endpoint) neu can.'),
    );
  }

  const missingRequired = Object.values(state.extensions)
    .filter((m) => m.required && isDefinitelyMissing(m));
  if (options.requireExtensions && missingRequired.length) {
    throw new AppError('EXTENSION_MISSING', 'Thieu extension bat buoc. Chay RUN.bat va cai dat khi duoc hoi.');
  }
}

/** Do thoi gian tung stage de dua vao manifest (P1 - quan sat hieu nang). */
async function timed(state, name, fn) {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    state.timings[name] = (state.timings[name] ?? 0) + (Date.now() - startedAt);
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

  // Country cua Ahrefs KHONG duoc kiem tra o day nua: luc nay widget chua render
  // nen ket luan luon la "khong doc duoc" (run that 20260827-171404 -> canh bao
  // AHREFS_REGION_NOT_VERIFIED gan nhu tat yeu). Kiem tra da doi xuong buoc
  // Ahrefs, sau khi widget resolve xong (dac ta Fast Path v1 - P1).
  logger.info(
    `google_market=${config.search.country} verified_by=url_params `
    + `(hl=${config.search.language}, pws=${config.search.personalization ? 1 : 0})`,
  );
  state.sources.google_market = config.search.country;
  state.sources.google_market_verified_by = 'url_params';
  state.sources.market_verified = false;
  state.sources.ahrefs_market = 'unknown';
}

/* ---------------------------------------------- Step 3-7 (che do tuan tu) */
async function stepAi(state) {
  const { logger } = state;
  logger.step(7, state.totalSteps, 'AI Overview Page 1: Show more -> Prompt -> Copy answer...');

  // AI luon la phase cuoi va luon bat dau tu Page 1 sach. Truoc do tab dang o
  // Page 2 va da qua cac tuong tac Ahrefs/Suggestions.
  await runStep(state, 'reopen-page-1-for-ai', async () => {
    await openSerp(state.page, state.page1Url, state);
  });

  const result = await softly('ai-mode', () => collectAiAnswer({
    page: state.page,
    config: state.config,
    selectors: state.selectors,
    logger,
    keyword: state.keyword,
    prompt: state.prompt,
    memory: state.selectorMemory,
  }), logger);
  setAiResult(state, result.value);

}

async function stepKeywordIdeas(state) {
  const { logger } = state;
  logger.step(4, state.totalSteps, 'Thu thap Keywords Ideas tu Ahrefs...');
  const result = await softly('keyword-ideas', () => collectKeywordIdeas({
    page: state.page, config: state.config, selectors: state.selectors, logger, lock: NO_LOCK,
    memory: state.selectorMemory, cache: state.ahrefsCache,
  }), logger);
  setKeywordIdeas(state, result.value);

  // Widget da hien tren SERP la bang chung TRUC TIEP extension dang chay - manh
  // hon moi ket qua probe chrome-extension:// (dac ta Fast Path v1 - P0).
  if (state.ahrefsCache.widget && state.extensions.ahrefs) {
    state.extensions.ahrefs = markObserved(
      state.extensions.ahrefs, OBSERVED_BY.WIDGET, 'AHREFS_WIDGET_VISIBLE',
    );
    logger.info('Xac nhan Ahrefs SEO Toolbar dang hoat dong (thay widget tren SERP).');
  }

  await verifyAhrefsMarket(state);
  await humanDelay(state.config, logger);
}

/**
 * Country cua Ahrefs - chi kiem tra MOT LAN va chi khi widget da san sang.
 * Log tach bach hai thi truong de khong con lan lon:
 *   google_market : do URL params quyet dinh, luon xac minh duoc
 *   ahrefs_market : trang thai noi bo cua toolbar, co the khong doc duoc
 */
async function verifyAhrefsMarket(state, opts = {}) {
  const { logger, selectors } = state;
  if (state.marketChecked) return;

  const widget = state.ahrefsCache.widget ?? null;
  // Chua co widget va van con buoc Ahrefs phia sau -> de lan sau kiem tra.
  if (!widget && !opts.final) return;
  state.marketChecked = true;
  const market = await softly(
    'ahrefs-us-market',
    () => verifyUsMarket(state.page, selectors, logger, { widget }),
    logger,
  );
  const value = market.value ?? {};
  if (value.warning) state.warnings.push(value.warning);
  state.sources.market_verified = Boolean(value.verified);
  state.sources.ahrefs_market = value.market ?? 'unknown';
  logger.info(`ahrefs_market=${state.sources.ahrefs_market}`);
}

async function stepPaa(state) {
  const { logger } = state;
  logger.step(5, state.totalSteps, 'Thu thap People Also Asked...');
  const result = await softly('paa', () => collectPaa({
    page: state.page, config: state.config, selectors: state.selectors, logger, lock: NO_LOCK,
    memory: state.selectorMemory, cache: state.ahrefsCache,
  }), logger);
  setPaa(state, result.value);
  await verifyAhrefsMarket(state, { final: true });
  await humanDelay(state.config, logger);
}

async function stepSuggestions(state) {
  const { logger } = state;
  logger.step(3, state.totalSteps, 'Thu thap Google Search Suggestions truoc tien...');
  const result = await softly('suggestions', () => collectSuggestions({
    page: state.page,
    config: state.config,
    selectors: state.selectors,
    logger,
    extensions: state.extensions,
    keyword: state.keyword,
    lock: NO_LOCK,
    capture: state.capture,
    memory: state.selectorMemory,
  }), logger);
  setSuggestions(state, result.value);
  await humanDelay(state.config, logger);
}

async function stepSerpPages(state) {
  const { config, logger } = state;
  logger.step(6, state.totalSteps, 'Xuat du 2 CSV Page 1 va Page 2...');
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
  setPage2(state, page2);
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

  // Quality gate chay tren staging. Output cu chua bi dong toi neu du lieu moi hong.
  const validation = validateRun({
    dir: state.stagingDir,
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

  const backupDir = path.join(config.output.logs_root, state.runId, 'output-backup');
  const files = moveToOutput({
    files: [staged.md, staged.csv1, staged.csv2],
    outputDir: state.outputDir,
    overwrite: Boolean(options.overwrite),
    backupDir,
  });

  const warnings = dedupeWarnings([...state.warnings, ...logger.warnings.map((w) => w.code)]);
  const strictSelectors = config.logging?.strict_selectors === true;
  const bySeverity = groupBySeverity(warnings, { strictSelectors });
  // v2.0: canh bao muc INFO (dung fallback nhung du lieu van dung) KHONG lam ban status.
  // Fast Path v1 (P1): tach rieng PARTIAL de doc mot dong la biet bundle hop le
  // nhung MAT han mot section (AI / Ahrefs / PAA), khac han "co canh bao nhe".
  const status = statusOf(bySeverity);
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
    mode: 'sequential',
    severity: bySeverity,
    stageTimings: state.timings,
    fallbacks: state.selectorMemory.fallbacks(),
    aiSubmission: state.aiSubmission,
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
  state.aiSubmission = state.ai.submission ?? null;
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

function setPage2(state, value) {
  const v = value ?? { csvText: '', source: 'none', rowCount: 0, warnings: [WARNING_CODES.SERP_EMPTY_PAGE] };
  state.csvPage2 = v.csvText;
  state.sources.serp_page_2 = v.source;
  state.counts.serp_page_2_rows = v.rowCount;
  state.warnings.push(...(v.warnings ?? []));
}

/* ------------------------------------------------------------- Ho tro chung */

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

/**
 * SUCCESS  - moi section co du lieu, khong co canh bao WARN/ERROR nao.
 * PARTIAL  - bundle hop le nhung mat AI/Ahrefs/PAA (co canh bao muc ERROR).
 * COMPLETED_WITH_WARNINGS - du lieu con du, chi co canh bao muc WARN.
 * FAILED   - nem o nhanh catch cua runWorkflow (output/nguon bat buoc khong hop le).
 */
export function statusOf(bySeverity) {
  if (bySeverity.ERROR?.length) return 'PARTIAL';
  if (bySeverity.WARN?.length) return 'COMPLETED_WITH_WARNINGS';
  return 'SUCCESS';
}

function summariseExtensions(extensions) {
  const out = {};
  for (const [key, meta] of Object.entries(extensions ?? {})) {
    out[key] = summariseCapability(meta);
  }
  return out;
}
