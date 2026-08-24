/**
 * Phat hien extension trong profile automation.
 * KHONG hard-code popup.html - doc tu manifest (MV2 browser_action, MV3 action).
 * Duong dan: <profile>\<Default|Profile N>\Extensions\<id>\<version>\manifest.json
 */
import fs from 'node:fs';
import path from 'node:path';

/** So sanh version dang 1.2.3_0 theo tung so. */
export function compareVersions(a, b) {
  const parse = (v) => String(v).split('_')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const va = parse(a);
  const vb = parse(b);
  const len = Math.max(va.length, vb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (va[i] || 0) - (vb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Liet ke cac thu muc profile ben trong mot user data dir.
 * Chrome co the tao "Default", "Profile 1", "Profile 2"... tuy cach nguoi dung dang nhap.
 */
export function listProfileDirs(userDataDir, io = fs) {
  if (!io.existsSync(userDataDir)) return [];
  let entries = [];
  try {
    entries = io.readdirSync(userDataDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name === 'Default' || /^Profile( \d+)?$/i.test(name));

  // Uu tien Default truoc, sau do theo thu tu ten
  return names.sort((a, b) => {
    if (a === 'Default') return -1;
    if (b === 'Default') return 1;
    return a.localeCompare(b);
  });
}

/**
 * Doc manifest cua MOT thu muc extension da giai nen (khong quan tam no nam dau).
 * Dung chung cho extension trong profile va extension dong goi san trong vendor\.
 *
 * @param {string} dir thu muc chua manifest.json
 * @param {string} extensionId id dung de dung chrome-extension:// URL
 * @returns {object} shape giong ket qua discoverExtension
 */
export function readExtensionDir(dir, extensionId, io = fs) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!io.existsSync(manifestPath)) {
    return { installed: false, reason: 'MANIFEST_NOT_FOUND', dir };
  }

  let manifest;
  try {
    manifest = JSON.parse(io.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { installed: false, reason: `MANIFEST_INVALID: ${err.message}`, dir };
  }

  const popupPath =
    manifest.action?.default_popup ??
    manifest.browser_action?.default_popup ??
    manifest.page_action?.default_popup ??
    null;

  const serviceWorker =
    manifest.background?.service_worker ??
    (Array.isArray(manifest.background?.scripts) ? manifest.background.scripts[0] : null) ??
    manifest.background?.page ??
    null;

  const optionsPage =
    (typeof manifest.options_page === 'string' ? manifest.options_page : null) ??
    manifest.options_ui?.page ??
    null;

  return {
    installed: true,
    name: manifest.name,
    version: manifest.version,
    manifestVersion: manifest.manifest_version,
    hasKey: Boolean(manifest.key),
    dir,
    popupPath,
    popupUrl: popupPath ? `chrome-extension://${extensionId}/${stripLeadingSlash(popupPath)}` : null,
    optionsUrl: optionsPage ? `chrome-extension://${extensionId}/${stripLeadingSlash(optionsPage)}` : null,
    serviceWorker,
  };
}

/** Doc thong tin extension tu MOT thu muc profile cu the. */
function readFromProfile(userDataDir, profileDir, extensionId, io) {
  const base = path.join(userDataDir, profileDir, 'Extensions', extensionId);
  if (!io.existsSync(base)) return null;

  let versions = [];
  try {
    versions = io
      .readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(compareVersions);
  } catch {
    return null;
  }
  if (!versions.length) return { installed: false, reason: 'NO_VERSION_DIR', profileDir };

  const version = versions[versions.length - 1];
  const read = readExtensionDir(path.join(base, version), extensionId, io);
  // Chrome dat ten thu muc theo dang "3.2.10_0". Giu nguyen chuoi nay lam version
  // hien thi de khop voi cach nguoi dung nhin thay trong chrome://extensions.
  return { ...read, version, manifestVersionString: read.version, profileDir, source: 'profile' };
}

/**
 * Doc thong tin mot extension. Quet tat ca thu muc profile trong user data dir,
 * khong chi rieng "Default".
 * @param {{userDataDir:string, extensionId:string, profileDir?:string, fsImpl?:object}} args
 */
export function discoverExtension(args) {
  const io = args.fsImpl ?? fs;
  const profiles = args.profileDir
    ? [args.profileDir]
    : (listProfileDirs(args.userDataDir, io).length
      ? listProfileDirs(args.userDataDir, io)
      : ['Default']);

  let lastProblem = null;
  for (const profileDir of profiles) {
    const found = readFromProfile(args.userDataDir, profileDir, args.extensionId, io);
    if (found?.installed) return { id: args.extensionId, ...found };
    if (found) lastProblem = found;
  }

  return {
    installed: false,
    id: args.extensionId,
    reason: lastProblem?.reason ?? 'EXTENSION_DIR_NOT_FOUND',
    version: lastProblem?.version,
    searchedProfiles: profiles,
  };
}

function stripLeadingSlash(p) {
  return String(p).replace(/^\.?\//, '');
}

/**
 * Kiem tra ca ba extension trong config.
 * @returns {Record<string, object>}
 */
export function discoverAll(config, opts = {}) {
  const out = {};
  for (const [key, meta] of Object.entries(config.extensions ?? {})) {
    out[key] = {
      ...discoverExtension({
        userDataDir: config.browser.user_data_dir,
        extensionId: meta.id,
        fsImpl: opts.fsImpl,
      }),
      configuredName: meta.name,
      webstore: meta.webstore,
    };
  }
  return out;
}

/**
 * Chan doan: extension co ton tai trong profile Chrome CA NHAN hay khong.
 *
 * Chi kiem tra SU TON TAI CUA THU MUC theo extension id - khong doc manifest,
 * khong doc cookie, lich su hay bat ky du lieu nao cua profile ca nhan, va khong
 * bao gio dung profile do de chay automation. Muc dich duy nhat la giai thich cho
 * nguoi dung: "ban da cai extension o Chrome thuong, chua cai o profile automation".
 *
 * @param {string[]} extensionIds
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string[]>} id -> danh sach ten profile ca nhan co chua id do
 */
export function findInPersonalChrome(extensionIds, env = process.env, io = fs) {
  const result = {};
  const local = env.LOCALAPPDATA;
  if (!local) return result;

  const roots = [
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Google', 'Chrome Beta', 'User Data'),
  ];

  for (const id of extensionIds) {
    const hits = [];
    for (const root of roots) {
      for (const profileDir of listProfileDirs(root, io)) {
        try {
          if (io.existsSync(path.join(root, profileDir, 'Extensions', id))) {
            hits.push(profileDir);
          }
        } catch { /* bo qua */ }
      }
    }
    if (hits.length) result[id] = hits;
  }
  return result;
}
