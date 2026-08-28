/**
 * Integration test: widget Ahrefs tren SERP (Keywords ideas / People also ask / country).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtureDocument, cssSpecs } from '../helpers/dom.mjs';
import { loadSelectors } from '../../src/core/config.mjs';
import {
  extractAhrefsList, readAhrefsCountry, readCountryFromWidget, parseCopiedList,
} from '../../src/extractors/ahrefs-dom.mjs';
import { normalizeList } from '../../src/core/text.mjs';
import { _internals } from '../../src/adapters/ahrefs-widget.mjs';

const sel = loadSelectors().ahrefs_widget;

function readPanel(panelSelector) {
  const document = loadFixtureDocument('ahrefs-widget.html');
  return extractAhrefsList({
    document,
    options: {
      containerSelectors: cssSpecs(sel.container),
      panelSelector,
      rowSelectors: cssSpecs(sel.rows),
      noise: sel.ui_noise,
      maxItems: 50,
    },
  });
}

test('ahrefs: doc Keywords ideas tu panel dang hien thi', () => {
  const result = readPanel('[role="tabpanel"]');
  assert.equal(result.found, true);
  assert.deepEqual(normalizeList(result.items, { noise: sel.ui_noise }), [
    'filipino vs samoan',
    'samoan vs filipino people',
    'are samoans polynesian',
  ]);
});

test('ahrefs: khong tron du lieu cua tab dang an (aria-hidden)', () => {
  const result = readPanel('[role="tabpanel"]');
  assert.ok(!result.items.some((i) => /Are Filipinos and Samoans related/i.test(i)));
});

test('ahrefs: loai dong UI (Copy, Sign in, Volume, KD) va dong rong', () => {
  const result = readPanel('[role="tabpanel"]');
  for (const noise of ['Copy', 'Sign in', 'Volume', 'KD']) {
    assert.ok(!result.items.includes(noise), `khong duoc chua "${noise}"`);
  }
  assert.ok(!result.items.some((i) => i.trim() === ''));
});

test('ahrefs: deduplicate khac capitalization, giu thu tu xuat hien', () => {
  const result = readPanel('[role="tabpanel"]');
  const normalized = normalizeList(result.items, { noise: sel.ui_noise });
  assert.equal(normalized.filter((i) => i.toLowerCase() === 'filipino vs samoan').length, 1);
  assert.equal(normalized[0], 'filipino vs samoan');
});

test('ahrefs: doc dung country dang chon', () => {
  const document = loadFixtureDocument('ahrefs-widget.html');
  const state = readAhrefsCountry({
    document,
    options: {
      containerSelectors: cssSpecs(sel.container),
      controlSelectors: cssSpecs(sel.country_control),
      usMarkers: sel.country_us_markers,
    },
  });
  assert.equal(state.found, true);
  assert.equal(state.isUS, true);
  assert.equal(state.text, 'United States');
});

/**
 * Hoi quy run 20260827-171404: selector CSS cua container da drift, widget chi
 * tim duoc bang fallback text_container. verifyUsMarket() cu loc bo text_container
 * roi chi dua CSS cho extractor -> khong doc duoc country -> canh bao
 * AHREFS_REGION_NOT_VERIFIED gan nhu tat yeu.
 *
 * Cach sua: doc country NGAY TRONG container da resolve, bat ke resolve bang
 * selector nao (dac ta Fast Path v1 - P1).
 */
test('ahrefs: doc duoc country trong widget da resolve du selector CSS da drift', () => {
  const document = loadFixtureDocument('ahrefs-widget.html');
  const widget = document.getElementById('ahrefs-seo-toolbar');

  const state = readCountryFromWidget(widget, {
    // KHONG truyen container selector: container da duoc resolve san.
    controlSelectors: cssSpecs(sel.country_control),
    usMarkers: sel.country_us_markers,
  });

  assert.equal(state.found, true);
  assert.equal(state.isUS, true);
  assert.equal(state.text, 'United States');
});

test('ahrefs: khong doc duoc country trong widget thi bao found=false, khong doan', () => {
  const document = loadFixtureDocument('ahrefs-widget.html');
  const empty = document.createElement('div');
  document.body.appendChild(empty);

  const state = readCountryFromWidget(empty, {
    controlSelectors: cssSpecs(sel.country_control),
    usMarkers: sel.country_us_markers,
  });
  assert.equal(state.found, false);
  assert.equal(state.isUS, false);
});

test('ahrefs: khong co widget thi tra ve found=false, khong nem loi', () => {
  const document = loadFixtureDocument('serp-page2.html');
  const result = extractAhrefsList({
    document,
    options: { containerSelectors: cssSpecs(sel.container), rowSelectors: cssSpecs(sel.rows) },
  });
  assert.equal(result.found, false);
  assert.deepEqual(result.items, []);
});

test('ahrefs: parse text tu clipboard (nut Copy) - lay cot dau tien', () => {
  const raw = 'filipino vs samoan\t1200\t45\nsamoan food\t300\t20\n\n  spaced keyword  \t10\t5\n';
  assert.deepEqual(parseCopiedList(raw), ['filipino vs samoan', 'samoan food', 'spaced keyword']);
});

test('ahrefs: bridge clipboardRead duoc uu tien, khong phu thuoc document focus', async () => {
  let evaluated = false;
  const page = {
    readClipboardText: async () => 'keyword from bridge',
    evaluate: async () => { evaluated = true; return 'wrong page clipboard'; },
  };
  assert.equal(await _internals.readClipboardText(page), 'keyword from bridge');
  assert.equal(evaluated, false);
});
