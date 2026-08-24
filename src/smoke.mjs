#!/usr/bin/env node
/**
 * Smoke test dinh ky (dac ta muc 15.4).
 * Chay mot keyword co dinh, ghi ket qua vao thu muc tam, KHONG dung output that.
 * Muc tieu: phat hien selector chinh da hong (du fallback van chay duoc).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadConfig, loadSelectors } from './core/config.mjs';
import { runWorkflow } from './orchestrator.mjs';
import { EXIT_CODES, describeError, toExitCode } from './core/errors.mjs';

const DEFAULT_KEYWORD = 'best running shoes';

/** Nguon nao la fallback -> can cap nhat adapter. */
const FALLBACK_SOURCES = new Set([
  'native_serp_dom',
  'google_serp_dom',
  'google_suggest_dom',
  'google_autocomplete_endpoint',
  'ahrefs_widget_clipboard',
  'google_ai_mode_direct',
  'none',
]);

async function main() {
  const keyword = process.argv[2] || DEFAULT_KEYWORD;
  const smokeRoot = path.join(os.tmpdir(), 'AutoSerpTool', 'smoke');
  fs.mkdirSync(smokeRoot, { recursive: true });

  const config = loadConfig({
    overrides: {
      output: { root: smokeRoot, on_conflict: 'timestamp' },
      notifications: { windows_toast: false, sound: false },
    },
  });
  const selectors = loadSelectors();

  process.stdout.write(`\nSMOKE TEST - keyword: "${keyword}"\nOutput tam: ${smokeRoot}\n\n`);

  try {
    const result = await runWorkflow({
      keyword,
      prompt: `Summarize the search intent behind "${keyword}".`,
      config,
      selectors,
      options: { keepStaging: false, interactive: false },
    });

    const drift = [];
    for (const [block, source] of Object.entries(result.sources ?? {})) {
      if (FALLBACK_SOURCES.has(source)) drift.push(`${block} -> ${source}`);
    }

    process.stdout.write('\n--- KET QUA SMOKE TEST ---\n');
    process.stdout.write(`Trang thai: ${result.status}\n`);
    process.stdout.write(`So luong:   ${JSON.stringify(result.counts)}\n`);
    if (drift.length) {
      process.stdout.write(`\n[CANH BAO] Cac block phai dung fallback (selector chinh co the da hong):\n`);
      for (const line of drift) process.stdout.write(`  - ${line}\n`);
    } else {
      process.stdout.write('\nTat ca block dung nguon uu tien.\n');
    }
    if (result.warnings?.length) {
      process.stdout.write(`\nWarning: ${result.warnings.join(', ')}\n`);
    }

    fs.rmSync(result.outputDir, { recursive: true, force: true });
    process.stdout.write(`\nDa xoa output tam. Log giu tai: ${result.logDir}\n\n`);
    return drift.length ? EXIT_CODES.SUCCESS : EXIT_CODES.SUCCESS;
  } catch (err) {
    process.stderr.write(`\nSMOKE TEST THAT BAI: ${describeError(err)}\n`);
    return toExitCode(err);
  }
}

main().then((code) => { process.exitCode = code; });
