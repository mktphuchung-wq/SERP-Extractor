import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig, loadSelectors, expandEnv, deepMerge } from '../../src/core/config.mjs';
import { AppError } from '../../src/core/errors.mjs';
import { assertNotDefaultProfile } from '../../src/browser/chrome-launcher.mjs';

test('expandEnv: thay %VAR% bang bien moi truong', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' };
  assert.equal(
    expandEnv('%LOCALAPPDATA%\\AutoSerpTool\\chrome-profile', env),
    'C:\\Users\\test\\AppData\\Local\\AutoSerpTool\\chrome-profile',
  );
  assert.equal(expandEnv('%KHONG_TON_TAI%\\x', env), '%KHONG_TON_TAI%\\x');
});

test('deepMerge: override long nhau, mang thi thay the', () => {
  const merged = deepMerge(
    { a: { b: 1, c: 2 }, list: [1, 2] },
    { a: { c: 3 }, list: [9] },
  );
  assert.deepEqual(merged, { a: { b: 1, c: 3 }, list: [9] });
});

test('loadConfig: doc duoc default.yaml va resolve duong dan tuyet doi', () => {
  const config = loadConfig();
  assert.equal(config.search.country, 'us');
  assert.equal(config.search.language, 'en');
  assert.equal(config.search.personalization, false);
  assert.equal(config.search.pages, 2);
  assert.equal(config.extractors.allow_keyword_ideas_fallback, false);
  assert.equal(config.extractors.paa_capture_mode, 'questions_only');
  assert.equal(config.output.on_conflict, 'timestamp');
  assert.ok(path.isAbsolute(config.output.root));
  assert.ok(path.isAbsolute(config.browser.user_data_dir));
  assert.ok(config.browser.user_data_dir.includes('AutoSerpTool'));
});

test('loadConfig: override tu CLI duoc ap dung', () => {
  const config = loadConfig({ overrides: { search: { country: 'vn' }, notifications: { sound: false } } });
  assert.equal(config.search.country, 'vn');
  assert.equal(config.notifications.sound, false);
  assert.equal(config.search.language, 'en');
});

test('loadConfig: cau hinh sai thi nem AppError co ma INVALID_CONFIG', () => {
  assert.throws(
    () => loadConfig({ overrides: { output: { on_conflict: 'khong-hop-le' } } }),
    (err) => err instanceof AppError && err.code === 'INVALID_CONFIG',
  );
  assert.throws(() => loadConfig({ overrides: { browser: { remote_debugging_port: 80 } } }), AppError);
});

test('loadSelectors: co du cac block va selector_version', () => {
  const selectors = loadSelectors();
  for (const block of [
    'google_consent', 'google_block_state', 'google_results', 'ai_overview', 'ai_prompt_box',
    'ahrefs_widget', 'google_paa', 'google_suggestions', 'extension_suggestions',
    'extension_serp_export', 'native_serp',
  ]) {
    assert.ok(selectors[block], `thieu block ${block}`);
    assert.ok(selectors[block].selector_version, `block ${block} thieu selector_version`);
  }
});

test('bao ve: khong cho tro toi profile Chrome mac dinh', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' };
  assert.throws(
    () => assertNotDefaultProfile('C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\User Data', env),
    /profile Chrome mac dinh/,
  );
  assert.doesNotThrow(
    () => assertNotDefaultProfile('C:\\Users\\test\\AppData\\Local\\AutoSerpTool\\chrome-profile', env),
  );
});
