import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  discoverExtension, discoverAll, compareVersions, listProfileDirs, findInPersonalChrome,
} from '../../src/browser/extension-discovery.mjs';
import { makeTempDir } from '../helpers/dom.mjs';

const MV3_ID = 'oijhomofkbpbjldkdhkkjkcdokdigeie';
const MV2_ID = 'hgmoccdbjhknikckedaaebbpdeebhiei';

function installFixtureExtension(userDataDir, id, version, manifest) {
  const dir = path.join(userDataDir, 'Default', 'Extensions', id, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
  return dir;
}

test('compareVersions: so sanh theo tung so, khong theo chuoi', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('2.0.0_0', '10.0.0_0') < 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('discovery MV3: doc action.default_popup va service_worker', () => {
  const tmp = makeTempDir();
  try {
    installFixtureExtension(tmp.dir, MV3_ID, '2.1.0_0', {
      manifest_version: 3,
      name: 'SEO SERP Extraction Tool',
      action: { default_popup: 'popup/popup.html' },
      background: { service_worker: 'sw.js' },
    });
    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV3_ID });
    assert.equal(found.installed, true);
    assert.equal(found.manifestVersion, 3);
    assert.equal(found.version, '2.1.0_0');
    assert.equal(found.popupUrl, `chrome-extension://${MV3_ID}/popup/popup.html`);
    assert.equal(found.serviceWorker, 'sw.js');
  } finally {
    tmp.cleanup();
  }
});

test('discovery MV2: doc browser_action.default_popup', () => {
  const tmp = makeTempDir();
  try {
    installFixtureExtension(tmp.dir, MV2_ID, '5.0.1_0', {
      manifest_version: 2,
      name: 'Ahrefs SEO Toolbar',
      browser_action: { default_popup: '/popup.html' },
      background: { scripts: ['bg.js'] },
      options_page: 'options.html',
    });
    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV2_ID });
    assert.equal(found.manifestVersion, 2);
    assert.equal(found.popupUrl, `chrome-extension://${MV2_ID}/popup.html`);
    assert.equal(found.optionsUrl, `chrome-extension://${MV2_ID}/options.html`);
    assert.equal(found.serviceWorker, 'bg.js');
  } finally {
    tmp.cleanup();
  }
});

test('discovery: chon version cao nhat khi co nhieu ban', () => {
  const tmp = makeTempDir();
  try {
    installFixtureExtension(tmp.dir, MV3_ID, '1.9.0_0', { manifest_version: 3, name: 'old' });
    installFixtureExtension(tmp.dir, MV3_ID, '1.10.0_0', { manifest_version: 3, name: 'new' });
    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV3_ID });
    assert.equal(found.version, '1.10.0_0');
    assert.equal(found.name, 'new');
  } finally {
    tmp.cleanup();
  }
});

test('discovery: extension khong co popup van bao installed nhung popupUrl = null', () => {
  const tmp = makeTempDir();
  try {
    installFixtureExtension(tmp.dir, MV3_ID, '1.0.0_0', {
      manifest_version: 3, name: 'No popup', background: { service_worker: 'sw.js' },
    });
    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV3_ID });
    assert.equal(found.installed, true);
    assert.equal(found.popupUrl, null);
  } finally {
    tmp.cleanup();
  }
});

test('discovery: chua cai thi bao ly do ro rang', () => {
  const tmp = makeTempDir();
  try {
    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV3_ID });
    assert.equal(found.installed, false);
    assert.equal(found.reason, 'EXTENSION_DIR_NOT_FOUND');
  } finally {
    tmp.cleanup();
  }
});

test('discovery: manifest hong thi khong crash', () => {
  const tmp = makeTempDir();
  try {
    const dir = path.join(tmp.dir, 'Default', 'Extensions', MV3_ID, '1.0.0_0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ khong-phai-json', 'utf8');
    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV3_ID });
    assert.equal(found.installed, false);
    assert.ok(found.reason.startsWith('MANIFEST_INVALID'));
  } finally {
    tmp.cleanup();
  }
});

test('discoverAll: tra ve du ba extension trong config', () => {
  const tmp = makeTempDir();
  try {
    installFixtureExtension(tmp.dir, MV2_ID, '1.0.0_0', { manifest_version: 2, name: 'Ahrefs' });
    const config = {
      browser: { user_data_dir: tmp.dir },
      extensions: {
        ahrefs: { id: MV2_ID, name: 'Ahrefs SEO Toolbar', webstore: 'https://x' },
        serp_export: { id: MV3_ID, name: 'SEO SERP Extraction Tool', webstore: 'https://y' },
        suggestions: { id: 'lbgklcfhclfdeapdabmcphhkomkofbga', name: 'Suggestion Extractor', webstore: 'https://z' },
      },
    };
    const all = discoverAll(config);
    assert.equal(Object.keys(all).length, 3);
    assert.equal(all.ahrefs.installed, true);
    assert.equal(all.serp_export.installed, false);
    assert.equal(all.suggestions.webstore, 'https://z');
  } finally {
    tmp.cleanup();
  }
});

test('listProfileDirs: nhan dien Default va Profile N, bo qua thu muc khac', () => {
  const tmp = makeTempDir();
  try {
    for (const name of ['Default', 'Profile 1', 'Profile 10', 'Crashpad', 'ShaderCache']) {
      fs.mkdirSync(path.join(tmp.dir, name), { recursive: true });
    }
    const profiles = listProfileDirs(tmp.dir);
    assert.deepEqual(profiles, ['Default', 'Profile 1', 'Profile 10']);
    assert.equal(profiles[0], 'Default', 'Default phai duoc uu tien truoc');
  } finally {
    tmp.cleanup();
  }
});

test('discovery: tim thay extension nam o "Profile 1" chu khong phai "Default"', () => {
  const tmp = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmp.dir, 'Default'), { recursive: true });
    const dir = path.join(tmp.dir, 'Profile 1', 'Extensions', MV3_ID, '3.0.0_0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'In Profile 1', action: { default_popup: 'popup.html' },
    }), 'utf8');

    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV3_ID });
    assert.equal(found.installed, true);
    assert.equal(found.profileDir, 'Profile 1');
    assert.equal(found.popupUrl, `chrome-extension://${MV3_ID}/popup.html`);
  } finally {
    tmp.cleanup();
  }
});

test('discovery: bao ro da quet nhung profile nao khi khong tim thay', () => {
  const tmp = makeTempDir();
  try {
    fs.mkdirSync(path.join(tmp.dir, 'Default'), { recursive: true });
    fs.mkdirSync(path.join(tmp.dir, 'Profile 2'), { recursive: true });
    const found = discoverExtension({ userDataDir: tmp.dir, extensionId: MV3_ID });
    assert.equal(found.installed, false);
    assert.deepEqual(found.searchedProfiles, ['Default', 'Profile 2']);
  } finally {
    tmp.cleanup();
  }
});

test('findInPersonalChrome: chi kiem tra ten thu muc, khong doc du lieu profile', () => {
  const tmp = makeTempDir();
  try {
    const root = path.join(tmp.dir, 'Google', 'Chrome', 'User Data');
    fs.mkdirSync(path.join(root, 'Default', 'Extensions', MV2_ID), { recursive: true });
    fs.mkdirSync(path.join(root, 'Profile 6', 'Extensions', MV2_ID), { recursive: true });
    fs.mkdirSync(path.join(root, 'Profile 6', 'Extensions', MV3_ID), { recursive: true });

    const hits = findInPersonalChrome([MV2_ID, MV3_ID], { LOCALAPPDATA: tmp.dir });
    assert.deepEqual(hits[MV2_ID], ['Default', 'Profile 6']);
    assert.deepEqual(hits[MV3_ID], ['Profile 6']);
  } finally {
    tmp.cleanup();
  }
});

test('findInPersonalChrome: khong co LOCALAPPDATA thi tra ve rong, khong nem loi', () => {
  assert.deepEqual(findInPersonalChrome([MV2_ID], {}), {});
});
