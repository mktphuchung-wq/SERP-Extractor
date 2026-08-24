import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEVERITY, WARNING_CODES, WARNING_SEVERITY, severityOf, affectsStatus, groupBySeverity,
} from '../../src/core/errors.mjs';
import { renderConsoleSummary } from '../../src/output/notifier.mjs';

test('severity: fallback van chay duoc thi chi la INFO', () => {
  assert.equal(severityOf('SELECTOR_DRIFT'), SEVERITY.INFO);
  assert.equal(severityOf('SERP_MORE_RESULTS_THAN_EXPECTED'), SEVERITY.INFO);
  assert.equal(severityOf('SUGGESTIONS_PERSONALIZED'), SEVERITY.INFO);
});

test('severity: mat han mot section la ERROR', () => {
  for (const code of [
    'AHREFS_KEYWORD_IDEAS_UNAVAILABLE', 'SUGGESTIONS_NOT_FOUND',
    'SUGGESTIONS_PERSONALIZED_ONLY', 'PAA_NOT_FOUND', 'SERP_EMPTY_PAGE',
  ]) {
    assert.equal(severityOf(code), SEVERITY.ERROR, `${code} phai la ERROR`);
  }
});

test('severity: INFO khong lam ban status, WARN/ERROR thi co', () => {
  assert.equal(affectsStatus('SELECTOR_DRIFT'), false);
  assert.equal(affectsStatus('AI_RESPONSE_TIMEOUT'), true);
  assert.equal(affectsStatus('SUGGESTIONS_NOT_FOUND'), true);
});

test('severity: strict_selectors nang SELECTOR_DRIFT len WARN', () => {
  assert.equal(severityOf('SELECTOR_DRIFT', { strictSelectors: true }), SEVERITY.WARN);
  assert.equal(affectsStatus('SELECTOR_DRIFT', { strictSelectors: true }), true);
  // Cac ma khac khong bi anh huong
  assert.equal(severityOf('SUGGESTIONS_PERSONALIZED', { strictSelectors: true }), SEVERITY.INFO);
});

test('severity: ma la mac dinh ve WARN, khong am tham bo qua', () => {
  assert.equal(severityOf('MOT_MA_CHUA_KHAI_BAO'), SEVERITY.WARN);
  assert.equal(affectsStatus('MOT_MA_CHUA_KHAI_BAO'), true);
});

test('groupBySeverity: gom dung nhom va bo gia tri rong', () => {
  const g = groupBySeverity([
    'SELECTOR_DRIFT', 'AI_RESPONSE_TIMEOUT', 'SUGGESTIONS_NOT_FOUND', null, '',
  ]);
  assert.deepEqual(g.INFO, ['SELECTOR_DRIFT']);
  assert.deepEqual(g.WARN, ['AI_RESPONSE_TIMEOUT']);
  assert.deepEqual(g.ERROR, ['SUGGESTIONS_NOT_FOUND']);
});

test('moi ma trong WARNING_CODES phai co muc do khai bao ro', () => {
  const missing = Object.keys(WARNING_CODES).filter((code) => !WARNING_SEVERITY[code]);
  assert.deepEqual(missing, [], `thieu muc do cho: ${missing.join(', ')}`);
});

test('dong tong ket tach ro ERROR / WARN / INFO', () => {
  const text = renderConsoleSummary({
    status: 'COMPLETED_WITH_WARNINGS',
    keyword: 'kw', outputDir: 'D:\\out', durationMs: 47200,
    counts: { ai_chars: 100, keyword_ideas: 8, paa: 4, suggestions: 12 },
    warnings: ['SELECTOR_DRIFT', 'SUGGESTIONS_NOT_FOUND'],
    severity: groupBySeverity(['SELECTOR_DRIFT', 'SUGGESTIONS_NOT_FOUND']),
  });
  assert.match(text, /1 ERROR \| 0 WARN \| 1 INFO/);
  assert.match(text, /\[ERROR\] SUGGESTIONS_NOT_FOUND/);
  assert.match(text, /\[INFO \] SELECTOR_DRIFT/);
});

test('khong co canh bao nao thi dong tong ket khong nhac toi canh bao', () => {
  const text = renderConsoleSummary({
    status: 'SUCCESS', keyword: 'kw', outputDir: 'D:\\out', durationMs: 1000,
    counts: {}, warnings: [], severity: groupBySeverity([]),
  });
  assert.ok(!text.includes('Canh bao'));
  assert.match(text, /SUCCESS/);
});
