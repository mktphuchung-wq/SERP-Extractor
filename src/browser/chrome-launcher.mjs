/**
 * Tim va khoi dong Google Chrome voi custom user data directory.
 *
 * Rang buoc bat buoc (dac ta muc 4.2 / 19):
 *  - KHONG dung profile Chrome mac dinh cua nguoi dung
 *  - KHONG copy cookie tu profile ca nhan
 *  - Remote debugging chi bind 127.0.0.1 (mac dinh cua Chrome)
 *  - Khong dung stealth flag
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { AppError } from '../core/errors.mjs';
import { sleep } from '../core/retry.mjs';
import { PROJECT_ROOT } from '../core/config.mjs';
import { resolveLoadExtensions } from './bundled-extensions.mjs';

const COMMON_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

/**
 * Chrome for Testing do installer tai ve. Day la trinh duyet MAC DINH cua tool.
 *
 * Ly do khong dung Google Chrome ban chinh thuc: tu ban 137 tro di Chrome co
 * branding bo qua --load-extension va chi in canh bao
 * "--load-extension is not allowed in Google Chrome, ignoring", nen 3 extension
 * dong goi san trong vendor\ se khong bao gio duoc nap. Chrome for Testing la ban
 * build chinh chu cua Google, khong bi chan flag nay, khong tu dong cap nhat
 * (phien ban ghim trong config\runtime.json) va khong dinh gi toi Chrome ca nhan.
 */
export const BUNDLED_CHROME = path.join(PROJECT_ROOT, 'runtime', 'chrome', 'chrome-win64', 'chrome.exe');

/** Chrome dang chay co phai ban Chrome for Testing kem theo tool khong? */
export function isBundledChrome(chromePath) {
  if (!chromePath) return false;
  return path.resolve(chromePath).toLowerCase() === path.resolve(BUNDLED_CHROME).toLowerCase();
}

/** Duong dan profile mac dinh cua Chrome - tuyet doi khong duoc dung. */
export function defaultChromeProfileDirs(env = process.env) {
  const local = env.LOCALAPPDATA;
  if (!local) return [];
  return [
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Google', 'Chrome Beta', 'User Data'),
    path.join(local, 'Google', 'Chrome SxS', 'User Data'),
  ];
}

/** Chan cau hinh tro toi profile ca nhan. */
export function assertNotDefaultProfile(userDataDir, env = process.env) {
  const target = path.resolve(userDataDir).toLowerCase();
  for (const dir of defaultChromeProfileDirs(env)) {
    if (target === path.resolve(dir).toLowerCase()) {
      throw new AppError(
        'PROFILE_LOCKED',
        `Cau hinh dang tro toi profile Chrome mac dinh (${dir}). ` +
        'Tool bat buoc dung profile rieng, hay doi browser.user_data_dir.',
      );
    }
  }
}

/**
 * @param {string} configured 'auto' | 'bundled' | 'system' | duong dan tuyet doi
 */
export function findChrome(configured, env = process.env) {
  // 'bundled': bat buoc dung Chrome for Testing, khong am tham roi ve Chrome he thong
  // (vi roi ve nghia la mat het extension ma nguoi dung khong biet).
  if (configured === 'bundled') {
    if (fs.existsSync(BUNDLED_CHROME)) return BUNDLED_CHROME;
    throw new AppError(
      'CHROME_NOT_FOUND',
      `Khong tim thay Chrome for Testing tai ${BUNDLED_CHROME}. ` +
      'Chay INSTALL.bat (hoac "node scripts\\bootstrap.mjs") de tai ve.',
    );
  }

  const candidates = [];
  if (configured && !['auto', 'system', 'bundled'].includes(configured)) candidates.push(configured);
  // 'auto' uu tien ban dong goi: chi ban nay moi nap duoc extension trong vendor\.
  if (configured !== 'system') candidates.push(BUNDLED_CHROME);
  if (env.CHROME_PATH) candidates.push(env.CHROME_PATH);
  candidates.push(...COMMON_PATHS);
  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // Tra cuu registry App Paths (chi doc, khong sua)
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe', '/ve'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
    );
    const match = /REG_SZ\s+(.+chrome\.exe)/i.exec(out);
    if (match && fs.existsSync(match[1].trim())) return match[1].trim();
  } catch { /* khong co registry entry */ }

  throw new AppError(
    'CHROME_NOT_FOUND',
    'Khong tim thay trinh duyet nao. Chay INSTALL.bat de tai Chrome for Testing, ' +
    'hoac cai Google Chrome, hoac dat browser.chrome_path trong config/local.yaml.',
  );
}

/** Kiem tra CDP endpoint da san sang chua. */
export async function probeDebugger(port, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function profileLockExists(userDataDir) {
  return ['lockfile', 'SingletonLock', 'SingletonCookie'].some((name) =>
    fs.existsSync(path.join(userDataDir, name)),
  );
}

/**
 * Spawn Chrome voi profile rieng + cong debug. Dung chung cho ensureChrome va setup.
 * KHONG dung stealth flag; cong debug chi bind 127.0.0.1 (mac dinh cua Chrome).
 * @param {string} chromePath
 * @param {{port:number, userDataDir:string, headless?:boolean, viewport?:object, urls?:string[], logger?:object}} opts
 */
export function spawnChrome(chromePath, opts) {
  const args = [
    `--remote-debugging-port=${opts.port}`,
    `--user-data-dir=${opts.userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  // Tat cac tinh nang cua Chrome cuop lay dieu huong cua trang (xem
  // browser.disable_features trong config/default.yaml).
  if (opts.disableFeatures?.length) {
    args.push(`--disable-features=${opts.disableFeatures.join(',')}`);
  }

  // Nap 3 extension dong goi san. Chi co tac dung tren Chrome for Testing;
  // Chrome ban chinh thuc bo qua flag nay (xem ghi chu o BUNDLED_CHROME).
  if (opts.loadExtensions?.length) {
    if (isBundledChrome(chromePath)) {
      const list = opts.loadExtensions.join(',');
      args.push(`--load-extension=${list}`);
      opts.logger?.info(`Nap ${opts.loadExtensions.length} extension tu vendor\\extensions`);
    } else {
      opts.logger?.warn(
        'Dang chay Google Chrome ban chinh thuc nen KHONG nap duoc extension dong goi ' +
        '(Chrome bo qua --load-extension). Chay INSTALL.bat de dung Chrome for Testing, ' +
        'hoac cai tay 3 extension vao profile automation.',
        { code: 'BUNDLED_EXTENSIONS_IGNORED', chromePath },
      );
    }
  }

  if (opts.viewport) {
    args.push(`--window-size=${opts.viewport.width},${opts.viewport.height}`);
  }
  if (opts.headless) args.push('--headless=new');
  if (opts.urls?.length) args.push(...opts.urls);
  else args.push('--homepage=about:blank');

  opts.logger?.info(`Khoi dong Chrome: ${chromePath}`);
  opts.logger?.debug('Chrome args', { args });

  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return child;
}

/**
 * Dam bao co mot Chrome dang chay voi profile rieng va mo CDP port.
 * @param {object} config
 * @param {object} logger
 * @returns {Promise<{chromePath:string, port:number, userDataDir:string, launched:boolean, version:object}>}
 */
export async function ensureChrome(config, logger, opts = {}) {
  const port = config.browser.remote_debugging_port;
  const userDataDir = config.browser.user_data_dir;
  assertNotDefaultProfile(userDataDir);

  const existing = await probeDebugger(port);
  if (existing) {
    logger?.info(`Da co Chrome mo san CDP tren cong ${port} (${existing.Browser}). Dang attach.`);
    return {
      chromePath: config.browser.chrome_path,
      port, userDataDir, launched: false, version: existing,
    };
  }

  const chromePath = findChrome(config.browser.chrome_path);
  fs.mkdirSync(userDataDir, { recursive: true });

  if (profileLockExists(userDataDir)) {
    logger?.warn(
      'Profile automation dang bi mot tien trinh Chrome khac giu nhung khong mo CDP port. ' +
      'Dong cua so Chrome cua profile nay roi chay lai.',
      { code: 'PROFILE_LOCKED', userDataDir },
    );
  }

  const bundle = resolveLoadExtensions(config);
  for (const broken of bundle.broken) {
    logger?.warn(
      `Extension "${broken.configuredName}" chua san sang trong vendor\\extensions (${broken.reason}).`,
      { code: 'BUNDLE_INCOMPLETE', extension: broken.key },
    );
  }

  spawnChrome(chromePath, {
    port,
    userDataDir,
    headless: config.browser.headless,
    viewport: config.browser.viewport,
    urls: opts.urls,
    loadExtensions: bundle.dirs,
    disableFeatures: config.browser.disable_features,
    logger,
  });

  const deadline = Date.now() + (config.browser.launch_timeout_ms ?? 45000);
  while (Date.now() < deadline) {
    const version = await probeDebugger(port);
    if (version) {
      logger?.info(`Chrome san sang: ${version.Browser}`);
      return { chromePath, port, userDataDir, launched: true, version };
    }
    await sleep(500);
  }

  throw new AppError(
    'CDP_CONNECT_FAILED',
    `Chrome khong mo duoc cong debug ${port} sau ${config.browser.launch_timeout_ms}ms. ` +
    'Kiem tra Chrome co bi chan boi policy hoac cong da bi chiem.',
  );
}
