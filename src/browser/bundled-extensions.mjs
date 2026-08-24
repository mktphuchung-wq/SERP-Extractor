/**
 * Extension dong goi san trong repo (vendor\extensions\).
 *
 * Vi sao can:
 *   Truoc day nguoi dung phai vao Chrome Web Store cai tay 3 extension vao profile
 *   automation. Bay gio 3 extension nam san trong repo va duoc nap bang
 *   --load-extension, nen may moi khong phai cai gi.
 *
 * Rang buoc quan trong - GIU NGUYEN EXTENSION ID:
 *   Cac adapter mo thang chrome-extension://<id>/popup.html. Neu nap unpacked ma
 *   manifest khong co truong "key", Chrome sinh id theo duong dan cai dat -> id
 *   doi theo tung may va adapter tro sai cho. Ban tai tu Web Store da co san "key",
 *   tools\pack-extensions.mjs kiem tra dieu do truoc khi dong goi va
 *   verifyBundle() kiem tra lai mot lan nua truoc khi khoi dong Chrome.
 *
 * Rang buoc thu hai - CHI CHROME FOR TESTING NAP DUOC:
 *   Google Chrome ban chinh thuc bo qua --load-extension ("--load-extension is not
 *   allowed in Google Chrome, ignoring"). Vi vay runtime\chrome (Chrome for Testing)
 *   la trinh duyet mac dinh; xem chrome-launcher.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { PROJECT_ROOT } from '../core/config.mjs';
import { readExtensionDir, discoverAll } from './extension-discovery.mjs';

export const BUNDLE_ROOT = path.join(PROJECT_ROOT, 'vendor', 'extensions');
export const BUNDLE_LOCK = path.join(PROJECT_ROOT, 'vendor', 'extensions.lock.json');

/**
 * Suy ra extension id tu truong "key" cua manifest.
 * Chrome lay SHA-256 cua DER public key, cat 16 byte dau, roi doi moi nibble
 * hex (0-f) sang chu cai (a-p).
 * @param {string} base64Key gia tri manifest.key
 */
export function extensionIdFromKey(base64Key) {
  const der = Buffer.from(String(base64Key), 'base64');
  const digest = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return digest.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

/** Doc file lock do pack-extensions.mjs sinh ra (khong bat buoc phai co). */
export function readBundleLock() {
  try {
    return JSON.parse(fs.readFileSync(BUNDLE_LOCK, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Doc mot extension dong goi san.
 * @param {string} key khoa trong config.extensions (vd 'ahrefs')
 * @param {string} extensionId id mong doi
 * @returns {object|null} null neu chua dong goi
 */
export function readBundledExtension(key, extensionId, opts = {}) {
  const dir = path.join(opts.bundleRoot ?? BUNDLE_ROOT, key);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) return null;

  const read = readExtensionDir(dir, extensionId);
  if (!read.installed) return { ...read, source: 'bundled', bundleDir: dir };

  // Doi chieu id thuc su ma Chrome se sinh ra voi id ma adapter dang dung.
  let manifestKey = null;
  try {
    manifestKey = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).key ?? null;
  } catch { /* readExtensionDir da bao loi parse */ }

  if (!manifestKey) {
    return {
      ...read,
      installed: false,
      source: 'bundled',
      bundleDir: dir,
      reason: 'BUNDLE_MISSING_KEY',
    };
  }
  const derivedId = extensionIdFromKey(manifestKey);
  if (derivedId !== extensionId) {
    return {
      ...read,
      installed: false,
      source: 'bundled',
      bundleDir: dir,
      reason: `BUNDLE_ID_MISMATCH: manifest.key sinh ra ${derivedId}`,
    };
  }

  return { ...read, source: 'bundled', bundleDir: dir, profileDir: null };
}

/**
 * Danh sach thu muc extension can truyen cho --load-extension.
 * Bo qua extension da co san trong profile de tranh trung id
 * (Chrome tu choi nap khi mot id vua co ban unpacked vua co ban tu Web Store).
 *
 * @param {object} config
 * @param {Record<string,object>} [installedInProfile] ket qua discoverAll neu da co
 * @param {{bundleRoot?:string}} [opts] doi thu muc bundle (dung trong test)
 * @returns {{dirs:string[], loaded:object[], skipped:object[], broken:object[]}}
 */
export function resolveLoadExtensions(config, installedInProfile = null, opts = {}) {
  const dirs = [];
  const loaded = [];
  const skipped = [];
  const broken = [];
  // Mac dinh tu quet profile: neu nguoi dung tung cai tay tu Web Store, ban trong
  // profile va ban unpacked trung id -> Chrome tu choi nap. Uu tien ban trong profile.
  const profileState = installedInProfile ?? discoverAll(config);

  for (const [key, meta] of Object.entries(config.extensions ?? {})) {
    const inProfile = profileState?.[key];
    if (inProfile?.installed) {
      skipped.push({ key, ...inProfile, reason: 'ALREADY_IN_PROFILE' });
      continue;
    }
    const bundled = readBundledExtension(key, meta.id, opts);
    if (!bundled) {
      broken.push({ key, id: meta.id, configuredName: meta.name, reason: 'NOT_BUNDLED' });
      continue;
    }
    if (!bundled.installed) {
      broken.push({ key, id: meta.id, configuredName: meta.name, reason: bundled.reason });
      continue;
    }
    dirs.push(bundled.bundleDir);
    loaded.push({ key, configuredName: meta.name, ...bundled });
  }

  return { dirs, loaded, skipped, broken };
}

/**
 * Trang thai extension THUC TE ma mot lan chay se dung: uu tien ban da cai trong
 * profile, thieu thi lay ban dong goi trong vendor\.
 *
 * Ham nay thay cho discoverAll() o moi cho can biet "co dung duoc extension khong".
 * discoverAll() van giu nguyen y nghia cu: chi nhin vao profile.
 *
 * @returns {Record<string, object>} moi phan tu them truong `source`: profile | bundled
 */
export function discoverEffective(config, opts = {}) {
  const inProfile = discoverAll(config, opts);
  const out = {};
  for (const [key, meta] of Object.entries(config.extensions ?? {})) {
    const profileHit = inProfile[key];
    if (profileHit?.installed) {
      out[key] = { ...profileHit, source: 'profile' };
      continue;
    }
    const bundled = readBundledExtension(key, meta.id, opts);
    if (bundled?.installed) {
      out[key] = { ...bundled, id: meta.id, configuredName: meta.name, webstore: meta.webstore };
      continue;
    }
    out[key] = {
      ...profileHit,
      source: 'none',
      bundleReason: bundled?.reason ?? 'NOT_BUNDLED',
    };
  }
  return out;
}

/**
 * Kiem tra nhanh cho DIAGNOSE: bundle co day du va dung id khong.
 * @returns {{ok:boolean, entries:object[]}}
 */
export function verifyBundle(config, opts = {}) {
  const entries = [];
  for (const [key, meta] of Object.entries(config.extensions ?? {})) {
    const bundled = readBundledExtension(key, meta.id, opts);
    entries.push({
      key,
      id: meta.id,
      configuredName: meta.name,
      present: Boolean(bundled),
      ok: Boolean(bundled?.installed),
      version: bundled?.version ?? null,
      reason: bundled ? bundled.reason ?? null : 'NOT_BUNDLED',
    });
  }
  return { ok: entries.every((e) => e.ok), entries };
}
