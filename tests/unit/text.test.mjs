import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText, normalizeList, dedupeKey, toRegExp, matchesAny, normalizeMarkdownBlock,
  normalizeAiMarkdown,
} from '../../src/core/text.mjs';

test('normalizeText: trim, collapse va bo zero-width', () => {
  const zeroWidth = '\u200b';
  const nbsp = '\u00a0';
  assert.equal(normalizeText(`  a${zeroWidth}b${nbsp}${nbsp}c  `), 'ab c');
  assert.equal(normalizeText('  a   b\tc  '), 'a b c');
  assert.equal(normalizeText(null), '');
});

test('dedupeKey: khong phan biet hoa/thuong va khoang trang', () => {
  assert.equal(dedupeKey('Filipino  VS   Samoan'), dedupeKey('filipino vs samoan'));
});

test('normalizeList: bo rong, trim, deduplicate khac capitalization, giu thu tu', () => {
  const items = ['  Filipino vs Samoan ', '', 'filipino VS samoan', 'Samoan food', '   ', 'Samoan Food'];
  assert.deepEqual(normalizeList(items), ['Filipino vs Samoan', 'Samoan food']);
});

test('normalizeList: loai UI noise theo pattern (?i)', () => {
  const items = ['Copy', 'Sign in', 'Save URLs', 'Monitor this query', 'real keyword'];
  const noise = ['(?i)^copy$', '(?i)^sign ?in$', '(?i)^save urls?$', '(?i)^monitor this query$'];
  assert.deepEqual(normalizeList(items, { noise }), ['real keyword']);
});

test('normalizeList: nhan ca object {text}', () => {
  assert.deepEqual(normalizeList([{ text: ' a ' }, { text: 'A' }]), ['a']);
});

test('toRegExp: ho tro cu phap (?i) trong YAML', () => {
  const re = toRegExp('(?i)^show more$');
  assert.ok(re.test('Show More'));
  assert.ok(!re.test('show more please'));
});

test('toRegExp: pattern khong hop le tra ve null', () => {
  assert.equal(toRegExp('(('), null);
  assert.equal(toRegExp(''), null);
});

test('matchesAny: kiem tra nhieu pattern', () => {
  assert.ok(matchesAny('Sponsored', ['(?i)^sponsored$', '(?i)^ad$']));
  assert.ok(!matchesAny('Organic', ['(?i)^sponsored$']));
});

test('normalizeMarkdownBlock: gioi han toi da mot dong trong', () => {
  assert.equal(normalizeMarkdownBlock('a\n\n\n\nb   \n'), 'a\n\nb');
});

test('normalizeAiMarkdown: ha H1/H2 nhung khong sua fenced code', () => {
  const input = '# Title\n## Section\n```md\n## code sample\n```';
  assert.equal(normalizeAiMarkdown(input), '### Title\n### Section\n```md\n## code sample\n```');
});
