#!/usr/bin/env node
/**
 * Mo cua so Chrome automation bang DUNG cau hinh ma tool se dung khi chay that:
 * cung profile, cung cong CDP, cung danh sach extension.
 *
 * Truoc day OPEN_CHROME.bat tu ghep dong lenh Chrome nen de lech voi
 * chrome-launcher.mjs (thieu --load-extension la mat het extension). Bay gio
 * ca hai duong deu di qua spawnChrome() nen khong the lech.
 */
import fs from 'node:fs';

import { loadConfig } from '../src/core/config.mjs';
import {
  findChrome, probeDebugger, spawnChrome, assertNotDefaultProfile, isBundledChrome,
} from '../src/browser/chrome-launcher.mjs';
import { resolveLoadExtensions } from '../src/browser/bundled-extensions.mjs';
import { describeError } from '../src/core/errors.mjs';

const say = (msg) => process.stdout.write(`${msg}\n`);

/** Cho phep --config <file> giong cli.mjs de test tren profile khac. */
function parseConfigPath(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config') return argv[i + 1];
    if (argv[i].startsWith('--config=')) return argv[i].slice('--config='.length);
  }
  return undefined;
}

async function main() {
  const config = loadConfig({ configPath: parseConfigPath(process.argv.slice(2)) });
  const port = config.browser.remote_debugging_port;
  const userDataDir = config.browser.user_data_dir;

  assertNotDefaultProfile(userDataDir);

  const running = await probeDebugger(port);
  if (running) {
    say('');
    say(`  [i] Cua so Chrome automation DANG MO san (cong ${port}, ${running.Browser}).`);
    say('      Cu de nguyen, RUN.bat se bam vao cua so nay.');
    say('');
    return 0;
  }

  const chromePath = findChrome(config.browser.chrome_path);
  const bundle = resolveLoadExtensions(config);
  fs.mkdirSync(userDataDir, { recursive: true });

  say('');
  say('============================================================');
  say('  CUA SO CHROME AUTOMATION');
  say('============================================================');
  say('');
  say(`  Chrome  : ${chromePath}${isBundledChrome(chromePath) ? '  (Chrome for Testing kem theo tool)' : ''}`);
  say(`  Profile : ${userDataDir}`);
  say(`  CDP     : 127.0.0.1:${port}`);
  say('');

  if (bundle.loaded.length) {
    say(`  Extension nap tu vendor\\extensions (${bundle.loaded.length}):`);
    for (const ext of bundle.loaded) say(`    - ${ext.configuredName} v${ext.version}`);
  }
  if (bundle.skipped.length) {
    say(`  Extension da co san trong profile (${bundle.skipped.length}):`);
    for (const ext of bundle.skipped) say(`    - ${ext.configuredName ?? ext.name} v${ext.version}`);
  }
  for (const broken of bundle.broken) {
    say(`  [!] ${broken.configuredName} chua san sang: ${broken.reason}`);
  }
  say('');

  if (!isBundledChrome(chromePath) && bundle.dirs.length) {
    say('  [!] Dang dung Google Chrome ban chinh thuc. Ban nay BO QUA --load-extension');
    say('      nen 3 extension se KHONG duoc nap. Chay INSTALL.bat de tai Chrome for Testing.');
    say('');
  }

  spawnChrome(chromePath, {
    port,
    userDataDir,
    viewport: config.browser.viewport,
    loadExtensions: bundle.dirs,
    urls: ['https://www.google.com/search?q=test&hl=en&gl=us&pws=0'],
  });

  say('  Viec can lam trong cua so vua mo (chi mot lan tren may nay):');
  say('    1. Dang nhap tai khoan Google.');
  say('    2. Dang nhap Ahrefs (icon Ahrefs SEO Toolbar tren thanh cong cu).');
  say('    3. Trong Ahrefs SEO Toolbar chon country = United States.');
  say('');
  say('  Cu de cua so nay mo. Moi lan chay RUN.bat, tool se bam vao no thay vi');
  say('  mo Chrome moi -> chay nhanh hon va giu nguyen phien dang nhap.');
  say('');
  say('  Luu y: day KHONG phai profile Chrome ca nhan cua ban.');
  say('');
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    process.stderr.write(`\n${describeError(err)}\n\n`);
    process.exitCode = 2;
  });
