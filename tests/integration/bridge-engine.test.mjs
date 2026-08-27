/**
 * Kiem chung engine V2 tren Chrome THAT.
 *
 * Nhung test nay chung minh cac mat xich ma khong the kiem tra bang fixture:
 *   - Extension noi duoc toi bridge va nhan lenh
 *   - Tab duoc mo NGAY TRONG cua so Chrome dang chay (khong spawn tien trinh)
 *   - Locator kieu Playwright (role/text/css) giai dung tren DOM that
 *   - Go phim THAT lam trang phan ung (dieu chrome.scripting khong lam duoc)
 *   - Extractor trong src/extractors/ chay y nguyen qua page.evaluate cua engine moi
 *
 * Test tu SKIP neu khong tim thay Chrome - giong cac test Chrome khac trong repo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

import { BridgeServer } from '../../src/bridge/bridge-server.mjs';
import { servePairingPage } from '../../src/engine/pairing.mjs';
import { connectViaBridge } from '../../src/engine/remote-browser.mjs';
import { BRIDGE_EXTENSION_ID, BRIDGE_EXTENSION_DIR } from '../../src/engine/bridge-extension.mjs';
import { firstVisible, clickFirstVisible } from '../../src/browser/locator.mjs';
import { runExtractor } from '../../src/browser/page-eval.mjs';
import { extractOrganicResults } from '../../src/extractors/native-serp.mjs';
import { BUNDLED_CHROME } from '../../src/browser/chrome-launcher.mjs';

const CHROME = process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)
  ? process.env.CHROME_PATH
  : (fs.existsSync(BUNDLED_CHROME) ? BUNDLED_CHROME : null);

const SKIP = !CHROME ? { skip: 'Khong tim thay Chrome de chay test engine V2.' } : {};

/** Trang thu: co du role/text/css, o nhap lieu, va mot khoi ket qua kieu SERP. */
const PAGE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Trang thu</title></head>
<body>
  <button aria-label="Show more">Show more</button>
  <div id="marker">chua bam</div>
  <input id="q" name="q" aria-label="Search" autocomplete="off">
  <ul id="drop" role="listbox" hidden></ul>
  <div id="rso">
    <div class="g"><a href="https://vi.dụ.com/mot"><h3>Ket qua mot</h3></a><div>Mo ta mot</div></div>
    <div class="g"><a href="https://vi.dụ.com/hai"><h3>Ket qua hai</h3></a><div>Mo ta hai</div></div>
  </div>
  <script>
    document.querySelector('button').addEventListener('click', () => {
      document.getElementById('marker').textContent = 'da bam that';
    });
    // Chi phan ung voi su kien ban phim THAT (isTrusted). Day la cach
    // tai hien hanh vi cua o tim kiem Google.
    document.getElementById('q').addEventListener('keydown', (e) => {
      if (!e.isTrusted) return;
      const drop = document.getElementById('drop');
      drop.hidden = false;
      drop.innerHTML = '<li role="option">goi y mot</li><li role="option">goi y hai</li>';
    });
  </script>
</body></html>`;

async function withEngine(run) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE_HTML);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;

  const bridge = new BridgeServer({ port: 0 });
  const { port, token } = await bridge.start();
  servePairingPage(bridge.server.server, { token, port, extensionId: BRIDGE_EXTENSION_ID });

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'serp-bridge-test-'));

  // Khoi dong Chrome TRUOC, roi moi mo trang ghep noi - dung nhu doi that,
  // noi nguoi dung da co san mot cua so Chrome dang mo.
  //
  // Thu tu nay quan trong: neu Chrome khoi dong lanh va mo THANG vao trang
  // ghep noi, service worker cua extension chua kip chay va tin nhan
  // sendMessage roi vao hu khong. Da do thuc te ngay 2026-08-26.
  const chrome = spawn(CHROME, [
    `--user-data-dir=${profile}`,
    `--load-extension=${BRIDGE_EXTENSION_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { detached: false, stdio: 'ignore' });

  let browser;
  try {
    await new Promise((r) => { setTimeout(r, 4000); });
    // Tien trinh chrome.exe thu hai voi cung user-data-dir se dinh tuyen URL
    // vao cua so dang chay thay vi mo trinh duyet moi - dung co che ma
    // openPairingPage() dung o moi truong that.
    spawn(CHROME, [
      `--user-data-dir=${profile}`,
      `http://127.0.0.1:${port}/pair?token=${encodeURIComponent(token)}`,
    ], { detached: true, stdio: 'ignore' }).unref();

    await bridge.waitForClient(60000);
    browser = await connectViaBridge({ bridge });
    const context = browser.contexts()[0];
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: 'load', timeout: 20000 });
    await run({ page, context, browser, bridge, pageUrl });
  } finally {
    try { await bridge.close(); } catch { /* ignore */ }
    try { chrome.kill(); } catch { /* ignore */ }
    server.close();
    // Windows giu file cua profile them mot luc sau khi Chrome thoat, nen
    // xoa ngay se bao EPERM. Doi mot nhip roi thu; that bai cung khong sao
    // vi day chi la thu muc tam.
    await new Promise((r) => { setTimeout(r, 1500); });
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch { /* thu muc tam, HDH se don sau */ }
  }
}

test('engine V2 mo tab trong Chrome dang chay va doc duoc trang', SKIP, async () => {
  await withEngine(async ({ page, pageUrl }) => {
    assert.equal(page.url(), pageUrl, 'page.url() phai tra ve URL that');
    const title = await page.evaluate(() => document.title);
    assert.equal(title, 'Trang thu');
  });
});

test('locator giai duoc spec role / text / css tren DOM that', SKIP, async () => {
  await withEngine(async ({ page }) => {
    const byRole = await firstVisible(page, [
      { type: 'role', role: 'button', name: '(?i)^show more$' },
    ], { timeout: 5000 });
    assert.ok(byRole, 'phai tim thay nut theo role + accessible name');

    const byText = await firstVisible(page, [
      { type: 'text', text: '(?i)^show more$' },
    ], { timeout: 5000 });
    assert.ok(byText, 'phai tim thay theo text');

    const byCss = await firstVisible(page, [{ type: 'css', css: '#rso' }], { timeout: 5000 });
    assert.ok(byCss, 'phai tim thay theo css');

    // Spec dau hong -> phai roi ve spec sau (co che SELECTOR_DRIFT)
    const drifted = await firstVisible(page, [
      { type: 'css', css: '#khong-ton-tai' },
      { type: 'css', css: '#rso' },
    ], { timeout: 2000, perSpec: 800 });
    assert.equal(drifted.index, 1, 'phai dung fallback khi spec dau khong thay');
  });
});

test('click phat sinh su kien chuot THAT', SKIP, async () => {
  await withEngine(async ({ page }) => {
    const clicked = await clickFirstVisible(page, [
      { type: 'role', role: 'button', name: '(?i)^show more$' },
    ], { perSpec: 3000 });
    assert.equal(clicked, true);
    const marker = await page.evaluate(() => document.getElementById('marker').textContent);
    assert.equal(marker, 'da bam that');
  });
});

test('go phim that lam dropdown bung ra (chrome.scripting khong lam duoc)', SKIP, async () => {
  await withEngine(async ({ page }) => {
    const box = await firstVisible(page, [{ type: 'css', css: '#q' }], { timeout: 5000 });
    assert.ok(box);
    await box.locator.click({ timeout: 5000 });
    await box.locator.pressSequentially('abc', { delay: 30 });

    const items = await page.evaluate(
      () => Array.from(document.querySelectorAll('#drop li')).map((li) => li.textContent),
    );
    assert.deepEqual(items, ['goi y mot', 'goi y hai'], 'dropdown chi mo khi su kien la that');
  });
});

test('extractor trong src/extractors chay y nguyen tren engine moi', SKIP, async () => {
  await withEngine(async ({ page }) => {
    const rows = await runExtractor(page, extractOrganicResults, {
      options: {
        containers: ['#rso'],
        excludeContainers: [],
        excludeTextAnchors: [],
        excludeUrlPatterns: [],
        featuredContainers: [],
        sourcePage: 1,
        startOffset: 0,
        capturedAt: new Date().toISOString(),
      },
    });
    assert.equal(rows.length, 2, 'phai lay dung 2 ket qua organic');
    assert.equal(rows[0].title, 'Ket qua mot');
    assert.equal(rows[0].position, 1);
  });
});

test('dong tab va nhieu tab song song', SKIP, async () => {
  await withEngine(async ({ context, pageUrl }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await Promise.all([
      a.goto(pageUrl, { waitUntil: 'load', timeout: 20000 }),
      b.goto(pageUrl, { waitUntil: 'load', timeout: 20000 }),
    ]);
    assert.ok(context.pages().length >= 3, 'phai co it nhat 3 tab');

    await a.close();
    assert.equal(a.isClosed(), true);
    assert.equal(context.pages().includes(a), false, 'tab dong phai bi go khoi danh sach');
    await b.close();
  });
});

test('extension tu ket noi lai sau khi WebSocket bi dong giua run', SKIP, async () => {
  await withEngine(async ({ page, bridge }) => {
    const firstConnection = bridge.conn;
    assert.ok(firstConnection, 'phai co socket ban dau');

    // 1012 = Service Restart. Day la mot disconnect that tren day WebSocket,
    // khong phai goi truc tiep ham reconnect cua extension.
    firstConnection.close(1012, 'integration-test-service-restart');
    await bridge.waitForClient(10000);

    assert.notEqual(bridge.conn, firstConnection, 'phai tao socket moi');
    assert.equal(bridge.connected, true);
    assert.equal(await page.evaluate(() => document.title), 'Trang thu');
  });
});
