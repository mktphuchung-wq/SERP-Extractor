/**
 * Setup lan dau, duoc gop chung vao launcher.
 *
 * RUN.bat khong con phai chay SETUP.bat truoc: truoc moi lan chay, tool tu kiem
 * tra profile automation da san sang chua. Neu chua, no de nghi cai dat ngay,
 * mo dung cua so Chrome can cai va cho nguoi dung xong roi chay tiep.
 *
 * Lan chay thu hai tro di, buoc nay im lang di qua (chi ton mot lan doc thu muc).
 */
import fs from 'node:fs';
import path from 'node:path';

import { findChrome, probeDebugger, spawnChrome, assertNotDefaultProfile } from './browser/chrome-launcher.mjs';
import { findInPersonalChrome } from './browser/extension-discovery.mjs';
import { discoverEffective, resolveLoadExtensions } from './browser/bundled-extensions.mjs';
import { ask, isInteractive } from './core/prompt.mjs';
import { sleep } from './core/retry.mjs';
import { AppError } from './core/errors.mjs';
import { isUsable } from './engine/capability.mjs';

const SETUP_MARKER = 'auto-serp-setup.json';

/**
 * Extension da san sang chua - tinh ca ban dong goi trong vendor\extensions.
 * @param {object} config
 * @param {{bundleRoot?:string, fsImpl?:object}} [opts] chi dung trong test
 * @returns {{complete:boolean, missing:object[], installed:object[], extensions:object}}
 */
export function checkSetup(config, opts = {}) {
  const extensions = discoverEffective(config, opts);
  const entries = Object.entries(extensions);
  const missing = entries.filter(([, meta]) => !isUsable(meta)).map(([key, meta]) => ({ key, ...meta }));
  const installed = entries.filter(([, meta]) => isUsable(meta)).map(([key, meta]) => ({ key, ...meta }));
  return { complete: missing.length === 0, missing, installed, extensions };
}

export function writeSetupMarker(config, extensions) {
  const marker = path.join(config.browser.user_data_dir, SETUP_MARKER);
  try {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({
      'setup-completed': true,
      completed_at: new Date().toISOString(),
      extensions: Object.fromEntries(
        Object.entries(extensions).map(([k, v]) => [k, { id: v.id, version: v.version, profile: v.profileDir }]),
      ),
    }, null, 2), 'utf8');
    return marker;
  } catch {
    return null;
  }
}

/**
 * In checklist cho nguoi dung khong chuyen ky thuat.
 *
 * Duong di binh thuong KHONG bao gio toi day: 3 extension da nam san trong
 * vendor\extensions va duoc nap tu dong. Ham nay chi chay khi bundle bi hong
 * hoac nguoi dung ep dung Chrome he thong (ban chinh thuc bo qua --load-extension).
 */
function printChecklist(missing, config) {
  const out = process.stdout;
  out.write('\n============================================================\n');
  out.write('  CAI TAY EXTENSION CON THIEU\n');
  out.write('============================================================\n\n');
  out.write('  Binh thuong ban khong phai lam buoc nay - 3 extension da duoc\n');
  out.write('  dong goi san trong vendor\\extensions va nap tu dong.\n');
  out.write('  Neu man hinh nay hien ra, nghia la mot trong hai:\n');
  out.write('    - Thu muc vendor\\extensions thieu hoac hong  -> chay INSTALL.bat\n');
  out.write('    - Dang chay Google Chrome ban chinh thuc (ban nay bo qua\n');
  out.write('      --load-extension) -> chay INSTALL.bat de dung Chrome for Testing\n\n');
  out.write('  Muon cai tay ngay bay gio thi lam trong cua so Chrome vua mo:\n\n');
  out.write('   1. Cai cac extension con thieu o cac tab da mo san:\n');
  for (const meta of missing) {
    out.write(`        - ${meta.configuredName}\n`);
  }
  out.write('\n   2. Dang nhap Ahrefs neu extension yeu cau.\n');
  out.write('   3. Search thu mot tu khoa, roi chon country = United States\n');
  out.write('      trong Ahrefs SEO Toolbar.\n\n');
  out.write(`  Profile: ${config.browser.user_data_dir}\n\n`);

  const elsewhere = config.privacy?.hint_personal_chrome === false
    ? {}
    : findInPersonalChrome(missing.map((m) => m.id));
  if (Object.keys(elsewhere).length) {
    out.write('  CHU Y: nhung extension nay DA co trong Chrome ca nhan cua ban,\n');
    out.write('  nhung hai profile tach biet nhau nen khong dung chung duoc.\n');
    out.write('  Chrome 136+ khong cho phep dieu khien profile mac dinh.\n\n');
  }
}

/**
 * Chay quy trinh cai dat: mo Chrome profile rieng + 3 tab Web Store, cho nguoi dung xong.
 * @returns {Promise<{complete:boolean, missing:object[]}>}
 */
export async function runFirstTimeSetup(config, opts = {}) {
  const logger = opts.logger;
  const maxRounds = opts.maxRounds ?? 3;

  assertNotDefaultProfile(config.browser.user_data_dir);
  fs.mkdirSync(config.browser.user_data_dir, { recursive: true });

  let state = checkSetup(config);
  if (state.complete) return state;

  const chromePath = findChrome(config.browser.chrome_path);
  const webstoreUrls = state.missing.map((m) => m.webstore).filter(Boolean);

  // Neu Chrome cua profile nay chua chay thi mo kem cac tab Web Store
  const port = config.browser.remote_debugging_port;
  const alreadyOpen = await probeDebugger(port);
  if (!alreadyOpen) {
    spawnChrome(chromePath, {
      port,
      userDataDir: config.browser.user_data_dir,
      viewport: config.browser.viewport,
      urls: webstoreUrls,
      loadExtensions: resolveLoadExtensions(config).dirs,
      disableFeatures: config.browser.disable_features,
      logger,
    });
    await sleep(2500);
  } else {
    process.stdout.write(
      '\n  [i] Chrome cua profile automation dang mo san. Hay cai extension trong cua so do.\n',
    );
  }

  for (let round = 0; round < maxRounds; round += 1) {
    printChecklist(state.missing, config);
    const answer = await ask('  Cai xong roi thi nhan Enter (hoac go "bo qua" de chay luon): ');
    if (/^(bo qua|skip|s|n)$/i.test(answer.trim())) {
      process.stdout.write('\n  Bo qua cai dat. Tool se chay bang DOM fallback.\n\n');
      return { ...checkSetup(config), skipped: true };
    }

    state = checkSetup(config);
    if (state.complete) {
      writeSetupMarker(config, state.extensions);
      process.stdout.write('\n  [OK] Da cai du 3 extension. setup-completed=true\n\n');
      return state;
    }
    process.stdout.write(`\n  [!] Van con thieu ${state.missing.length} extension.\n`);
  }

  process.stdout.write('\n  Van chua du extension. Tool se chay bang DOM fallback.\n\n');
  return state;
}

/**
 * Cong kiem tra truoc moi lan chay (goi tu RUN.bat qua cli.mjs).
 *
 * - Da du extension  -> di tiep, khong lam phien.
 * - Thieu extension  -> hoi co muon cai ngay khong (che do tuong tac),
 *                       hoac chi canh bao roi chay tiep (che do tu dong).
 * - --require-extensions -> dung han neu thieu.
 *
 * @returns {Promise<{complete:boolean, missing:object[]}>}
 */
export async function ensureReady(config, opts = {}) {
  const state = checkSetup(config);
  if (state.complete) {
    if (opts.verbose) {
      process.stdout.write(`  [OK] Profile automation da co du ${state.installed.length} extension.\n`);
    }
    return state;
  }

  if (opts.requireExtensions) {
    throw new AppError(
      'EXTENSION_MISSING',
      `Thieu ${state.missing.length} extension trong profile automation: ` +
      `${state.missing.map((m) => m.configuredName).join(', ')}.`,
    );
  }

  process.stdout.write(
    `\n  [!] Dang thieu ${state.missing.length}/3 extension (ke ca ban dong goi trong vendor\\extensions):\n`,
  );
  for (const meta of state.missing) {
    process.stdout.write(`      - ${meta.configuredName} (${meta.bundleReason ?? meta.reason})\n`);
  }
  process.stdout.write(
    '      Cach sua nhanh nhat: chay INSTALL.bat.\n' +
    '      Khong co extension, tool van chay duoc bang DOM fallback,\n' +
    '      nhung KHONG lay duoc Keywords Ideas cua Ahrefs.\n',
  );

  if (opts.skipSetup || !isInteractive()) {
    process.stdout.write('      Chay tiep bang DOM fallback.\n\n');
    return state;
  }

  const answer = await ask('\n  Cai dat ngay bay gio? [Y/n]: ');
  if (/^(n|no|khong|ko)$/i.test(answer.trim())) {
    process.stdout.write('  Chay tiep bang DOM fallback.\n\n');
    return state;
  }

  return runFirstTimeSetup(config, opts);
}
