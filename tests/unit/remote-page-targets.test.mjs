/**
 * Bam vao target con (<webview>) de doc AI Mode.
 *
 * Boi canh loi that (run 2026-08-27): tool mo duoc https://google.com/search?udm=50
 * nhung khong tim thay o nhap prompt, muc "AI Mode" ra rong. Nguyen nhan la
 * Chrome khong tai AI Mode trong tab nua ma nhet trang google that vao mot
 * <webview> ben trong chrome://contextual-tasks/ - document CUA TAB khong he
 * chua o nhap prompt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { RemotePage, _internals } from '../../src/engine/remote-page.mjs';

const TAB_ID = 7;

/** Bridge gia: ghi lai moi lenh de kiem tra lenh CDP di toi dau. */
function fakeBridge(targets) {
  const calls = [];
  return {
    calls,
    on() {},
    off() {},
    async call(method, params) {
      calls.push({ method, params });
      if (method === 'getTargets') return { targets };
      if (method === 'attachTarget') return { attached: true };
      if (method === 'detachTarget') return { detached: true };
      if (method === 'cdp') return { result: { value: null } };
      return null;
    },
    /** Lenh CDP that su (bo qua cac lenh enable domain luc mo phien). */
    cdpCalls() {
      return calls.filter((c) => c.method === 'cdp' && !/\.enable$/.test(c.params.method));
    },
  };
}

function makePage(bridge) {
  return new RemotePage({
    context: { _markVisible() {}, _forget() {} },
    bridge,
    tabId: TAB_ID,
    logger: { info() {}, debug() {}, warn() {} },
  });
}

const GOOGLE_AI = /^https?:\/\/([a-z0-9-]+\.)*google\.[a-z.]+\/search/i;

test('bam vao <webview> chua trang google, bo qua chinh target cua tab', async () => {
  const bridge = fakeBridge([
    { id: 'tab-target', type: 'page', tabId: TAB_ID, url: 'chrome://contextual-tasks/' },
    { id: 'aim', type: 'webview', url: 'https://www.google.com/search?udm=50&q=x' },
    { id: 'khac', type: 'page', tabId: 99, url: 'https://www.google.com/search?q=tab-nguoi-dung' },
  ]);
  const page = makePage(bridge);

  const picked = await page.adoptEmbeddedTarget({ match: GOOGLE_AI, timeoutMs: 100 });

  assert.equal(picked.id, 'aim');
  assert.equal(page.embeddedTargetId, 'aim');
  assert.equal(page.url(), 'https://www.google.com/search?udm=50&q=x');
  assert.ok(bridge.calls.some((c) => c.method === 'attachTarget' && c.params.targetId === 'aim'));
});

test('sau khi bam, moi lenh CDP di toi target con chu khong con toi tab', async () => {
  const bridge = fakeBridge([
    { id: 'tab-target', type: 'page', tabId: TAB_ID, url: 'chrome://contextual-tasks/' },
    { id: 'aim', type: 'webview', url: 'https://www.google.com/search?udm=50&q=x' },
  ]);
  const page = makePage(bridge);

  await page.adoptEmbeddedTarget({ match: GOOGLE_AI, timeoutMs: 100 });
  await page.evaluate(() => 1);

  const last = bridge.cdpCalls().at(-1);
  assert.equal(last.params.targetId, 'aim');
  assert.equal(last.params.tabId, null);
});

test('releaseTarget dua lenh CDP ve lai chinh tab', async () => {
  const bridge = fakeBridge([
    { id: 'tab-target', type: 'page', tabId: TAB_ID, url: 'chrome://contextual-tasks/' },
    { id: 'aim', type: 'webview', url: 'https://www.google.com/search?udm=50&q=x' },
  ]);
  const page = makePage(bridge);

  await page.adoptEmbeddedTarget({ match: GOOGLE_AI, timeoutMs: 100 });
  await page.releaseTarget();
  await page.evaluate(() => 1);

  assert.equal(page.embeddedTargetId, null);
  const last = bridge.cdpCalls().at(-1);
  assert.equal(last.params.tabId, TAB_ID);
  assert.equal(last.params.targetId, null);
  assert.ok(bridge.calls.some((c) => c.method === 'detachTarget' && c.params.targetId === 'aim'));
});

test('khong co target nao khop thi tra ve null va van lam viec tren tab', async () => {
  const bridge = fakeBridge([
    { id: 'tab-target', type: 'page', tabId: TAB_ID, url: 'https://www.google.com/search?udm=50' },
    { id: 'khac', type: 'page', tabId: 99, url: 'https://vi.wikipedia.org/' },
  ]);
  const page = makePage(bridge);

  const picked = await page.adoptEmbeddedTarget({ match: GOOGLE_AI, timeoutMs: 100, pollMs: 10 });

  assert.equal(picked, null);
  assert.equal(page.embeddedTargetId, null);
});

test('dieu huong tab thi bo target con dang bam (no se bien mat)', async () => {
  const bridge = fakeBridge([
    { id: 'tab-target', type: 'page', tabId: TAB_ID, url: 'chrome://contextual-tasks/' },
    { id: 'aim', type: 'webview', url: 'https://www.google.com/search?udm=50&q=x' },
  ]);
  const page = makePage(bridge);
  await page.adoptEmbeddedTarget({ match: GOOGLE_AI, timeoutMs: 100 });

  await page.goto('https://www.google.com/search?q=moi', { timeout: 50 });

  assert.equal(page.embeddedTargetId, null);
  const navigate = bridge.cdpCalls().find((c) => c.params.method === 'Page.navigate');
  assert.equal(navigate.params.tabId, TAB_ID);
  assert.equal(navigate.params.targetId, null);
});

test('webview duoc uu tien hon iframe/page khi nhieu target cung khop', () => {
  const { rankTarget } = _internals;
  assert.ok(rankTarget({ type: 'webview' }) < rankTarget({ type: 'iframe' }));
  assert.ok(rankTarget({ type: 'iframe' }) < rankTarget({ type: 'page' }));
  assert.ok(rankTarget({ type: 'page' }) < rankTarget({ type: 'other' }));
});
