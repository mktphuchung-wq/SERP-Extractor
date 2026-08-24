import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  sanitizeFileBase, slugify, buildRunId, timestampStamp, resolveOutputDir,
} from '../../src/core/sanitize.mjs';
import { AppError } from '../../src/core/errors.mjs';

test('sanitize: giu nguyen keyword hop le', () => {
  assert.equal(sanitizeFileBase('Filipino vs Samoan'), 'Filipino vs Samoan');
});

test('sanitize: thay ky tu cam cua Windows bang khoang trang', () => {
  assert.equal(sanitizeFileBase('seo/tips: how? <best> "x" |y| *z*'), 'seo tips how best x y z');
});

test('sanitize: giu dau tieng Viet', () => {
  assert.equal(sanitizeFileBase('so sánh người Philippines và Samoa'), 'so sánh người Philippines và Samoa');
});

test('sanitize: cat do dai va bo dau cham/khoang trang cuoi', () => {
  const long = `${'a'.repeat(200)}...`;
  const result = sanitizeFileBase(long, { maxLength: 120 });
  assert.equal(result.length, 120);
  assert.ok(!/[.\s]$/.test(result));
});

test('sanitize: xu ly ten reserved cua Windows', () => {
  assert.equal(sanitizeFileBase('CON'), 'CON_');
  assert.equal(sanitizeFileBase('com1'), 'com1_');
  assert.equal(sanitizeFileBase('LPT9'), 'LPT9_');
  assert.equal(sanitizeFileBase('console'), 'console');
});

test('sanitize: chuoi rong tra ve untitled', () => {
  assert.equal(sanitizeFileBase('   '), 'untitled');
  assert.equal(sanitizeFileBase('///'), 'untitled');
});

test('sanitize: collapse nhieu khoang trang', () => {
  assert.equal(sanitizeFileBase('a    b\t\tc'), 'a b c');
});

test('slugify: bo dau tieng Viet cho ten thu muc log', () => {
  assert.equal(slugify('Tiếng Việt có dấu'), 'tieng-viet-co-dau');
  assert.equal(slugify('Filipino vs Samoan'), 'filipino-vs-samoan');
});

test('buildRunId: dinh dang <timestamp>-<slug>', () => {
  const runId = buildRunId('Filipino vs Samoan', new Date(2026, 7, 21, 11, 15, 30));
  assert.equal(runId, '20260821-111530-filipino-vs-samoan');
});

test('timestampStamp: dinh dang yyyymmdd-hhmmss', () => {
  assert.equal(timestampStamp(new Date(2026, 7, 21, 11, 15, 30)), '20260821-111530');
});

test('conflict policy: mac dinh them suffix timestamp, khong ghi de', () => {
  const result = resolveOutputDir({
    root: 'C:\\out', base: 'Filipino vs Samoan', policy: 'timestamp',
    stamp: '20260821-111530', exists: () => true,
  });
  assert.equal(result.action, 'suffix');
  assert.equal(result.base, 'Filipino vs Samoan__20260821-111530');
  assert.equal(result.dir, path.join('C:\\out', 'Filipino vs Samoan__20260821-111530'));
});

test('conflict policy: khong ton tai thi tao truc tiep', () => {
  const result = resolveOutputDir({
    root: 'C:\\out', base: 'abc', policy: 'timestamp', stamp: 'x', exists: () => false,
  });
  assert.equal(result.action, 'create');
  assert.equal(result.conflict, false);
});

test('conflict policy: fail thi nem loi', () => {
  assert.throws(() => resolveOutputDir({
    root: 'C:\\out', base: 'abc', policy: 'fail', stamp: 'x', exists: () => true,
  }), AppError);
});

test('conflict policy: overwrite phai co co --overwrite', () => {
  assert.throws(() => resolveOutputDir({
    root: 'C:\\out', base: 'abc', policy: 'overwrite', stamp: 'x', exists: () => true,
  }), /overwrite/);

  const allowed = resolveOutputDir({
    root: 'C:\\out', base: 'abc', policy: 'overwrite', stamp: 'x',
    exists: () => true, allowOverwrite: true,
  });
  assert.equal(allowed.action, 'overwrite');
});
