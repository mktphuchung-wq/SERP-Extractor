import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  extensionIdFromKey, readBundledExtension, resolveLoadExtensions, verifyBundle, BUNDLE_ROOT,
} from '../../src/browser/bundled-extensions.mjs';
import { loadConfig } from '../../src/core/config.mjs';
import { makeTempDir } from '../helpers/dom.mjs';

/** Sinh mot cap khoa RSA that de kiem tra cong thuc id thay vi hard-code. */
function makeKeyPair() {
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { base64: der.toString('base64') };
}

function writeBundle(root, key, manifest) {
  const dir = path.join(root, key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return dir;
}

test('extensionIdFromKey: 32 ky tu trong khoang a-p va on dinh', () => {
  const { base64 } = makeKeyPair();
  const id = extensionIdFromKey(base64);
  assert.match(id, /^[a-p]{32}$/);
  assert.equal(id, extensionIdFromKey(base64), 'phai deterministic');
});

test('extensionIdFromKey: khop voi 3 extension that trong vendor\\extensions', () => {
  const config = loadConfig();
  for (const [key, meta] of Object.entries(config.extensions)) {
    const manifestPath = path.join(BUNDLE_ROOT, key, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), `chua dong goi ${key} - chay tools\\pack-extensions.mjs`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(manifest.key, `${key}: manifest thieu truong "key"`);
    assert.equal(
      extensionIdFromKey(manifest.key), meta.id,
      `${key}: id sinh ra khong khop id trong config -> adapter se tro sai extension`,
    );
  }
});

test('readBundledExtension: tra ve null khi chua dong goi', () => {
  const tmp = makeTempDir();
  try {
    assert.equal(readBundledExtension('ahrefs', 'a'.repeat(32), { bundleRoot: tmp.dir }), null);
  } finally {
    tmp.cleanup();
  }
});

test('readBundledExtension: bao loi khi manifest thieu key', () => {
  const tmp = makeTempDir();
  try {
    writeBundle(tmp.dir, 'ahrefs', { manifest_version: 3, name: 'X', version: '1.0' });
    const found = readBundledExtension('ahrefs', 'a'.repeat(32), { bundleRoot: tmp.dir });
    assert.equal(found.installed, false);
    assert.equal(found.reason, 'BUNDLE_MISSING_KEY');
  } finally {
    tmp.cleanup();
  }
});

test('readBundledExtension: bao loi khi key sinh ra id khac id cau hinh', () => {
  const tmp = makeTempDir();
  try {
    const { base64 } = makeKeyPair();
    writeBundle(tmp.dir, 'ahrefs', { manifest_version: 3, name: 'X', version: '1.0', key: base64 });
    const found = readBundledExtension('ahrefs', 'b'.repeat(32), { bundleRoot: tmp.dir });
    assert.equal(found.installed, false);
    assert.match(found.reason, /^BUNDLE_ID_MISMATCH/);
  } finally {
    tmp.cleanup();
  }
});

test('readBundledExtension: dung key thi tra ve popupUrl theo id cau hinh', () => {
  const tmp = makeTempDir();
  try {
    const { base64 } = makeKeyPair();
    const id = extensionIdFromKey(base64);
    writeBundle(tmp.dir, 'ahrefs', {
      manifest_version: 3, name: 'X', version: '9.9', key: base64,
      action: { default_popup: 'popup.html' },
    });
    const found = readBundledExtension('ahrefs', id, { bundleRoot: tmp.dir });
    assert.equal(found.installed, true);
    assert.equal(found.source, 'bundled');
    assert.equal(found.version, '9.9');
    assert.equal(found.popupUrl, `chrome-extension://${id}/popup.html`);
  } finally {
    tmp.cleanup();
  }
});

test('resolveLoadExtensions: bo qua extension da co san trong profile', () => {
  const tmp = makeTempDir();
  try {
    const { base64 } = makeKeyPair();
    const id = extensionIdFromKey(base64);
    writeBundle(tmp.dir, 'ahrefs', { manifest_version: 3, name: 'A', version: '1.0', key: base64 });
    writeBundle(tmp.dir, 'serp_export', { manifest_version: 3, name: 'B', version: '1.0', key: base64 });

    const config = {
      browser: { user_data_dir: path.join(tmp.dir, 'profile') },
      extensions: {
        ahrefs: { id, name: 'A' },
        serp_export: { id, name: 'B' },
      },
    };
    const profileState = { ahrefs: { installed: true, version: '2.0', configuredName: 'A' } };
    const result = resolveLoadExtensions(config, profileState, { bundleRoot: tmp.dir });

    assert.equal(result.dirs.length, 1, 'chi nap ban chua co trong profile');
    assert.deepEqual(result.loaded.map((e) => e.key), ['serp_export']);
    assert.deepEqual(result.skipped.map((e) => e.key), ['ahrefs']);
    assert.equal(result.broken.length, 0);
  } finally {
    tmp.cleanup();
  }
});

test('verifyBundle: bundle that trong repo phai du 3 extension', () => {
  const report = verifyBundle(loadConfig());
  assert.equal(report.ok, true, JSON.stringify(report.entries, null, 2));
  assert.equal(report.entries.length, 3);
});
