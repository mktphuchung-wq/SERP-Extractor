import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKeywordList, parsePromptList, pairKeywordsAndPrompts } from '../../src/core/input.mjs';

const fallback = (kw) => `TEMPLATE:${kw}`;

test('parseKeywordList: tach nhieu tu khoa bang dau ;', () => {
  assert.deepEqual(
    parseKeywordList('Filipino vs Samoan; Father\'s Day Outfit Ideas; best running shoes'),
    ['Filipino vs Samoan', "Father's Day Outfit Ideas", 'best running shoes'],
  );
});

test('parseKeywordList: mot tu khoa van tra ve mang mot phan tu', () => {
  assert.deepEqual(parseKeywordList('Filipino vs Samoan'), ['Filipino vs Samoan']);
});

test('parseKeywordList: bo phan tu rong, trim va collapse khoang trang', () => {
  assert.deepEqual(
    parseKeywordList('  kw   mot ;; ;  kw hai  ;'),
    ['kw mot', 'kw hai'],
  );
});

test('parseKeywordList: deduplicate khong phan biet hoa/thuong', () => {
  assert.deepEqual(
    parseKeywordList('Filipino vs Samoan; filipino VS samoan; Samoan food'),
    ['Filipino vs Samoan', 'Samoan food'],
  );
});

test('parseKeywordList: input rong tra ve mang rong', () => {
  assert.deepEqual(parseKeywordList(''), []);
  assert.deepEqual(parseKeywordList('   ;  ; '), []);
  assert.deepEqual(parseKeywordList(null), []);
});

test('parsePromptList: tach prompt theo dau ;', () => {
  assert.deepEqual(parsePromptList('prompt mot; prompt hai'), ['prompt mot', 'prompt hai']);
  assert.deepEqual(parsePromptList(''), []);
});

test('pair: khong co prompt -> dung template cho tat ca', () => {
  const jobs = pairKeywordsAndPrompts(['a', 'b'], [], fallback);
  assert.deepEqual(jobs, [
    { keyword: 'a', prompt: 'TEMPLATE:a', promptSource: 'template' },
    { keyword: 'b', prompt: 'TEMPLATE:b', promptSource: 'template' },
  ]);
});

test('pair: mot prompt -> dung chung cho moi tu khoa', () => {
  const jobs = pairKeywordsAndPrompts(['a', 'b', 'c'], ['chung'], fallback);
  assert.deepEqual(jobs.map((j) => j.prompt), ['chung', 'chung', 'chung']);
  assert.equal(jobs[0].promptSource, 'shared');
});

test('pair: nhieu prompt -> ghep theo thu tu', () => {
  const jobs = pairKeywordsAndPrompts(['a', 'b'], ['p1', 'p2'], fallback);
  assert.deepEqual(jobs.map((j) => j.prompt), ['p1', 'p2']);
  assert.equal(jobs[1].promptSource, 'explicit');
});

test('pair: thieu prompt cho tu khoa cuoi -> dung template, khong loi', () => {
  const jobs = pairKeywordsAndPrompts(['a', 'b', 'c'], ['p1', 'p2'], fallback);
  assert.deepEqual(jobs.map((j) => j.prompt), ['p1', 'p2', 'TEMPLATE:c']);
  assert.equal(jobs[2].promptSource, 'template');
});
