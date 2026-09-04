import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkdown, REQUIRED_HEADINGS, NOTES } from '../../src/output/markdown-builder.mjs';

function headingsOf(markdown) {
  return markdown.split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.trim());
}

test('markdown: dung 4 heading, dung thu tu', () => {
  const md = buildMarkdown({
    ai: { markdown: 'AI answer text.' },
    keywordIdeas: ['idea 1', 'idea 2'],
    paa: [{ question: 'Question one?', answer: '' }],
    suggestions: ['suggestion 1'],
  });
  assert.deepEqual(headingsOf(md), REQUIRED_HEADINGS);
});

test('markdown: khong dung placeholder N/A, dung blockquote canh bao', () => {
  const md = buildMarkdown({
    ai: { markdown: '' }, keywordIdeas: [], paa: [], suggestions: [],
  });
  assert.ok(!/N\/A/.test(md));
  assert.ok(md.includes(NOTES.ai));
  assert.ok(md.includes(NOTES.keywordIdeas));
  assert.ok(md.includes(NOTES.paa));
  assert.ok(md.includes(NOTES.suggestions));
});

test('markdown: list duoc trim va deduplicate khong phan biet hoa thuong', () => {
  const md = buildMarkdown({
    ai: { markdown: 'x' },
    keywordIdeas: ['  Alpha ', 'ALPHA', 'Beta', ''],
    paa: [{ question: 'Same question?' }, { question: 'same QUESTION?' }],
    suggestions: ['s1', 's1'],
  });
  assert.equal((md.match(/- Alpha/g) ?? []).length, 1);
  assert.ok(!md.includes('- ALPHA'));
  assert.equal((md.match(/- Same question\?/g) ?? []).length, 1);
  assert.equal((md.match(/- s1/g) ?? []).length, 1);
});

test('markdown: che do questions_and_answers dung dinh dang bold + answer', () => {
  const md = buildMarkdown({
    ai: { markdown: 'x' }, keywordIdeas: ['k'],
    paa: [{ question: 'Why?', answer: 'Because.' }],
    suggestions: ['s'],
    paaMode: 'questions_and_answers',
  });
  assert.ok(md.includes('- **Why?**\n  Because.'));
});

test('markdown: che do questions_only chi ghi cau hoi', () => {
  const md = buildMarkdown({
    ai: { markdown: 'x' }, keywordIdeas: ['k'],
    paa: [{ question: 'Why?', answer: 'Because.' }],
    suggestions: ['s'],
    paaMode: 'questions_only',
  });
  assert.ok(md.includes('- Why?'));
  assert.ok(!md.includes('Because.'));
});

test('markdown: ket thuc bang xuong dong va giu xuong dong cua AI', () => {
  const md = buildMarkdown({
    ai: { markdown: 'Para 1.\n\nPara 2.' },
    keywordIdeas: ['k'], paa: [{ question: 'q?' }], suggestions: ['s'],
  });
  assert.ok(md.endsWith('\n'));
  assert.ok(md.includes('Para 1.\n\nPara 2.'));
});

test('markdown: heading H1/H2 cua AI duoc ha xuong H3', () => {
  const md = buildMarkdown({
    ai: { markdown: '# AI title\n\n## Major Symbols\n\nBody' },
    keywordIdeas: ['k'], paa: [{ question: 'q?' }], suggestions: ['s'],
  });
  assert.deepEqual(headingsOf(md), REQUIRED_HEADINGS);
  assert.ok(md.includes('### AI title'));
  assert.ok(md.includes('### Major Symbols'));
});
