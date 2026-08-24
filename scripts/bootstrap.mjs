#!/usr/bin/env node
/**
 * Chuan bi moi thu cho MOT lan cai dat, chay duoc lai nhieu lan (idempotent).
 *
 *   node scripts\bootstrap.mjs                 kiem tra + tai nhung gi con thieu
 *   node scripts\bootstrap.mjs --force         tai lai Chrome for Testing tu dau
 *   node scripts\bootstrap.mjs --update-runtime  ghim phien ban Node/Chrome moi nhat
 *
 * Cac buoc:
 *   1. npm install (bo qua neu node_modules da du)
 *   2. Tai Chrome for Testing theo phien ban ghim trong config\runtime.json
 *   3. Kiem tra 3 extension trong vendor\extensions\ dung id
 *   4. Ghi runtime\runtime.lock.json de DIAGNOSE doc lai
 *
 * install.ps1 lo phan Node portable TRUOC khi goi file nay, vi khong the chay
 * script Node khi chua co Node.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DIR = path.join(ROOT, 'runtime');
const CHROME_DIR = path.join(RUNTIME_DIR, 'chrome');
const CHROME_EXE = path.join(CHROME_DIR, 'chrome-win64', 'chrome.exe');
const RUNTIME_JSON = path.join(ROOT, 'config', 'runtime.json');
const LOCK_PATH = path.join(RUNTIME_DIR, 'runtime.lock.json');

const CFT_INDEX = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
const CFT_DOWNLOAD = (version, platform) =>
  `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/chrome-${platform}.zip`;

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const UPDATE = args.has('--update-runtime');

const say = (msg) => process.stdout.write(`${msg}\n`);
const step = (n, msg) => say(`\n[${n}/4] ${msg}`);

function readRuntimePins() {
  return JSON.parse(fs.readFileSync(RUNTIME_JSON, 'utf8'));
}

/** Tai mot URL ra file, in tien do theo % de nguoi dung biet no khong treo. */
async function download(url, destPath, label) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tai that bai (${res.status}) ${url}`);

  const total = Number(res.headers.get('content-length') ?? 0);
  const tmp = `${destPath}.part`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.rmSync(tmp, { force: true });

  const out = fs.createWriteStream(tmp);
  let seen = 0;
  let lastPct = -1;
  for await (const chunk of res.body) {
    out.write(chunk);
    seen += chunk.length;
    if (total) {
      const pct = Math.floor((seen / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stdout.write(`\r      ${label}: ${pct}% (${(seen / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB)   `);
      }
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  process.stdout.write(`\r      ${label}: xong (${(seen / 1048576).toFixed(1)} MB)                    \n`);
  fs.rmSync(destPath, { force: true });
  fs.renameSync(tmp, destPath);
  return destPath;
}

function unzip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // tar.exe co san tu Windows 10 1803 va nhanh hon Expand-Archive rat nhieu.
  const tarResult = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'ignore', windowsHide: true });
  if (tarResult.status === 0) return;
  execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
  ], { stdio: 'inherit', windowsHide: true });
}

/* ---------------------------------------------------------------- buoc 1 */
function ensurePackages() {
  step(1, 'Kiem tra package Node...');
  const required = ['playwright-core', 'yaml', 'csv-parse', 'csv-stringify'];
  const missing = required.filter((p) => !fs.existsSync(path.join(ROOT, 'node_modules', p)));
  if (!missing.length) {
    say('      Da du package.');
    return;
  }
  say(`      Thieu: ${missing.join(', ')} - dang chay npm install ...`);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const res = spawnSync(npmCmd, ['install', '--no-audit', '--no-fund'], {
    cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (res.status !== 0) throw new Error('npm install that bai. Kiem tra ket noi mang roi chay lai INSTALL.bat.');
  say('      npm install xong.');
}

/* ---------------------------------------------------------------- buoc 2 */
async function resolveChromeVersion(pins) {
  if (!UPDATE) return pins.chrome_for_testing.version;
  say('      Dang hoi phien ban Chrome for Testing moi nhat ...');
  const index = await (await fetch(CFT_INDEX)).json();
  const channel = index.channels[pins.chrome_for_testing.channel ?? 'Stable'];
  return channel.version;
}

async function ensureChrome(pins) {
  step(2, 'Kiem tra Chrome for Testing...');
  const platform = pins.chrome_for_testing.platform ?? 'win64';
  const version = await resolveChromeVersion(pins);

  const installedVersion = readInstalledChromeVersion();
  if (!FORCE && fs.existsSync(CHROME_EXE) && installedVersion === version) {
    say(`      Da co Chrome for Testing ${version}.`);
    return version;
  }
  if (fs.existsSync(CHROME_EXE) && installedVersion !== version) {
    say(`      Doi phien ban: ${installedVersion ?? 'khong ro'} -> ${version}`);
  }

  say(`      Tai Chrome for Testing ${version} (${platform}) - khoang 200 MB, chi tai mot lan.`);
  const zipPath = path.join(os.tmpdir(), `chrome-${platform}-${version}.zip`);
  await download(CFT_DOWNLOAD(version, platform), zipPath, 'Chrome');

  fs.rmSync(CHROME_DIR, { recursive: true, force: true });
  say('      Dang giai nen ...');
  unzip(zipPath, CHROME_DIR);
  fs.rmSync(zipPath, { force: true });

  if (!fs.existsSync(CHROME_EXE)) {
    throw new Error(`Giai nen xong nhung khong thay ${CHROME_EXE}.`);
  }
  fs.writeFileSync(path.join(CHROME_DIR, 'VERSION'), `${version}\n`, 'utf8');
  say(`      Chrome for Testing ${version} san sang.`);
  return version;
}

function readInstalledChromeVersion() {
  try {
    return fs.readFileSync(path.join(CHROME_DIR, 'VERSION'), 'utf8').trim();
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- buoc 3 */
async function verifyExtensions() {
  step(3, 'Kiem tra extension dong goi san...');
  const { loadConfig } = await import(new URL('../src/core/config.mjs', import.meta.url));
  const { verifyBundle } = await import(new URL('../src/browser/bundled-extensions.mjs', import.meta.url));

  const config = loadConfig();
  const report = verifyBundle(config);
  for (const entry of report.entries) {
    if (entry.ok) say(`      [OK]  ${entry.configuredName} v${entry.version}`);
    else say(`      [!]   ${entry.configuredName} - ${entry.reason}`);
  }
  if (!report.ok) {
    say('');
    say('      Bundle chua day du. Tren MAY DEV chay: node tools\\pack-extensions.mjs');
    say('      Tool van chay duoc nhung khong co Keywords Ideas cua Ahrefs.');
  }
  return report;
}

/* ---------------------------------------------------------------- buoc 4 */
function writeLock(chromeVersion, extensionReport, pins) {
  step(4, 'Ghi runtime\\runtime.lock.json...');
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const lock = {
    installed_at: new Date().toISOString(),
    node: process.version,
    node_pinned: pins.node.version,
    node_bundled: fs.existsSync(path.join(RUNTIME_DIR, 'node', 'node.exe')),
    chrome_for_testing: chromeVersion,
    chrome_exe: CHROME_EXE,
    extensions: Object.fromEntries(
      extensionReport.entries.map((e) => [e.key, { id: e.id, version: e.version, ok: e.ok }]),
    ),
  };
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  say(`      ${LOCK_PATH}`);
  return lock;
}

/* ------------------------------------------------------------------ main */
async function main() {
  say('');
  say('============================================================');
  say('  AUTO SERP RESEARCH COLLECTOR - BOOTSTRAP');
  say('============================================================');

  const pins = readRuntimePins();

  ensurePackages();
  const chromeVersion = await ensureChrome(pins);
  const extensionReport = await verifyExtensions();
  writeLock(chromeVersion, extensionReport, pins);

  if (UPDATE && chromeVersion !== pins.chrome_for_testing.version) {
    pins.chrome_for_testing.version = chromeVersion;
    fs.writeFileSync(RUNTIME_JSON, `${JSON.stringify(pins, null, 2)}\n`, 'utf8');
    say(`\n      Da ghim Chrome ${chromeVersion} vao config\\runtime.json - nho commit.`);
  }

  say('');
  say('============================================================');
  say('  CAI DAT XONG');
  say('============================================================');
  say('');
  say('  Con DUY NHAT mot viec lam bang tay, chi mot lan:');
  say('    Chay OPEN_CHROME.bat -> dang nhap Google va Ahrefs trong cua so do.');
  say('    (Extension Ahrefs can tai khoan Ahrefs moi tra ve Keywords Ideas.)');
  say('');
  say('  Sau do chay RUN.bat de bat dau.');
  say('');
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    process.stderr.write(`\n[LOI] ${err.message}\n\n`);
    process.exitCode = 1;
  });
