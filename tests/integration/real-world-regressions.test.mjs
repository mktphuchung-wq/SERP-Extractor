/**
 * Test hoi quy cho cac loi phat hien tu RUN THAT tren Google
 * (keyword "Father's Day Outfit Ideas", 2026-08-21).
 *
 * 1. Goi y bi dinh chu "Delete" cua nut xoa lich su tim kiem.
 * 2. Khoi UI "Share public link" cua AI Mode lot vao cuoi cau tra loi.
 * 3. Google tra ve 20 ket qua o Page 1 du num=10 -> Page 2 bi danh so chong lan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadFixtureDocument, cssSpecs } from '../helpers/dom.mjs';
import { loadSelectors } from '../../src/core/config.mjs';
import { extractSuggestionDropdown } from '../../src/extractors/suggestions-dom.mjs';
import { trimTrailingUi, _internals as aiInternals } from '../../src/adapters/ai-mode.mjs';
import { nextPagePositionOffset } from '../../src/adapters/serp-export.mjs';
import { normalizeList } from '../../src/core/text.mjs';
import { WORKFLOW_PHASES } from '../../src/orchestrator.mjs';

const selectors = loadSelectors();
const sugSel = selectors.google_suggestions;
const aiSel = selectors.ai_prompt_box;

test('hoi quy: workflow dung thu tu Suggest -> Ahrefs -> 2 CSV -> AI Overview Page 1', () => {
  assert.deepEqual(WORKFLOW_PHASES, [
    'suggestions',
    'ahrefs-keyword-ideas',
    'ahrefs-paa',
    'serp-page-1-and-page-2',
    'ai-overview-page-1',
  ]);
});

test('hoi quy: copy answer ho tro icon role=button, khong can chu Copy hien thi', () => {
  const css = aiSel.copy_button.filter((spec) => spec.type === 'css').map((spec) => spec.css).join(' ');
  assert.match(css, /button\[aria-label='Copy text' i\]/);
});

test('hoi quy: uu tien Copy text cua answer, khong lay Copy kem nguyen prompt', () => {
  const primary = aiSel.copy_button[0];
  const re = new RegExp(primary.name.replace(/^\(\?i\)/, ''), 'i');
  assert.equal(re.test('Copy text'), true);
  assert.equal(re.test('Copy Create a concise SEO content brief'), false);
});

test('hoi quy: Show more khop aria-label that "Show more AI Overview"', () => {
  const primary = selectors.ai_overview.show_more[0];
  const re = new RegExp(primary.name.replace(/^\(\?i\)/, ''), 'i');
  assert.equal(re.test('Show more AI Overview'), true);
  const css = selectors.ai_overview.show_more.filter((spec) => spec.type === 'css').map((spec) => spec.css);
  assert.ok(css.some((value) => value.includes("aria-label='Show more AI Overview'")));
});

test('hoi quy: AI Mode URL binh thuong khong duoc nhay nham sang tab Google khac', async () => {
  let adopted = false;
  const page = {
    url: () => 'https://www.google.com/search?q=test&udm=50',
    adoptEmbeddedTarget: async () => { adopted = true; return { targetId: 'wrong' }; },
  };
  const picked = await aiInternals.adoptAiSurface(page, selectors.ai_overview, null);
  assert.equal(picked, false);
  assert.equal(adopted, false);
});

test('hoi quy: embedded target AI chi khop www.google search, khong khop Search Console', () => {
  const pattern = selectors.ai_overview.embedded_target_url.replace(/^\(\?i\)/, '');
  const re = new RegExp(pattern, 'i');
  assert.equal(re.test('https://www.google.com/search?q=test&udm=50'), true);
  assert.equal(re.test('https://search.google.com/search-console/index?resource_id=x'), false);
});

/* ------------------------------- Bam nham control cua UI khac (2026-08-27) --
 * Keyword "Scottish Girl Names". Hai run lien tiep hong vi adapter tim nut tren
 * TOAN TRANG roi bam trung nut cua UI khac:
 *   run 20260827-153106 - `button[type='submit']` khop nut Search cua Google;
 *   run 20260827-152533 - bam mot nut Copy khong ghi gi, roi doc lai noi dung
 *                         PAA con sot trong clipboard -> lot vao muc AI Mode.
 */

test('hoi quy: submit cua AI khong duoc dung button[type=submit] tren toan trang', () => {
  // Tren SERP that, phan tu duy nhat khop la nut Search cua Google:
  //   <button jsname="Tg7LZd" aria-label="Search" type="submit">
  const css = aiSel.submit.filter((spec) => spec.type === 'css').map((spec) => spec.css);
  assert.ok(
    !css.some((value) => /type\s*=\s*['"]?submit/i.test(value)),
    `selector submit khong duoc quet button[type=submit]: ${css.join(' | ')}`,
  );
});

test('hoi quy: control_exclude khai bao du nut Search cua Google va thanh Ahrefs', () => {
  const exclude = aiSel.control_exclude ?? [];
  assert.ok(exclude.includes('#tsf'), 'phai chan form tim kiem cua Google');
  assert.ok(exclude.includes('.ah_tb-btn-link'), 'phai chan nut cua thanh Ahrefs Toolbar');
  assert.ok(Number(aiSel.container_up) > 0, 'phai khai bao container_up de khoanh vung khoi prompt');
});

test('hoi quy: isExcludedControl phan biet nut cua AI voi nut cua UI khac', () => {
  const document = loadFixtureDocument('ai-overview-submit-traps.html');
  const exclude = { selectors: aiSel.control_exclude };
  const inAi = document.getElementById('old-overview-copy');
  const googleSearch = document.getElementById('search-submit');
  const ahrefsCopy = document.getElementById('ahrefs-copy');

  assert.equal(aiInternals.isExcludedControl(inAi, exclude), false, 'nut trong AI Overview thi dung duoc');
  assert.equal(aiInternals.isExcludedControl(googleSearch, exclude), true, 'nut Search cua Google phai bi loai');
  assert.equal(aiInternals.isExcludedControl(ahrefsCopy, exclude), true, 'nut Copy cua Ahrefs phai bi loai');
  // Khong doc duoc phan tu thi phai coi la KHONG dung duoc, khong duoc bam bua.
  assert.equal(aiInternals.isExcludedControl(null, exclude), true);
});

test('hoi quy: khoanh vung khoi prompt khong voi toi form tim kiem cua Google', () => {
  const document = loadFixtureDocument('ai-overview-submit-traps.html');
  const box = document.getElementById('promptbox');
  let node = box;
  for (let i = 0; i < Number(aiSel.container_up); i += 1) node = node.parentNode ?? node;
  assert.equal(node.querySelector('#search-submit'), null, 'vung prompt khong duoc chua nut Search');
  assert.ok(node.querySelector('#send'), 'vung prompt phai chua nut gui that');
});

/* -------------------------------------------------- 1. Nut Delete trong goi y */

function readSuggestions(fixture) {
  return extractSuggestionDropdown({
    document: loadFixtureDocument(fixture),
    options: {
      listboxSelectors: cssSpecs(sugSel.listbox),
      optionSelectors: cssSpecs(sugSel.option_nodes),
      entityMarkers: sugSel.entity_label_markers,
      controlSelectors: cssSpecs(sugSel.control_nodes),
      controlWords: sugSel.control_words,
      stripEntityLabels: true,
    },
  });
}

test('hoi quy: goi y khong duoc dinh chu "Delete" cua nut xoa lich su', () => {
  // Ngay ca khi giu lai dong lich su ca nhan, text van phai sach hau to Delete/Remove
  const result = extractSuggestionDropdown({
    document: loadFixtureDocument('google-suggest-with-delete.html'),
    options: {
      listboxSelectors: cssSpecs(sugSel.listbox),
      optionSelectors: cssSpecs(sugSel.option_nodes),
      entityMarkers: sugSel.entity_label_markers,
      controlSelectors: cssSpecs(sugSel.control_nodes),
      controlWords: sugSel.control_words,
      stripEntityLabels: true,
      excludePersonalized: false,
    },
  });
  assert.deepEqual(result.items, [
    "what to wear on father's day girl",
    'first fathers day outfit for baby girl',
    'dad costume ideas',
    'fathers day outfit baby boy',
    'dad outfit starter pack',
  ]);
  for (const item of result.items) {
    assert.ok(!/delete$/i.test(item), `"${item}" van con hau to Delete`);
    assert.ok(!/remove$/i.test(item), `"${item}" van con hau to Remove`);
  }
});

test('hoi quy: van bo entity label khi dong khong co nut dieu khien', () => {
  const result = readSuggestions('google-suggest-with-delete.html');
  assert.ok(result.items.includes('dad outfit starter pack'));
  assert.ok(!result.items.some((i) => i.endsWith('Topic')));
});

test('hoi quy: config selectors.yaml phai khai bao control_nodes va control_words', () => {
  assert.ok(Array.isArray(sugSel.control_nodes) && sugSel.control_nodes.length > 0);
  assert.ok(Array.isArray(sugSel.control_words) && sugSel.control_words.includes('Delete'));
});

/* ------------------------------------------ 2. UI Share/Export cua AI Mode */

const REAL_AI_TAIL = [
  '6. H2: Frequently Asked Questions (FAQ Schema)',
  '',
  '- **Content:** 2-3 short QA pairs answering queries.',
  '',
  '---',
  '',
  "If you'd like, I can:",
  '',
  '### Share public link',
  '',
  'This public link is valid for 7 days and shares a thread, including any personal information you added.',
  '',
  'Facebook',
  '',
  'Gmail',
  '',
  'X',
  '',
  'Reddit',
  '',
  'WhatsApp',
].join('\n');

test('hoi quy: cat bo khoi Share public link o cuoi cau tra loi AI', () => {
  const cleaned = trimTrailingUi(REAL_AI_TAIL, aiSel.response_stop_markers);
  assert.ok(!cleaned.includes('Share public link'));
  assert.ok(!cleaned.includes('This public link is valid'));
  assert.ok(!cleaned.includes('WhatsApp'));
  assert.ok(!cleaned.includes('Facebook'));
});

test('hoi quy: bo not dong moi chao cut o cuoi ("If you would like, I can:")', () => {
  const cleaned = trimTrailingUi(REAL_AI_TAIL, aiSel.response_stop_markers);
  assert.ok(!/I can:\s*$/.test(cleaned));
  assert.ok(cleaned.endsWith('---') || cleaned.endsWith('.'));
});

test('hoi quy: giu nguyen phan noi dung that cua cau tra loi', () => {
  const cleaned = trimTrailingUi(REAL_AI_TAIL, aiSel.response_stop_markers);
  assert.ok(cleaned.includes('6. H2: Frequently Asked Questions (FAQ Schema)'));
  assert.ok(cleaned.includes('- **Content:** 2-3 short QA pairs answering queries.'));
});

test('hoi quy: khong co moc UI thi giu nguyen toan bo noi dung', () => {
  const normal = 'Doan mot.\n\n- Y mot\n- Y hai\n\nDoan hai.';
  assert.equal(trimTrailingUi(normal, aiSel.response_stop_markers), normal);
});

test('hoi quy: config selectors.yaml phai khai bao response_stop_markers', () => {
  assert.ok(Array.isArray(aiSel.response_stop_markers) && aiSel.response_stop_markers.length > 0);
});

/* --------------------------------- 3. Google tra ve nhieu hon num ket qua */

test('hoi quy: Page 2 danh so tiep sau Page 1 khi Google tra ve hon num ket qua', () => {
  // Truong hop that: Page 1 co 20 dong du num=10 -> Page 2 phai bat dau tu 21
  assert.equal(nextPagePositionOffset(20, 10), 20);
  // Truong hop binh thuong: Page 1 dung 10 dong -> Page 2 bat dau tu 11
  assert.equal(nextPagePositionOffset(10, 10), 10);
  // Page 1 it hon num (Google tra ve thieu) -> van dung num de khong lui vi tri
  assert.equal(nextPagePositionOffset(6, 10), 10);
  // Gia tri thieu/khong hop le -> ve mac dinh an toan
  assert.equal(nextPagePositionOffset(0, 10), 10);
  assert.equal(nextPagePositionOffset(undefined, undefined), 10);
});

test('hoi quy: hai trang khong con chong lan vi tri', () => {
  const page1Rows = 20;
  const offset = nextPagePositionOffset(page1Rows, 10);
  const page1Positions = Array.from({ length: page1Rows }, (_, i) => i + 1);
  const page2Positions = Array.from({ length: 10 }, (_, i) => offset + i + 1);
  const overlap = page2Positions.filter((p) => page1Positions.includes(p));
  assert.deepEqual(overlap, []);
  assert.equal(page2Positions[0], 21);
});

/* ------------- 4. Search Suggestion lay nham lich su tim kiem ca nhan ------- */

function readSuggestionsWith(fixture, extra = {}) {
  return extractSuggestionDropdown({
    document: loadFixtureDocument(fixture),
    options: {
      listboxSelectors: cssSpecs(sugSel.listbox),
      optionSelectors: cssSpecs(sugSel.option_nodes),
      entityMarkers: sugSel.entity_label_markers,
      controlSelectors: cssSpecs(sugSel.control_nodes),
      controlWords: sugSel.control_words,
      stripEntityLabels: true,
      ...extra,
    },
  });
}

test('hoi quy: loai goi y lay tu lich su tim kiem (dong co nut Delete)', () => {
  const result = readSuggestionsWith('google-suggest-with-delete.html');

  // 3 dong dau co nut Delete/Remove -> la lich su ca nhan, phai bi loai
  assert.deepEqual(result.personalized.map((p) => p.text), [
    "what to wear on father's day girl",
    'first fathers day outfit for baby girl',
    'dad costume ideas',
  ]);
  // Moi dong bi gan nhan phai kem LY DO de chan doan duoc khi bao nham
  assert.ok(result.personalized.every((p) => typeof p.reason === 'string' && p.reason.length > 0));
  assert.equal(result.personalizedCount, 3);

  // Chi giu lai goi y that su
  assert.deepEqual(result.items, ['fathers day outfit baby boy', 'dad outfit starter pack']);
});

test('hoi quy: co the tat bo loc de giu ca lich su ca nhan', () => {
  const result = readSuggestionsWith('google-suggest-with-delete.html', { excludePersonalized: false });
  assert.equal(result.items.length, 5);
  assert.ok(result.items.includes("what to wear on father's day girl"));
  // Van bao cho biet dong nao la ca nhan
  assert.equal(result.personalizedCount, 3);
});

test('hoi quy: dropdown khong co lich su thi personalizedCount = 0', () => {
  const result = readSuggestionsWith('google-suggest-dropdown.html');
  assert.equal(result.personalizedCount, 0);
  assert.deepEqual(result.items, [
    'filipino vs samoan',
    'filipino vs samoan culture',
    'filipino vs samoan food',
  ]);
});

test('hoi quy: extension popup KHONG duoc goi tu dong nua', async () => {
  // Run that 2026-08-22: mo popupUrl nhu tab thuong -> extension doc nham tab
  // dang active va tra ve prompt AI lam "goi y". Nhanh tu dong phai bi go bo.
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../src/adapters/suggestions.mjs', import.meta.url), 'utf8');

  const body = src.slice(src.indexOf('export async function collectSuggestions'),
    src.indexOf('export async function openSuggestionDropdown'));
  assert.ok(!body.includes('tryExtension('),
    'collectSuggestions khong duoc goi tryExtension tu dong');
  assert.ok(body.includes('readOpenDropdown(args)'),
    'DOM dropdown phai la nguon chinh');
});

test('hoi quy: openSuggestionDropdown van chay truoc khi doc DOM', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../src/adapters/suggestions.mjs', import.meta.url), 'utf8');
  const posOpen = src.indexOf('await openSuggestionDropdown(args)');
  const posRead = src.indexOf('return readOpenDropdown(args)');
  assert.ok(posOpen > 0 && posRead > 0);
  assert.ok(posOpen < posRead, 'phai mo dropdown truoc khi doc');
});

/* --- 5. Bo loc "goi y ca nhan" vut nham TOAN BO goi y dung (run 2026-08-22) --- */

function readRealShape(extra = {}) {
  return extractSuggestionDropdown({
    document: loadFixtureDocument('google-suggest-real-shape.html'),
    options: {
      listboxSelectors: cssSpecs(sugSel.listbox),
      optionSelectors: cssSpecs(sugSel.option_nodes),
      entityMarkers: sugSel.entity_label_markers,
      controlSelectors: cssSpecs(sugSel.control_nodes),
      deleteSelectors: cssSpecs(sugSel.delete_nodes),
      controlWords: sugSel.control_words,
      stripEntityLabels: true,
      ...extra,
    },
  });
}

test('hoi quy: icon aria-hidden o moi dong KHONG duoc coi la goi y ca nhan', () => {
  const result = readRealShape();

  // 5 goi y that phai duoc giu lai nguyen ven
  assert.deepEqual(result.items, [
    'samoan traditional clothing male',
    'samoan traditional clothing female',
    'samoan traditional clothing puletasi',
    'traditional puletasi',
    'puletasi dress designs',
  ]);
});

test('hoi quy: chi dong co nut aria-label="Delete" moi bi coi la lich su', () => {
  const result = readRealShape();
  assert.equal(result.personalizedCount, 1);
  assert.deepEqual(result.personalized.map((p) => p.text), ['samoan clothing i searched before']);
  assert.match(result.personalized[0].reason, /nut-xoa|text-ket-thuc-bang/);
});

test('hoi quy: nut role=button thuong khong lam dong bi loai', () => {
  const result = readRealShape();
  // Hai dong dau co <div role="button"> nhung khong phai nut xoa
  assert.ok(result.items.includes('samoan traditional clothing male'));
  assert.ok(result.items.includes('samoan traditional clothing female'));
});

test('hoi quy: delete_nodes trong config phai HEP, khong duoc chua button chung chung', () => {
  const css = cssSpecs(sugSel.delete_nodes).join(' ');
  assert.ok(!/^button$|\bbutton\b(?!.*aria-label)/.test(css.replace(/\[[^\]]*\]/g, '')),
    'delete_nodes khong duoc chua selector "button" tran');
  assert.ok(!css.includes("[role='button']") && !css.includes('[role="button"]'),
    'delete_nodes khong duoc chua [role=button]');
  assert.ok(css.toLowerCase().includes('delete'), 'delete_nodes phai nham vao nut Delete');
});

/* --- 6. Doi chieu endpoint trung lap de cuu goi y bi gan nham (run 2026-08-22) --- */

test('hoi quy: endpoint trung lap cuu lai goi y bi gan nham la lich su', async () => {
  const { rescueFlagged } = await import('../../src/adapters/suggestions.mjs');

  // Du lieu THAT tu run 2026-08-22
  const flagged = [
    'samoan traditional clothing male',
    'samoan traditional clothing female',
    'samoan traditional clothing puletasi',
    'samoan puletasi online',
    'puletasi dress designs',
  ];
  const endpoint = [
    'samoan traditional clothing men',
    'samoan traditional clothing female',
    'samoan traditional clothing puletasi',
    'samoan traditional dress',
  ];

  const rescued = rescueFlagged(flagged, endpoint, null);

  // Endpoint khong biet gi ve lich su tai khoan -> no tra ve nghia la goi y that
  assert.deepEqual(rescued, [
    'samoan traditional clothing female',
    'samoan traditional clothing puletasi',
  ]);
  // Dong endpoint KHONG tra ve thi van coi la lich su ca nhan
  assert.ok(!rescued.includes('samoan puletasi online'));
});

test('hoi quy: khong co endpoint thi khong cuu bua', async () => {
  const { rescueFlagged } = await import('../../src/adapters/suggestions.mjs');
  assert.deepEqual(rescueFlagged(['a', 'b'], [], null), []);
  assert.deepEqual(rescueFlagged([], ['a'], null), []);
});

test('hoi quy: nhan nguon phan anh dung phan dong gop that su', async () => {
  const { pickSource } = await import('../../src/adapters/suggestions.mjs');
  assert.equal(pickSource(3, 2, 12), 'google_suggest_dom+endpoint');
  assert.equal(pickSource(0, 0, 12), 'google_autocomplete_endpoint');
  assert.equal(pickSource(5, 0, 0), 'google_suggest_dom');
  assert.equal(pickSource(0, 2, 0), 'google_suggest_dom', 'dong duoc cuu van tinh la DOM');
  assert.equal(pickSource(0, 0, 0), 'none');
});
