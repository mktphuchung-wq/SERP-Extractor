import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv, detectColumns, rowsToCsv, normalizeCsvText, urlFingerprint, areCsvIdentical, stripBom,
  renumberPositions,
  CANONICAL_CSV_HEADER,
} from '../../src/extractors/csv-normalizer.mjs';

const CSV_WITH_COMMA_AND_NEWLINE = [
  'position,title,url,description',
  '1,"First result","https://a.example.com","Mot mo ta, co dau phay va',
  'co ca xuong dong"',
  '2,"Second result","https://b.example.com","Mo ta ""co dau nhay"" ben trong"',
  '',
].join('\n');

test('CSV parser: doc dung description co dau phay va xuong dong', () => {
  const { header, records, rowCount } = parseCsv(CSV_WITH_COMMA_AND_NEWLINE);
  assert.deepEqual(header, ['position', 'title', 'url', 'description']);
  assert.equal(rowCount, 2);
  assert.ok(records[0].description.includes(','));
  assert.ok(records[0].description.includes('\n'));
  assert.equal(records[1].description, 'Mo ta "co dau nhay" ben trong');
});

test('CSV parser: bo BOM dau file', () => {
  const bom = String.fromCharCode(0xfeff);
  const { header, rowCount } = parseCsv(`${bom}a,b\n1,2\n`);
  assert.deepEqual(header, ['a', 'b']);
  assert.equal(rowCount, 1);
  assert.equal(stripBom(`${bom}x`), 'x');
});

test('CSV parser: file rong tra ve 0 dong, khong nem loi', () => {
  assert.equal(parseCsv('').rowCount, 0);
  assert.equal(parseCsv('   ').rowCount, 0);
});

test('detectColumns: nhan dien nhieu bien the ten cot', () => {
  assert.deepEqual(detectColumns(['Position', 'Title', 'URL', 'Description']), {
    position: 'Position', title: 'Title', url: 'URL', description: 'Description',
  });
  const alt = detectColumns(['Rank', 'Name', 'Link', 'Snippet']);
  assert.equal(alt.position, 'Rank');
  assert.equal(alt.url, 'Link');
});

test('rowsToCsv: ghi dung schema canonical va escape dau phay', () => {
  const csv = rowsToCsv([{
    position: 1, title: 'A, B', url: 'https://a.com', displayed_url: 'a.com',
    description: 'Line1\nLine2', result_type: 'organic', source_page: 1,
    captured_at: '2026-08-21T00:00:00.000Z',
  }]);
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.header, CANONICAL_CSV_HEADER);
  assert.equal(parsed.records[0].title, 'A, B');
  assert.equal(parsed.records[0].description, 'Line1\nLine2');
});

test('normalizeCsvText: doi schema extension sang canonical', () => {
  const source = 'Rank,Name,Link\n1,Result One,https://one.com\n2,Result Two,https://two.com\n';
  const normalized = normalizeCsvText(source, { sourcePage: 2, capturedAt: '2026-08-21T00:00:00.000Z' });
  const parsed = parseCsv(normalized);
  assert.deepEqual(parsed.header, CANONICAL_CSV_HEADER);
  assert.equal(parsed.records[0].url, 'https://one.com');
  assert.equal(parsed.records[0].source_page, '2');
});

test('urlFingerprint: chuan hoa URL de so sanh', () => {
  const csv = 'position,url\n1,https://A.com/x/\n2,https://b.com/y#frag\n';
  assert.deepEqual(urlFingerprint(csv), ['https://a.com/x', 'https://b.com/y']);
});

test('areCsvIdentical: phat hien Page 2 trung Page 1', () => {
  const page1 = 'position,url\n1,https://a.com\n2,https://b.com\n';
  const page2Same = 'position,url\n11,https://a.com/\n12,https://b.com\n';
  const page2Diff = 'position,url\n11,https://c.com\n12,https://d.com\n';
  assert.equal(areCsvIdentical(page1, page2Same), true);
  assert.equal(areCsvIdentical(page1, page2Diff), false);
});

test('areCsvIdentical: file rong khong bi coi la trung', () => {
  assert.equal(areCsvIdentical('position,url\n', 'position,url\n'), false);
});

test('renumberPositions: danh so lai cot position tu offset', () => {
  const csv = 'position,title,url\n1,A,https://a.com\n2,B,https://b.com\n3,C,https://c.com\n';
  const out = renumberPositions(csv, 20);
  const parsed = parseCsv(out);
  assert.deepEqual(parsed.records.map((r) => r.position), ['21', '22', '23']);
  assert.deepEqual(parsed.records.map((r) => r.title), ['A', 'B', 'C']);
});

test('renumberPositions: giu nguyen CSV khong co cot position (schema cua extension)', () => {
  const csv = 'Rank,Title,URL\n1,A,https://a.com\n';
  assert.equal(renumberPositions(csv, 10), csv);
});

test('renumberPositions: file rong thi tra ve nguyen ban', () => {
  assert.equal(renumberPositions('position,title,url\n', 10), 'position,title,url\n');
});
