/**
 * Integration test bang HTML fixture:
 * SERP lan lon ads, PAA, video carousel, featured snippet, node extension.
 * Dung dung selectors.yaml that de test luon selector registry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtureDocument } from '../helpers/dom.mjs';
import { loadSelectors } from '../../src/core/config.mjs';
import { extractOrganicResults } from '../../src/extractors/native-serp.mjs';
import { rowsToCsv, parseCsv } from '../../src/extractors/csv-normalizer.mjs';
import { validateCsv } from '../../src/output/validator.mjs';

const selectors = loadSelectors();
const nativeSel = selectors.native_serp;

function extract(fixture, overrides = {}) {
  const document = loadFixtureDocument(fixture);
  return extractOrganicResults({
    document,
    options: {
      resultContainers: nativeSel.result_containers,
      excludeContainers: nativeSel.exclude_containers,
      excludeTextAnchors: nativeSel.exclude_text_anchors,
      excludeUrlPatterns: nativeSel.exclude_url_patterns,
      featuredSnippetContainers: nativeSel.featured_snippet_containers,
      capturedAt: '2026-08-21T04:15:30.000Z',
      baseUrl: 'https://www.google.com/search?q=test',
      sourcePage: 1,
      startOffset: 0,
      ...overrides,
    },
  });
}

test('native SERP: chi giu ket qua organic + featured snippet', () => {
  const rows = extract('serp-mixed.html');
  assert.deepEqual(rows.map((r) => r.title), [
    'Featured Result Title',
    'First Organic Result',
    'Second Organic Result',
  ]);
});

test('native SERP: loai ads (#tads, data-text-ad va nhan Sponsored trong block)', () => {
  const rows = extract('serp-mixed.html');
  assert.ok(!rows.some((r) => /Sponsored/i.test(r.title)));
  assert.ok(!rows.some((r) => r.url.includes('ad-one')));
  assert.ok(!rows.some((r) => r.url.includes('ad-two')));
});

test('native SERP: loai PAA, video carousel va Ahrefs toolbar', () => {
  const rows = extract('serp-mixed.html');
  assert.ok(!rows.some((r) => r.url.includes('paa.example.com')));
  assert.ok(!rows.some((r) => r.url.includes('video.example.com')));
  assert.ok(!rows.some((r) => r.url.includes('carousel.example.com')));
  assert.ok(!rows.some((r) => r.url.includes('ahrefs.com')));
});

test('native SERP: loai node chrome-extension:// va link noi bo Google', () => {
  const rows = extract('serp-mixed.html');
  assert.ok(!rows.some((r) => r.url.startsWith('chrome-extension://')));
  assert.ok(!rows.some((r) => /google\.com\/search/.test(r.url)));
});

test('native SERP: bo qua ket qua bi an (display:none)', () => {
  const rows = extract('serp-mixed.html');
  assert.ok(!rows.some((r) => r.url.includes('hidden.example.com')));
});

test('native SERP: giai ma /url?q= cua Google va deduplicate theo URL', () => {
  const rows = extract('serp-mixed.html');
  const first = rows.find((r) => r.title === 'First Organic Result');
  assert.equal(first.url, 'https://www.first.com/page');
  assert.equal(rows.filter((r) => r.url.includes('first.com')).length, 1);
});

test('native SERP: danh dau featured snippet nhung van giu URL organic', () => {
  const rows = extract('serp-mixed.html');
  assert.equal(rows[0].result_type, 'featured_snippet');
  assert.equal(rows[0].url, 'https://featured.example.com/answer');
  assert.equal(rows[1].result_type, 'organic');
});

test('native SERP: position lien tuc va co offset cho Page 2', () => {
  const page1 = extract('serp-mixed.html');
  assert.deepEqual(page1.map((r) => r.position), [1, 2, 3]);

  const page2 = extract('serp-page2.html', { startOffset: 10, sourcePage: 2 });
  assert.deepEqual(page2.map((r) => r.position), [11, 12]);
  assert.deepEqual(page2.map((r) => r.source_page), [2, 2]);
});

test('native SERP: lay description, displayed_url va captured_at', () => {
  const rows = extract('serp-mixed.html');
  const first = rows.find((r) => r.title === 'First Organic Result');
  assert.ok(first.description.startsWith('Description one, with a comma'));
  assert.equal(first.displayed_url, 'www.first.com');
  assert.equal(first.captured_at, '2026-08-21T04:15:30.000Z');
});

test('native SERP: CSV xuat ra qua duoc quality gate', () => {
  const csv = rowsToCsv(extract('serp-mixed.html'));
  const parsed = parseCsv(csv);
  assert.equal(parsed.rowCount, 3);
  const validation = validateCsv(csv, { label: 'Page 1 CSV' });
  assert.deepEqual(validation.problems, []);
  assert.ok(!csv.includes('chrome-extension://'));
});

test('native SERP: trang khong co ket qua thi tra ve mang rong, khong nem loi', () => {
  const rows = extractOrganicResults({
    document: loadFixtureDocument('ai-response.html'),
    options: { resultContainers: ['#rso'], excludeContainers: [] },
  });
  assert.deepEqual(rows, []);
});

/* ---------------------------------------------------------------------------
 * Layout Google co them mot DIV bao giua #rso va tung khoi ket qua.
 * Xem tests/fixtures/serp-wrapped-rso.html de biet vi sao no tung lam mat sach
 * ket qua page 1 cua truy van "best running shoes".
 * ------------------------------------------------------------------------- */

test('#rso co DIV bao o giua: van lay du ket qua organic', () => {
  const rows = extract('serp-wrapped-rso.html');
  assert.equal(rows.length, 3, 'phai lay du 3 ket qua, khong duoc mat vi khoi PAA nam chung boc');
  assert.deepEqual(rows.map((r) => r.title), [
    'The 15 Best Running Shoes of 2026',
    "What are the best running shoes that you'd actually buy",
    '100+ Running Shoe Reviews',
  ]);
});

test('#rso co DIV bao o giua: khong lay nham PAA lam ket qua', () => {
  const rows = extract('serp-wrapped-rso.html');
  for (const row of rows) {
    assert.doesNotMatch(row.title, /Which running shoe brand|How much should I spend/);
  }
});

test('#rso co DIV bao o giua: moi ket qua giu dung cite va description cua no', () => {
  const rows = extract('serp-wrapped-rso.html');

  assert.match(rows[0].displayed_url, /runnersworld\.com/);
  assert.match(rows[0].description, /^Aug 3, 2026/);

  assert.match(rows[1].displayed_url, /210\+ comments/);
  assert.match(rows[1].description, /finally replacing my running shoes/);

  assert.match(rows[2].displayed_url, /runrepeat\.com/);
  assert.match(rows[2].description, /Nike Vomero 18/);

  // Khoi bi phinh se khien moi dong deu om ca 3 mo ta -> description dai bat thuong.
  for (const row of rows) {
    assert.ok(row.description.length < 250, `description qua dai (${row.description.length}) - khoi bi phinh`);
  }
});

test('khoi ket qua khong duoc chua nhieu hon mot tieu de', () => {
  // Bat truc tiep bat bien ma findBlock() phai giu, tren ca hai fixture.
  for (const fixture of ['serp-mixed.html', 'serp-wrapped-rso.html']) {
    const rows = extract(fixture);
    const titles = rows.map((r) => r.title);
    for (const row of rows) {
      const others = titles.filter((t) => t !== row.title);
      for (const other of others) {
        assert.ok(
          !row.description.includes(other),
          `${fixture}: description cua "${row.title}" chua tieu de cua ket qua khac ("${other}")`,
        );
      }
    }
  }
});
