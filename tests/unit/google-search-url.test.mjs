import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchUrl, readParam, verifySerpUrl } from '../../src/adapters/google-search.mjs';

test('buildSearchUrl: Page 1 dung chuan US/English, pws=0, start=0', () => {
  const url = buildSearchUrl({
    domain: 'www.google.com', keyword: 'Filipino vs Samoan',
    language: 'en', country: 'us', personalization: false, num: 10, start: 0,
  });
  assert.equal(
    url,
    'https://www.google.com/search?q=Filipino%20vs%20Samoan&hl=en&gl=us&pws=0&num=10&start=0',
  );
});

test('buildSearchUrl: Page 2 dung start=10 chu khong dua vao nut pagination', () => {
  const url = buildSearchUrl({ keyword: 'x', start: 10 });
  assert.ok(url.includes('start=10'));
  assert.equal(readParam(url, 'start'), '10');
});

test('buildSearchUrl: encode ky tu dac biet trong keyword', () => {
  const url = buildSearchUrl({ keyword: 'c++ & c# "so sánh"' });
  assert.ok(!url.includes(' '));
  assert.equal(readParam(url, 'q'), 'c++ & c# "so sánh"');
});

test('buildSearchUrl: personalization=true thi pws=1', () => {
  assert.ok(buildSearchUrl({ keyword: 'x', personalization: true }).includes('pws=1'));
});

test('buildSearchUrl: co the them udm cho AI Mode', () => {
  assert.ok(buildSearchUrl({ keyword: 'x', udm: 50 }).includes('udm=50'));
});

test('verifySerpUrl: bat khac biet query param', () => {
  const url = buildSearchUrl({ keyword: 'x', start: 0 });
  assert.equal(verifySerpUrl(url, { hl: 'en', gl: 'us', pws: 0 }).ok, true);

  const bad = verifySerpUrl(url, { start: 10 });
  assert.equal(bad.ok, false);
  assert.ok(bad.mismatches[0].includes('start=0'));
});

test('readParam: URL khong hop le tra ve null', () => {
  assert.equal(readParam('khong-phai-url', 'q'), null);
});
