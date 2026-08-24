#!/usr/bin/env node
/**
 * CLI cho Auto SERP Research Collector.
 * RUN.bat la launcher duy nhat: tu lo phan cai dat lan dau roi chay tiep.
 * SETUP.bat / DIAGNOSE.bat chi la loi tat vao cung CLI nay.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { loadConfig, loadSelectors } from './core/config.mjs';
import { toExitCode, EXIT_CODES, describeError } from './core/errors.mjs';
import { ask, isInteractive } from './core/prompt.mjs';
import { parseKeywordList, parsePromptList, pairKeywordsAndPrompts } from './core/input.mjs';
import { timestampStamp, slugify } from './core/sanitize.mjs';
import { runWorkflow } from './orchestrator.mjs';
import { findChrome, probeDebugger, defaultChromeProfileDirs, isBundledChrome } from './browser/chrome-launcher.mjs';
import { findInPersonalChrome } from './browser/extension-discovery.mjs';
import { discoverEffective, verifyBundle } from './browser/bundled-extensions.mjs';
import { openInEditor } from './output/notifier.mjs';
import { ensureReady, runFirstTimeSetup, checkSetup, writeSetupMarker } from './setup.mjs';

const HELP = `
AUTO SERP RESEARCH COLLECTOR

Cach dung:
  RUN.bat "<keyword>" "<ai prompt>"
  RUN.bat "<keyword>"                       (dung prompt template trong config)
  RUN.bat "kw 1; kw 2; kw 3"                (nhieu tu khoa -> nhieu thu muc output)
  RUN.bat "kw 1; kw 2" "prompt 1; prompt 2" (ghep prompt theo thu tu)
  RUN.bat                                   (che do hoi dap)

Tham so:
  --config <file>       Dung file cau hinh khac (mac dinh config/default.yaml)
  --overwrite           Cho phep ghi de thu muc ket qua da ton tai (co backup)
  --sequential          Tat che do chay song song (chay lan luot tung buoc)
  --parallel            Bat che do chay song song (mac dinh da bat)
  --no-open             Khong tu mo file ket qua bang Notepad
  --capture-dom[=a,b]   Chup DOM that cua tung block ra logs\<run_id>\dom-snapshots\
                        de soan selector tu bang chung (kem bao cao de xuat)
                        de soan selector tu bang chung (kem bao cao de xuat)
                        de soan selector tu bang chung (kem bao cao de xuat)
  --setup               Chay rieng phan cai dat lan dau roi thoat
  --skip-setup          Bo qua buoc kiem tra cai dat
  --require-extensions  Dung ngay neu thieu extension
  --keep-staging        Giu thu muc staging sau khi chay xong
  --verbose             Log chi tiet
  --no-interactive      Khong hoi dap, khong pause cho login/CAPTCHA
  --diagnose            Kiem tra moi truong roi thoat
  --check-setup         Kiem tra ba extension da cai chua roi thoat
  --help                Hien thi tro giup

Exit code: 0 thanh cong | 1 input/config | 2 chrome/profile/extension
           3 consent/login | 4 captcha | 5 AI | 6 SERP/download
           7 validation | 8 khong xac dinh
`;

export function parseArgs(argv) {
  const out = { positional: [], options: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.options.help = true;
    else if (arg === '--diagnose') out.options.diagnose = true;
    else if (arg === '--check-setup') out.options.checkSetup = true;
    else if (arg === '--setup') out.options.setup = true;
    else if (arg === '--skip-setup') out.options.skipSetup = true;
    else if (arg === '--overwrite') out.options.overwrite = true;
    else if (arg === '--verbose') out.options.verbose = true;
    else if (arg === '--keep-staging') out.options.keepStaging = true;
    else if (arg === '--require-extensions') out.options.requireExtensions = true;
    else if (arg === '--no-interactive') out.options.interactive = false;
    else if (arg === '--sequential') out.options.parallel = false;
    else if (arg === '--parallel') out.options.parallel = true;
    else if (arg === '--no-open') out.options.openResult = false;
    else if (arg === '--capture-dom') out.options.captureDom = true;
    else if (arg.startsWith('--capture-dom=')) {
      out.options.captureDom = arg.slice('--capture-dom='.length).split(',').map((s) => s.trim()).filter(Boolean);
    }
    else if (arg === '--config') { out.options.configPath = argv[i + 1]; i += 1; }
    else if (arg.startsWith('--config=')) out.options.configPath = arg.slice('--config='.length);
    else if (arg.startsWith('--')) out.options.unknown = (out.options.unknown ?? []).concat(arg);
    else out.positional.push(arg);
  }
  return out;
}

/** Dung prompt tu template khi nguoi dung chi nhap keyword. */
export function resolvePrompt(explicit, keyword, config) {
  const value = String(explicit ?? '').trim();
  if (value) return value;
  const template = config.ai?.prompt_template ?? 'Analyze the search topic "{{keyword}}".';
  return template.replace(/\{\{\s*keyword\s*\}\}/g, keyword);
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(HELP);
    return EXIT_CODES.SUCCESS;
  }

  let config;
  try {
    config = loadConfig({ configPath: options.configPath });
  } catch (err) {
    process.stderr.write(`${describeError(err)}\n`);
    return toExitCode(err);
  }

  if (options.diagnose) return diagnose(config);
  if (options.checkSetup) return reportSetup(config);

  const interactive = options.interactive !== false && isInteractive();

  if (options.setup) {
    const state = await runFirstTimeSetup(config, { verbose: options.verbose });
    return state.complete ? EXIT_CODES.SUCCESS : EXIT_CODES.BROWSER_SETUP;
  }

  let keywordInput = positional[0];
  let promptInput = positional[1];

  if (!keywordInput) {
    if (!interactive) {
      process.stderr.write('[INVALID_INPUT] Thieu keyword. Dung: RUN.bat "keyword" "ai prompt"\n');
      return EXIT_CODES.INVALID_INPUT;
    }
    process.stdout.write('\nAUTO SERP RESEARCH COLLECTOR\n\n');
    process.stdout.write('Meo: nhap nhieu tu khoa ngan cach bang dau ";" de tao nhieu thu muc ket qua.\n');
    process.stdout.write('     Vi du: Filipino vs Samoan; Father\'s Day Outfit Ideas\n\n');
    keywordInput = await ask('Keyword: ');
    promptInput = await ask('AI prompt (Enter de dung template mac dinh): ');
  }

  const keywords = parseKeywordList(keywordInput);
  if (!keywords.length) {
    process.stderr.write('[INVALID_INPUT] Keyword khong duoc de trong.\n');
    return EXIT_CODES.INVALID_INPUT;
  }

  const jobs = pairKeywordsAndPrompts(
    keywords,
    parsePromptList(promptInput),
    (keyword) => resolvePrompt('', keyword, config),
  );

  // Cong setup: lan dau tu dong cai dat, cac lan sau im lang di qua
  try {
    await ensureReady(config, {
      interactive,
      skipSetup: options.skipSetup,
      requireExtensions: options.requireExtensions,
      verbose: options.verbose,
    });
  } catch (err) {
    process.stderr.write(`\n${describeError(err)}\n`);
    return toExitCode(err);
  }

  const selectors = loadSelectors();
  const runOptions = {
    overwrite: options.overwrite,
    verbose: options.verbose,
    keepStaging: options.keepStaging,
    requireExtensions: options.requireExtensions,
    parallel: options.parallel,
    captureDom: options.captureDom,
    openResult: options.openResult,
    interactive,
  };

  if (jobs.length === 1) {
    process.stdout.write(`\nKeyword:   ${jobs[0].keyword}\nAI prompt: ${jobs[0].prompt}\n\n`);
    try {
      const result = await runWorkflow({ ...jobs[0], config, selectors, options: runOptions });
      process.stdout.write(`Log: ${result.logDir}\n`);
      return EXIT_CODES.SUCCESS;
    } catch (err) {
      process.stderr.write(`\n${describeError(err)}\n`);
      if (options.verbose && err.stack) process.stderr.write(`${err.stack}\n`);
      return toExitCode(err);
    }
  }

  return runBatch(jobs, { config, selectors, runOptions, options });
}

/**
 * Chay nhieu tu khoa TUAN TU tren cung mot profile.
 * Mot tu khoa loi khong lam dung ca hang doi; cuoi cung in bang tong ket.
 */
async function runBatch(jobs, ctx) {
  const { config, selectors, runOptions, options } = ctx;
  const startedAt = new Date();

  process.stdout.write(`\n${jobs.length} tu khoa se chay lan luot:\n`);
  jobs.forEach((job, i) => process.stdout.write(`  ${i + 1}. ${job.keyword}\n`));
  process.stdout.write('\n');

  const results = [];
  for (const [index, job] of jobs.entries()) {
    process.stdout.write(
      `\n============================================================\n` +
      `  [${index + 1}/${jobs.length}] ${job.keyword}\n` +
      `============================================================\n`,
    );
    try {
      const result = await runWorkflow({
        ...job,
        config,
        selectors,
        // Trong batch khong mo Notepad tung file - se mo mot file tong ket o cuoi
        options: { ...runOptions, openResult: false },
      });
      results.push({
        keyword: job.keyword, status: result.status, outputDir: result.outputDir,
        counts: result.counts, warnings: result.warnings, durationMs: result.durationMs,
        exitCode: EXIT_CODES.SUCCESS,
      });
    } catch (err) {
      process.stderr.write(`\n${describeError(err)}\n`);
      results.push({
        keyword: job.keyword, status: 'FAILED', error: describeError(err),
        exitCode: toExitCode(err),
      });
    }
  }

  const summaryPath = writeBatchSummary(results, config, startedAt);
  printBatchSummary(results, summaryPath);

  if (options.openResult !== false && config.notifications?.open_batch_summary !== false) {
    openInEditor(summaryPath, config, null);
  }

  const failed = results.filter((r) => r.exitCode !== EXIT_CODES.SUCCESS);
  return failed.length ? failed[0].exitCode : EXIT_CODES.SUCCESS;
}

function printBatchSummary(results, summaryPath) {
  process.stdout.write('\n============================================================\n');
  process.stdout.write('  TONG KET\n');
  process.stdout.write('============================================================\n');
  for (const r of results) {
    const mark = r.status === 'FAILED' ? '[LOI ]' : r.status === 'SUCCESS' ? '[  OK]' : '[CANH]';
    process.stdout.write(`${mark} ${r.keyword}\n`);
    if (r.status === 'FAILED') {
      process.stdout.write(`       ${r.error}\n`);
    } else {
      process.stdout.write(`       ${r.outputDir}\n`);
      process.stdout.write(
        `       AI ${r.counts?.ai_chars ?? 0} ky tu | Ideas ${r.counts?.keyword_ideas ?? 0} | ` +
        `PAA ${r.counts?.paa ?? 0} | Suggestions ${r.counts?.suggestions ?? 0} | ` +
        `P1 ${r.counts?.serp_page_1_rows ?? 0} | P2 ${r.counts?.serp_page_2_rows ?? 0}\n`,
      );
    }
  }
  const ok = results.filter((r) => r.exitCode === EXIT_CODES.SUCCESS).length;
  process.stdout.write(`\nThanh cong ${ok}/${results.length}. Tong ket: ${summaryPath}\n\n`);
}

/** Bao cao tong ket nam NGOAI cac thu muc ket qua (dac ta V1.1). */
function writeBatchSummary(results, config, startedAt) {
  const stamp = timestampStamp(startedAt);
  const dir = path.join(config.output.logs_root, `batch-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'batch-summary.json'),
    `${JSON.stringify({ started_at: startedAt.toISOString(), total: results.length, results }, null, 2)}\n`,
    'utf8',
  );

  const lines = [
    'TONG KET AUTO SERP RESEARCH COLLECTOR',
    `Bat dau: ${startedAt.toLocaleString()}`,
    `So tu khoa: ${results.length}`,
    '',
  ];
  for (const r of results) {
    lines.push(`[${r.status}] ${r.keyword}`);
    if (r.status === 'FAILED') {
      lines.push(`    Loi: ${r.error}`);
    } else {
      lines.push(`    Thu muc: ${r.outputDir}`);
      lines.push(
        `    AI ${r.counts?.ai_chars ?? 0} ky tu | Keywords Ideas ${r.counts?.keyword_ideas ?? 0} | ` +
        `PAA ${r.counts?.paa ?? 0} | Suggestions ${r.counts?.suggestions ?? 0} | ` +
        `Page 1 ${r.counts?.serp_page_1_rows ?? 0} dong | Page 2 ${r.counts?.serp_page_2_rows ?? 0} dong`,
      );
      if (r.warnings?.length) lines.push(`    Canh bao: ${r.warnings.join(', ')}`);
    }
    lines.push('');
  }
  const txtPath = path.join(dir, `batch-summary-${slugify('tong ket')}.txt`);
  fs.writeFileSync(txtPath, lines.join('\r\n'), 'utf8');
  return txtPath;
}

/** DIAGNOSE.bat: kiem tra Chrome, profile, extension, CDP port, quyen ghi. */
async function diagnose(config) {
  const lines = [];
  let hasError = false;
  const ok = (msg) => lines.push(`  [OK]   ${msg}`);
  const bad = (msg) => { hasError = true; lines.push(`  [LOI]  ${msg}`); };
  const warn = (msg) => lines.push(`  [CANH] ${msg}`);

  lines.push('\nKIEM TRA MOI TRUONG\n');

  const portableNode = path.join(config.paths?.project_root ?? '.', 'runtime', 'node', 'node.exe');
  if (fs.existsSync(portableNode)) ok(`Node.js ${process.version} (portable trong runtime\\node)`);
  else warn(`Node.js ${process.version} (Node he thong - chua co ban portable trong runtime\\node)`);

  let chromePath = null;
  try {
    chromePath = findChrome(config.browser.chrome_path);
    if (isBundledChrome(chromePath)) {
      const versionFile = path.join(path.dirname(path.dirname(chromePath)), 'VERSION');
      const cftVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '?';
      ok(`Chrome for Testing ${cftVersion}: ${chromePath}`);
    } else {
      warn(`Chrome he thong: ${chromePath}`);
      warn('  Ban chinh thuc BO QUA --load-extension -> extension trong vendor\\extensions khong duoc nap.');
      warn('  Chay INSTALL.bat de tai Chrome for Testing.');
    }
  } catch (err) {
    bad(err.message);
  }

  const bundle = verifyBundle(config);
  for (const entry of bundle.entries) {
    if (entry.ok) ok(`Bundle ${entry.configuredName} v${entry.version} (vendor\\extensions)`);
    else warn(`Bundle ${entry.configuredName} chua san sang: ${entry.reason}`);
  }

  const profile = config.browser.user_data_dir;
  const isDefaultProfile = defaultChromeProfileDirs().some(
    (dir) => path.resolve(dir).toLowerCase() === path.resolve(profile).toLowerCase(),
  );
  if (isDefaultProfile) bad(`user_data_dir dang tro toi profile Chrome mac dinh: ${profile}`);
  else if (fs.existsSync(profile)) ok(`Profile automation: ${profile}`);
  else warn(`Profile chua ton tai (se tao khi chay RUN.bat): ${profile}`);

  const port = config.browser.remote_debugging_port;
  const version = await probeDebugger(port);
  if (version) ok(`CDP cong ${port}: ${version.Browser}`);
  else warn(`CDP cong ${port} chua mo (binh thuong khi Chrome chua chay).`);

  const extensions = discoverEffective(config);
  const missingIds = [];
  for (const [key, meta] of Object.entries(extensions)) {
    if (meta.installed) {
      const where = meta.source === 'bundled'
        ? 'dong goi san, nap bang --load-extension'
        : `da cai trong profile: ${meta.profileDir}`;
      ok(`${meta.configuredName} v${meta.version} [${where}] (popup: ${meta.popupPath ?? 'khong co'})`);
    } else {
      warn(`Khong dung duoc ${meta.configuredName} [${key}] - ${meta.bundleReason ?? meta.reason}`);
      missingIds.push(meta.id);
    }
  }

  // Giai thich nham lan hay gap: da cai extension o Chrome thuong, chua cai o profile automation.
  if (missingIds.length && config.privacy?.hint_personal_chrome !== false) {
    const elsewhere = findInPersonalChrome(missingIds);
    const names = Object.fromEntries(
      Object.values(extensions).map((m) => [m.id, m.configuredName]),
    );
    for (const [id, profiles] of Object.entries(elsewhere)) {
      lines.push('');
      lines.push(`  [CHU Y] "${names[id] ?? id}" DA duoc cai trong Chrome ca nhan (${profiles.join(', ')})`);
      lines.push('         nhung CHUA co trong profile automation cua tool.');
      lines.push('         Hai profile tach biet nhau. Hay chay RUN.bat va cai extension');
      lines.push('         ngay trong cua so Chrome ma RUN.bat mo ra.');
    }
  }

  for (const dir of [config.output.root, config.output.logs_root, config.paths.staging_root]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.write-test-${Date.now()}`);
      fs.writeFileSync(probe, 'ok');
      fs.rmSync(probe);
      ok(`Ghi duoc: ${dir}`);
    } catch (err) {
      bad(`Khong ghi duoc ${dir}: ${err.message}`);
    }
  }

  lines.push('');
  lines.push(`  Che do chay: ${config.performance?.parallel_steps === false ? 'TUAN TU' : 'SONG SONG'}`);
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
  return hasError ? EXIT_CODES.BROWSER_SETUP : EXIT_CODES.SUCCESS;
}

/** Kiem tra nhanh 3 extension roi thoat (dung cho script/CI). */
function reportSetup(config) {
  const extensions = discoverEffective(config);
  const missing = Object.entries(extensions).filter(([, meta]) => !meta.installed);
  if (!missing.length) {
    const marker = path.join(config.browser.user_data_dir, 'auto-serp-setup.json');
    try {
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, JSON.stringify({
        'setup-completed': true,
        completed_at: new Date().toISOString(),
        extensions: Object.fromEntries(
          Object.entries(extensions).map(([k, v]) => [k, { id: v.id, version: v.version, profile: v.profileDir }]),
        ),
      }, null, 2), 'utf8');
    } catch { /* khong bat buoc */ }
    const sources = Object.values(extensions).map((m) => m.source);
    const bundled = sources.filter((s) => s === 'bundled').length;
    process.stdout.write(
      `\nDa co du ba extension (${bundled} dong goi san / ${sources.length - bundled} cai trong profile). `
      + 'setup-completed=true\n\n',
    );
    return EXIT_CODES.SUCCESS;
  }

  process.stdout.write('\nCON THIEU EXTENSION:\n');
  for (const [, meta] of missing) {
    process.stdout.write(`  - ${meta.configuredName} (${meta.bundleReason ?? meta.reason})\n    ${meta.webstore}\n`);
  }

  if (config.privacy?.hint_personal_chrome !== false) {
    const elsewhere = findInPersonalChrome(missing.map(([, m]) => m.id));
    if (Object.keys(elsewhere).length) {
      process.stdout.write(
        '\n  CHU Y: nhung extension nay DA co trong Chrome ca nhan cua ban,\n' +
        '  nhung profile automation la mot profile RIENG nen khong dung chung duoc.\n' +
        '  Hay cai lai ngay trong cua so Chrome ma SETUP.bat mo ra.\n',
      );
    }
  }

  process.stdout.write(
    '\nCach sua nhanh nhat: chay INSTALL.bat (tai lai Chrome for Testing va kiem tra\n'
    + 'lai vendor\\extensions). Neu van thieu, tren MAY DEV chay:\n'
    + '  node tools\\pack-extensions.mjs\n\n',
  );
  return EXIT_CODES.BROWSER_SETUP;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    process.stderr.write(`\n[UNEXPECTED_ERROR] ${err?.stack ?? err}\n`);
    process.exitCode = EXIT_CODES.UNKNOWN;
  });
