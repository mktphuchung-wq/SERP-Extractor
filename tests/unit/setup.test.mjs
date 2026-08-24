import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkSetup, writeSetupMarker } from '../../src/setup.mjs';
import { makeTempDir } from '../helpers/dom.mjs';

const IDS = {
  ahrefs: 'hgmoccdbjhknikckedaaebbpdeebhiei',
  serp_export: 'oijhomofkbpbjldkdhkkjkcdokdigeie',
  suggestions: 'lbgklcfhclfdeapdabmcphhkomkofbga',
};

function makeConfig(userDataDir) {
  return {
    browser: { user_data_dir: userDataDir },
    extensions: {
      ahrefs: { id: IDS.ahrefs, name: 'Ahrefs SEO Toolbar', webstore: 'https://a' },
      serp_export: { id: IDS.serp_export, name: 'SEO SERP Extraction Tool', webstore: 'https://b' },
      suggestions: { id: IDS.suggestions, name: 'Google Search Suggestion Extractor', webstore: 'https://c' },
    },
  };
}

function install(userDataDir, id, name) {
  const dir = path.join(userDataDir, 'Default', 'Extensions', id, '1.0.0_0');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3, name, action: { default_popup: 'popup.html' },
  }), 'utf8');
}

/**
 * Thu muc bundle rong: dung de kiem tra rieng nhanh "chi nhin vao profile",
 * khong bi vendor\extensions that trong repo lam nhieu ket qua.
 */
function emptyBundle(tmpDir) {
  const dir = path.join(tmpDir, 'no-bundle');
  fs.mkdirSync(dir, { recursive: true });
  return { bundleRoot: dir };
}

test('checkSetup: profile trong va khong co bundle thi bao thieu du ca 3 extension', () => {
  const tmp = makeTempDir();
  try {
    const state = checkSetup(makeConfig(tmp.dir), emptyBundle(tmp.dir));
    assert.equal(state.complete, false);
    assert.equal(state.missing.length, 3);
    assert.equal(state.installed.length, 0);
    assert.deepEqual(
      state.missing.map((m) => m.configuredName).sort(),
      ['Ahrefs SEO Toolbar', 'Google Search Suggestion Extractor', 'SEO SERP Extraction Tool'],
    );
  } finally {
    tmp.cleanup();
  }
});

test('checkSetup: cai mot phan trong profile thi liet ke dung cai con thieu', () => {
  const tmp = makeTempDir();
  try {
    install(tmp.dir, IDS.ahrefs, 'Ahrefs SEO Toolbar');
    const state = checkSetup(makeConfig(tmp.dir), emptyBundle(tmp.dir));
    assert.equal(state.complete, false);
    assert.equal(state.installed.length, 1);
    assert.equal(state.installed[0].key, 'ahrefs');
    assert.equal(state.installed[0].source, 'profile');
    assert.deepEqual(state.missing.map((m) => m.key).sort(), ['serp_export', 'suggestions']);
  } finally {
    tmp.cleanup();
  }
});

test('checkSetup: cai du 3 trong profile thi complete = true', () => {
  const tmp = makeTempDir();
  try {
    install(tmp.dir, IDS.ahrefs, 'Ahrefs SEO Toolbar');
    install(tmp.dir, IDS.serp_export, 'SEO SERP Extraction Tool');
    install(tmp.dir, IDS.suggestions, 'Google Search Suggestion Extractor');
    const state = checkSetup(makeConfig(tmp.dir), emptyBundle(tmp.dir));
    assert.equal(state.complete, true);
    assert.equal(state.missing.length, 0);
    assert.equal(state.installed.length, 3);
  } finally {
    tmp.cleanup();
  }
});

test('checkSetup: bundle trong repo lam profile trong van complete (khong phai cai tay)', () => {
  const tmp = makeTempDir();
  try {
    // Khong truyen bundleRoot -> dung vendor\extensions that cua repo.
    const state = checkSetup(makeConfig(tmp.dir));
    assert.equal(state.complete, true, 'vendor\\extensions phai du 3 extension - chay tools\\pack-extensions.mjs');
    assert.deepEqual(state.installed.map((m) => m.source), ['bundled', 'bundled', 'bundled']);
    // serp_export khong khai bao popup trong manifest (adapter cua no roi ve DOM),
    // nen chi kiem tra nhung extension co popup that su.
    for (const meta of state.installed.filter((m) => m.popupUrl)) {
      assert.ok(meta.popupUrl.startsWith(`chrome-extension://${meta.id}/`), `popupUrl sai cho ${meta.key}`);
    }
    assert.ok(state.installed.some((m) => m.popupUrl), 'phai co it nhat mot popupUrl');
  } finally {
    tmp.cleanup();
  }
});

test('checkSetup: ban trong profile duoc uu tien hon ban dong goi', () => {
  const tmp = makeTempDir();
  try {
    install(tmp.dir, IDS.ahrefs, 'Ahrefs SEO Toolbar');
    const state = checkSetup(makeConfig(tmp.dir));
    const byKey = Object.fromEntries(state.installed.map((m) => [m.key, m]));
    assert.equal(byKey.ahrefs.source, 'profile');
    assert.equal(byKey.serp_export.source, 'bundled');
  } finally {
    tmp.cleanup();
  }
});

test('writeSetupMarker: ghi marker setup-completed vao profile', () => {
  const tmp = makeTempDir();
  try {
    install(tmp.dir, IDS.ahrefs, 'Ahrefs SEO Toolbar');
    const config = makeConfig(tmp.dir);
    const state = checkSetup(config, emptyBundle(tmp.dir));
    const marker = writeSetupMarker(config, state.extensions);

    assert.ok(marker);
    const data = JSON.parse(fs.readFileSync(marker, 'utf8'));
    assert.equal(data['setup-completed'], true);
    assert.equal(data.extensions.ahrefs.id, IDS.ahrefs);
    assert.equal(data.extensions.ahrefs.version, '1.0.0_0');
    assert.ok(data.completed_at);
  } finally {
    tmp.cleanup();
  }
});

test('checkSetup: khong nem loi khi thu muc profile chua ton tai', () => {
  const tmp = makeTempDir();
  try {
    const state = checkSetup(
      makeConfig(path.join('C:', `khong-ton-tai-${Date.now()}`)),
      emptyBundle(tmp.dir),
    );
    assert.equal(state.complete, false);
    assert.equal(state.missing.length, 3);
  } finally {
    tmp.cleanup();
  }
});
