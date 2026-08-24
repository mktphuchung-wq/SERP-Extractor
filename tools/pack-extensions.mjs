#!/usr/bin/env node
/**
 * Dong goi 3 extension tu mot profile Chrome da cai san vao vendor\extensions\.
 *
 * Chay tren MAY DEV (may da cai du extension), ket qua duoc commit len repo.
 * May dich khong can cai gi: Chrome for Testing nap thang tu vendor\extensions\.
 *
 *   node tools\pack-extensions.mjs
 *   node tools\pack-extensions.mjs --from "C:\...\chrome-profile"
 *
 * Vi sao giu nguyen thu muc unpacked thay vi .crx:
 *   manifest.json cua ban tai tu Web Store DA co truong "key" (public key goc),
 *   nen khi nap bang --load-extension Chrome van sinh ra DUNG extension id cu.
 *   Cac adapter dang tro toi chrome-extension://<id>/... nen id phai giu nguyen.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { loadConfig } from '../src/core/config.mjs';
import { listProfileDirs, compareVersions } from '../src/browser/extension-discovery.mjs';
import { BUNDLE_ROOT, BUNDLE_LOCK, extensionIdFromKey } from '../src/browser/bundled-extensions.mjs';

/** Thu muc/tep khong can mang theo: chi phuc vu content verification cua ban .crx. */
const SKIP_ENTRIES = new Set(['_metadata']);

function parseArgs(argv) {
  const out = { from: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--from') { out.from = argv[i + 1]; i += 1; }
    else if (argv[i].startsWith('--from=')) out.from = argv[i].slice('--from='.length);
  }
  return out;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_ENTRIES.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = copyTree(from, to);
      bytes += sub.bytes;
      files += sub.files;
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      bytes += fs.statSync(to).size;
      files += 1;
    }
  }
  return { bytes, files };
}

/** Tim thu muc phien ban moi nhat cua mot extension trong user data dir. */
function findLatest(userDataDir, extensionId) {
  const profiles = listProfileDirs(userDataDir);
  const candidates = [];
  for (const profileDir of profiles.length ? profiles : ['Default']) {
    const base = path.join(userDataDir, profileDir, 'Extensions', extensionId);
    if (!fs.existsSync(base)) continue;
    for (const version of fs.readdirSync(base, { withFileTypes: true })) {
      if (!version.isDirectory()) continue;
      const dir = path.join(base, version.name);
      if (fs.existsSync(path.join(dir, 'manifest.json'))) {
        candidates.push({ version: version.name, dir, profileDir });
      }
    }
  }
  candidates.sort((a, b) => compareVersions(a.version, b.version));
  return candidates.at(-1) ?? null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const userDataDir = args.from ? path.resolve(args.from) : config.browser.user_data_dir;

  process.stdout.write(`\nDong goi extension tu: ${userDataDir}\n\n`);
  if (!fs.existsSync(userDataDir)) {
    process.stderr.write(`[LOI] Khong tim thay profile: ${userDataDir}\n`);
    return 1;
  }

  fs.mkdirSync(BUNDLE_ROOT, { recursive: true });
  const lock = { generated_at: new Date().toISOString(), source_profile: userDataDir, extensions: {} };
  let failed = 0;

  for (const [key, meta] of Object.entries(config.extensions ?? {})) {
    const found = findLatest(userDataDir, meta.id);
    if (!found) {
      process.stderr.write(`  [LOI]  ${meta.name} (${meta.id}) - chua cai trong profile nguon.\n`);
      failed += 1;
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(found.dir, 'manifest.json'), 'utf8'));
    if (!manifest.key) {
      process.stderr.write(
        `  [LOI]  ${meta.name} - manifest.json thieu truong "key".\n` +
        '         Khong co key thi Chrome sinh id theo duong dan, cac adapter se tro sai extension.\n',
      );
      failed += 1;
      continue;
    }
    const derivedId = extensionIdFromKey(manifest.key);
    if (derivedId !== meta.id) {
      process.stderr.write(
        `  [LOI]  ${meta.name} - key trong manifest sinh ra id ${derivedId}, khac id cau hinh ${meta.id}.\n`,
      );
      failed += 1;
      continue;
    }

    const dest = path.join(BUNDLE_ROOT, key);
    fs.rmSync(dest, { recursive: true, force: true });
    const stats = copyTree(found.dir, dest);

    lock.extensions[key] = {
      id: meta.id,
      name: meta.name,
      version: found.version,
      manifest_version: manifest.manifest_version,
      dir: path.relative(path.dirname(BUNDLE_ROOT), dest).replace(/\\/g, '/'),
      files: stats.files,
      bytes: stats.bytes,
      key_sha256: crypto.createHash('sha256').update(manifest.key).digest('hex').slice(0, 16),
    };

    process.stdout.write(
      `  [OK]   ${meta.name} v${found.version} -> vendor\\extensions\\${key} ` +
      `(${stats.files} tep, ${(stats.bytes / 1048576).toFixed(1)} MB)\n`,
    );
  }

  fs.writeFileSync(BUNDLE_LOCK, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nDa ghi ${path.relative(process.cwd(), BUNDLE_LOCK)}\n`);

  if (failed) {
    process.stderr.write(`\n[LOI] Con ${failed} extension chua dong goi duoc.\n\n`);
    return 1;
  }
  process.stdout.write('\nXong. Nho commit ca thu muc vendor\\extensions\\.\n\n');
  return 0;
}

process.exitCode = main();
