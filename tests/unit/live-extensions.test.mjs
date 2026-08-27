/**
 * Phat hien extension trong trinh duyet DANG CHAY (engine bridge).
 *
 * Boi canh loi that (run 2026-08-27): nhanh bridge dat state.extensions = {},
 * nen adapter nao cung thay "chua cai" va SEO SERP Extraction Tool khong bao gio
 * duoc goi - ca hai file CSV deu roi ve native extractor du extension dang bat
 * ngay trong chinh trinh duyet do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { discoverLive } from '../../src/engine/live-extensions.mjs';
import { describeManifest } from '../../src/browser/extension-discovery.mjs';

const CONFIG = {
  extensions: {
    serp_export: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'SEO SERP Extraction Tool', webstore: 'https://store/serp' },
    ahrefs: { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Ahrefs SEO Toolbar', webstore: 'https://store/ahrefs' },
  },
};

/**
 * Trinh duyet gia: mot ban do URL -> noi dung trang.
 * URL khong co trong ban do se bi "chan", giong het cach Chrome xu ly
 * chrome-extension:// cua extension chua cai (khong dieu huong, URL giu nguyen).
 */
function fakeContext(pages) {
  const opened = [];
  let current = 'about:blank';
  const page = {
    opened,
    closed: false,
    async goto(url) {
      opened.push(url);
      if (Object.prototype.hasOwnProperty.call(pages, url)) current = url;
      return null;
    },
    url: () => current,
    async syncUrl() { return current; },
    async evaluate(fn) {
      const body = pages[current];
      if (body == null) return fn.toString().includes('innerText') ? '' : false;
      // Hai bieu thuc duy nhat ma live-extensions.mjs dung.
      return fn.toString().includes('innerText') ? body : body.trim().length > 0;
    },
    async close() { this.closed = true; },
  };
  return {
    page,
    newPageCalls: opened,
    async newPage() { return page; },
  };
}

const SERP_MANIFEST = JSON.stringify({
  manifest_version: 3,
  name: 'SEO SERP Extraction Tool',
  version: '3.2.1',
  action: { default_popup: 'popup.html' },
});

test('doc duoc manifest tu trinh duyet dang chay -> installed + popupUrl dung', async () => {
  const context = fakeContext({
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/manifest.json': SERP_MANIFEST,
  });

  const found = await discoverLive({ context, config: CONFIG });

  assert.equal(found.serp_export.installed, true);
  assert.equal(found.serp_export.name, 'SEO SERP Extraction Tool');
  assert.equal(found.serp_export.version, '3.2.1');
  assert.equal(found.serp_export.source, 'live');
  assert.equal(
    found.serp_export.popupUrl,
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html',
  );
  // Cai thu hai khong co trong trinh duyet -> bao dung su that, khong doan bua.
  assert.equal(found.ahrefs.installed, false);
  assert.equal(found.ahrefs.reason, 'NOT_IN_RUNNING_BROWSER');
  assert.equal(found.ahrefs.configuredName, 'Ahrefs SEO Toolbar');
  assert.equal(found.ahrefs.webstore, 'https://store/ahrefs');
});

test('manifest khong doc duoc thi thu tim thang trang popup', async () => {
  const context = fakeContext({
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html': '<body><button>Extract</button></body>',
  });

  const found = await discoverLive({ context, config: CONFIG });

  assert.equal(found.serp_export.installed, true);
  assert.equal(found.serp_export.reason, 'MANIFEST_UNREADABLE_POPUP_GUESSED');
  assert.equal(
    found.serp_export.popupUrl,
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html',
  );
});

test('trang tra ve rac (khong phai JSON) khong duoc coi la manifest', async () => {
  const context = fakeContext({
    'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/manifest.json': '<html>Loi</html>',
  });

  const found = await discoverLive({ context, config: CONFIG });

  assert.equal(found.serp_export.installed, false);
});

test('tab kiem tra luon duoc dong lai du co tim thay gi hay khong', async () => {
  const context = fakeContext({});
  await discoverLive({ context, config: CONFIG });
  assert.equal(context.page.closed, true);
});

test('khong mo duoc tab kiem tra thi bao ro, khong nem loi lam vo run', async () => {
  const context = { async newPage() { throw new Error('tab bi tu choi'); } };
  const warnings = [];
  const found = await discoverLive({
    context, config: CONFIG, logger: { warn: (m, d) => warnings.push({ m, d }) },
  });

  assert.equal(found.serp_export.installed, false);
  assert.equal(found.serp_export.reason, 'PROBE_TAB_FAILED');
  assert.equal(warnings.length, 1);
});

test('describeManifest doc duoc ca MV2 lan MV3', () => {
  const mv3 = describeManifest(
    { manifest_version: 3, name: 'A', version: '1.0', action: { default_popup: '/ui/popup.html' } },
    'id3',
  );
  assert.equal(mv3.popupUrl, 'chrome-extension://id3/ui/popup.html');

  const mv2 = describeManifest(
    {
      manifest_version: 2,
      name: 'B',
      version: '2.0',
      browser_action: { default_popup: 'popup.html' },
      options_ui: { page: 'options.html' },
    },
    'id2',
  );
  assert.equal(mv2.popupUrl, 'chrome-extension://id2/popup.html');
  assert.equal(mv2.optionsUrl, 'chrome-extension://id2/options.html');
});
