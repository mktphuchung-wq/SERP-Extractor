import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateMarkdown, validateCsv, validateOutputFolder, validateRun, extractSection } from '../../src/output/validator.mjs';
import { buildMarkdown } from '../../src/output/markdown-builder.mjs';
import { makeTempDir } from '../helpers/dom.mjs';

const GOOD_MD = buildMarkdown({
  ai: { markdown: 'AI answer with real content.' },
  keywordIdeas: ['idea one', 'idea two'],
  paa: [{ question: 'Question one?' }],
  suggestions: ['suggestion one'],
});

const GOOD_CSV_1 = 'position,title,url\n1,First,https://a.example.com\n2,Second,https://b.example.com\n';
const GOOD_CSV_2 = 'position,title,url\n11,Eleventh,https://k.example.com\n12,Twelfth,https://l.example.com\n';

test('validateMarkdown: file dung chuan thi pass', () => {
  const result = validateMarkdown(GOOD_MD);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

test('validateMarkdown: thieu heading thi fail', () => {
  const result = validateMarkdown('## AI Mode\n\ntext\n');
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('4 heading')));
});

test('validateMarkdown: sai thu tu heading thi fail', () => {
  const bad = '## Keywords Ideas\n\n- a\n\n## AI Mode\n\nx\n\n## People Also Asked\n\n- q\n\n## Search Suggestion\n\n- s\n';
  const result = validateMarkdown(bad);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('Heading thu 1')));
});

test('validateMarkdown: bat placeholder noi bo', () => {
  const bad = GOOD_MD.replace('AI answer with real content.', '[object Object]');
  assert.equal(validateMarkdown(bad).ok, false);
  const bad2 = GOOD_MD.replace('AI answer with real content.', 'undefined');
  assert.equal(validateMarkdown(bad2).ok, false);
  const bad3 = GOOD_MD.replace('- idea one', '- N/A');
  assert.equal(validateMarkdown(bad3).ok, false);
});

test('validateMarkdown: AI content trung nguyen prompt thi fail', () => {
  const prompt = 'What are the differences?';
  const md = buildMarkdown({
    ai: { markdown: prompt }, keywordIdeas: ['a'], paa: [{ question: 'q?' }], suggestions: ['s'],
  });
  const result = validateMarkdown(md, { prompt });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('trung nguyen van prompt')));
});

test('extractSection: lay dung noi dung mot section', () => {
  assert.equal(extractSection(GOOD_MD, '## Keywords Ideas'), '- idea one\n- idea two');
});

test('validateCsv: header + du lieu hop le thi pass', () => {
  const result = validateCsv(GOOD_CSV_1, { label: 'Page 1 CSV' });
  assert.deepEqual(result.problems, []);
  assert.equal(result.rowCount, 2);
});

test('validateCsv: URL khong phai http/https thi fail', () => {
  const bad = 'position,title,url\n1,X,chrome-extension://abc/page.html\n';
  const result = validateCsv(bad, { label: 'Page 1 CSV' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('URL khong hop le') || p.includes('chrome-extension')));
});

test('validateCsv: position phai la so duong', () => {
  const bad = 'position,title,url\n0,X,https://a.com\n';
  const result = validateCsv(bad, { label: 'Page 1 CSV' });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes('position')));
});

test('validateCsv: khong co dong du lieu thi fail (tru khi allowEmpty)', () => {
  assert.equal(validateCsv('position,title,url\n', { label: 'X' }).ok, false);
  assert.equal(validateCsv('position,title,url\n', { label: 'X', allowEmpty: true }).ok, true);
});

test('validateOutputFolder: chi chap nhan dung 3 file dung ten', () => {
  const tmp = makeTempDir();
  try {
    const base = 'Filipino vs Samoan';
    const dir = path.join(tmp.dir, base);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${base}.md`), GOOD_MD);
    fs.writeFileSync(path.join(dir, `${base} page 1.csv`), GOOD_CSV_1);
    fs.writeFileSync(path.join(dir, `${base} page 2.csv`), GOOD_CSV_2);
    assert.equal(validateOutputFolder({ dir, base }).ok, true);

    fs.writeFileSync(path.join(dir, 'run.log'), 'khong duoc nam o day');
    const withExtra = validateOutputFolder({ dir, base });
    assert.equal(withExtra.ok, false);
    assert.ok(withExtra.problems.some((p) => p.includes('3 file')));
  } finally {
    tmp.cleanup();
  }
});

test('validateOutputFolder: bat file .tmp con sot', () => {
  const tmp = makeTempDir();
  try {
    const base = 'kw';
    const dir = path.join(tmp.dir, base);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${base}.md`), GOOD_MD);
    fs.writeFileSync(path.join(dir, `${base} page 1.csv`), GOOD_CSV_1);
    fs.writeFileSync(path.join(dir, `${base}.md.tmp`), 'x');
    const result = validateOutputFolder({ dir, base });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes('file tam')));
  } finally {
    tmp.cleanup();
  }
});

test('validateRun: pass day du va bat Page1 == Page2', () => {
  const tmp = makeTempDir();
  try {
    const base = 'kw';
    const dir = path.join(tmp.dir, base);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${base}.md`), GOOD_MD);
    fs.writeFileSync(path.join(dir, `${base} page 1.csv`), GOOD_CSV_1);
    fs.writeFileSync(path.join(dir, `${base} page 2.csv`), GOOD_CSV_2);

    const ok = validateRun({ dir, base });
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.counts.page1Rows, 2);

    fs.writeFileSync(path.join(dir, `${base} page 2.csv`), GOOD_CSV_1);
    const dup = validateRun({ dir, base });
    assert.equal(dup.ok, false);
    assert.ok(dup.problems.some((p) => p.includes('trung nhau hoan toan')));
  } finally {
    tmp.cleanup();
  }
});
