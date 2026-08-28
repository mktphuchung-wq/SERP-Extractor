/**
 * Deadline tong cho selector + bo nho selector (dac ta Fast Path v1 - P0).
 *
 * Boi canh loi that (run 20260827-171404):
 *   `ahrefs_timeout_ms: 15000` KHONG phai deadline tong. firstVisible() dung ca
 *   15 giay cho spec dau, roi cong them `perSpec` cho tung fallback. Ket qua:
 *   Keywords Ideas mat 23,1 giay va PAA lap lai nguyen qua trinh, mat them
 *   23,2 giay - 23,7% tong thoi gian run chi de tim cung mot khoi DOM.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { firstVisible } from '../../src/browser/locator.mjs';
import { createSelectorMemory, specKey } from '../../src/browser/selector-memory.mjs';

/**
 * Scope gia: selector nao co trong `visible` thi thay ngay, con lai treo den
 * het timeout roi nem loi - dung nhu Playwright waitFor().
 */
function fakeScope(visible, log = []) {
  return {
    log,
    locator(css) {
      return {
        first() { return this; },
        async waitFor(options) {
          log.push({ css, timeout: options.timeout });
          if (visible.includes(css)) return;
          await new Promise((r) => setTimeout(r, options.timeout));
          throw new Error(`timeout ${css}`);
        },
      };
    },
  };
}

const SPECS = [
  { type: 'css', css: '#a' },
  { type: 'css', css: '#b' },
  { type: 'css', css: '#c' },
  { type: 'css', css: '#d' },
];

test('timeout la deadline TONG, khong phai ngan sach cua rieng spec dau', async () => {
  const log = [];
  const startedAt = Date.now();
  const found = await firstVisible(fakeScope([], log), SPECS, { timeout: 900, perSpec: 400 });
  const elapsed = Date.now() - startedAt;

  assert.equal(found, null);
  assert.ok(elapsed < 1400, `phai dung o khoang deadline tong, dang mat ${elapsed}ms`);
  const granted = log.reduce((sum, entry) => sum + entry.timeout, 0);
  assert.ok(granted <= 900, `tong thoi gian cap cho cac spec phai <= 900ms, dang la ${granted}ms`);
});

test('spec dau khong duoc nuot ca timeout nua', async () => {
  const log = [];
  await firstVisible(fakeScope([], log), SPECS, { timeout: 1000, perSpec: 200 });
  assert.equal(log[0].timeout, 200, 'spec dau chi duoc perSpec, khong phai ca timeout');
});

test('spec cuoi bi cat ngan theo phan deadline con lai', async () => {
  const log = [];
  await firstVisible(fakeScope([], log), SPECS, { timeout: 500, perSpec: 200 });
  const last = log[log.length - 1];
  assert.ok(last.timeout <= 200);
  assert.ok(log.length <= SPECS.length);
});

test('khong truyen timeout thi giu hanh vi cu (perSpec cho tung spec)', async () => {
  const log = [];
  const found = await firstVisible(fakeScope(['#d'], log), SPECS, { perSpec: 120 });
  assert.ok(found, 'van phai duyet het danh sach de tim ra #d');
  assert.equal(found.index, 3);
});

test('index tra ve theo THU TU GOC trong config, khong theo thu tu da sap lai', async () => {
  const memory = createSelectorMemory();
  const first = await firstVisible(fakeScope(['#c']), SPECS, {
    perSpec: 60, memory, block: 'ahrefs_widget.container',
  });
  assert.equal(first.index, 2);

  const again = await firstVisible(fakeScope(['#c']), SPECS, {
    perSpec: 60, memory, block: 'ahrefs_widget.container',
  });
  assert.equal(again.index, 2, 'van la spec thu 3 trong config');
});

test('selector da thang duoc thu TRUOC o lan sau (khong duyet lai tu dau)', async () => {
  const memory = createSelectorMemory();
  const firstLog = [];
  await firstVisible(fakeScope(['#c'], firstLog), SPECS, {
    perSpec: 60, memory, block: 'ahrefs_widget.container',
  });
  assert.deepEqual(firstLog.map((e) => e.css), ['#a', '#b', '#c']);

  const secondLog = [];
  await firstVisible(fakeScope(['#c'], secondLog), SPECS, {
    perSpec: 60, memory, block: 'ahrefs_widget.container',
  });
  assert.deepEqual(secondLog.map((e) => e.css), ['#c'], 'lan sau phai tim thay ngay o spec da nho');
});

test('SELECTOR_DRIFT chi canh bao mot lan cho moi block trong ca run', async () => {
  const memory = createSelectorMemory();
  const drifts = [];
  const logger = { debug() {}, selectorDrift: (block, primary, used) => drifts.push({ block, primary, used }) };

  await firstVisible(fakeScope(['#c']), SPECS, { perSpec: 60, memory, logger, block: 'ahrefs_widget.container' });
  await firstVisible(fakeScope(['#c']), SPECS, { perSpec: 60, memory, logger, block: 'ahrefs_widget.container' });

  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].used, "css=#c");
});

test('selector da nho ma khong con dung thi bi quen di', async () => {
  const memory = createSelectorMemory();
  await firstVisible(fakeScope(['#c']), SPECS, { perSpec: 40, memory, block: 'blk' });
  assert.equal(memory.peek('blk').key, specKey({ type: 'css', css: '#c' }));

  await firstVisible(fakeScope([]), SPECS, { perSpec: 20, memory, block: 'blk' });
  assert.equal(memory.peek('blk'), null, 'khong tim thay nua thi phai quen de lan sau duyet lai');
});

test('fallbacks() ghi lai dung cac block dang phai dung selector du phong', async () => {
  const memory = createSelectorMemory();
  await firstVisible(fakeScope(['#c']), SPECS, { perSpec: 40, memory, block: 'ahrefs_widget.container' });
  await firstVisible(fakeScope(['#a']), SPECS, { perSpec: 40, memory, block: 'ai_overview.container' });

  const fallbacks = memory.fallbacks();
  assert.equal(fallbacks.length, 1, 'chi block dang dung fallback moi duoc ghi');
  assert.equal(fallbacks[0].block, 'ahrefs_widget.container');
  assert.equal(fallbacks[0].primary, specKey({ type: 'css', css: '#a' }));
  assert.equal(fallbacks[0].used, specKey({ type: 'css', css: '#c' }));
});
