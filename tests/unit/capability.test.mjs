/**
 * Capability detection cho extension (dac ta Fast Path v1 - P0).
 *
 * Boi canh loi that (run 20260827-171404): probe khong doc duoc
 * `chrome-extension://<id>/manifest.json` -> ghi `installed:false` +
 * NOT_IN_RUNNING_BROWSER cho ca ba extension. Ngay sau do widget Ahrefs van
 * hien tren SERP va tool doc duoc 8 Keywords Ideas + 4 PAA tu chinh widget do.
 * Ket luan "chua cai" la AM TINH GIA.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TRISTATE, OBSERVED_BY, normalizeCapability, markObserved, markUnknown,
  isUsable, isDefinitelyMissing, isUnknown, summariseCapability, toTristate,
} from '../../src/engine/capability.mjs';
import { statusOf } from '../../src/orchestrator.mjs';

test('ban ghi cu (installed: boolean) van doc duoc', () => {
  const legacy = normalizeCapability({ installed: true, id: 'x', version: '1.0', source: 'bundled' });
  assert.equal(legacy.installed, TRISTATE.TRUE);
  assert.equal(isUsable(legacy), true);
  assert.equal(legacy.observed_by, OBSERVED_BY.BUNDLED);

  const missing = normalizeCapability({ installed: false, id: 'y', reason: 'MANIFEST_NOT_FOUND' });
  assert.equal(missing.installed, TRISTATE.FALSE);
  assert.equal(isDefinitelyMissing(missing), true);
});

test('khong doc duoc trang extension -> unknown, KHONG phai "chua cai"', () => {
  const unknown = markUnknown({ id: 'z' }, 'EXTENSION_PAGE_UNREADABLE');
  assert.equal(unknown.installed, TRISTATE.UNKNOWN);
  assert.equal(isUnknown(unknown), true);
  assert.equal(isDefinitelyMissing(unknown), false, 'unknown khong duoc phat EXTENSION_MISSING');
  assert.equal(isUsable(unknown), false);
});

test('thay widget hoat dong -> usable, du probe truoc do khong ket luan duoc', () => {
  const before = markUnknown({ id: 'ahrefs' }, 'EXTENSION_PAGE_UNREADABLE');
  const after = markObserved(before, OBSERVED_BY.WIDGET, 'AHREFS_WIDGET_VISIBLE');

  assert.equal(isUsable(after), true);
  assert.equal(after.installed, TRISTATE.TRUE);
  assert.equal(after.observed_by, OBSERVED_BY.WIDGET);
  assert.equal(isDefinitelyMissing(after), false);
  assert.equal(isUnknown(before), true, 'ban ghi goc khong bi sua tai cho');
});

test('extension bi tat -> khong dung duoc du installed la true', () => {
  const disabled = normalizeCapability({
    installed: TRISTATE.TRUE, enabled: TRISTATE.FALSE, id: 'd',
  });
  assert.equal(isUsable(disabled), false);
});

test('toTristate chuan hoa moi kieu gia tri', () => {
  assert.equal(toTristate(true), 'true');
  assert.equal(toTristate(false), 'false');
  assert.equal(toTristate('true'), 'true');
  assert.equal(toTristate(undefined), 'unknown');
  assert.equal(toTristate(null), 'unknown');
  assert.equal(toTristate('rac'), 'unknown');
});

test('summariseCapability ghi du sau truong cho manifest', () => {
  const row = summariseCapability(markObserved({ id: 'a', version: '2.1' }, OBSERVED_BY.WIDGET, 'OK'));
  assert.deepEqual(Object.keys(row).sort(), [
    'configured', 'enabled', 'id', 'installed', 'observed_by', 'profile', 'reason', 'usable', 'version',
  ]);
  assert.equal(row.usable, true);
  assert.equal(row.installed, 'true');
});

test('status phan biet SUCCESS / PARTIAL / co canh bao nhe', () => {
  assert.equal(statusOf({ INFO: [], WARN: [], ERROR: [] }), 'SUCCESS');
  assert.equal(statusOf({ INFO: ['SELECTOR_DRIFT'], WARN: [], ERROR: [] }), 'SUCCESS');
  assert.equal(statusOf({ INFO: [], WARN: ['SERP_PARAM_MISMATCH'], ERROR: [] }), 'COMPLETED_WITH_WARNINGS');
  // Mat han mot section bat buoc (AI / Keywords Ideas / PAA) -> PARTIAL.
  assert.equal(statusOf({ INFO: [], WARN: [], ERROR: ['AI_SUBMIT_NO_PROGRESS'] }), 'PARTIAL');
  assert.equal(statusOf({ INFO: [], WARN: ['X'], ERROR: ['Y'] }), 'PARTIAL');
});
