/**
 * Integration test: Google autocomplete dropdown, popup extension suggestions, va PAA block.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtureDocument, cssSpecs } from '../helpers/dom.mjs';
import { loadSelectors } from '../../src/core/config.mjs';
import { extractSuggestionDropdown, extractExtensionSuggestions } from '../../src/extractors/suggestions-dom.mjs';
import { extractGooglePaa } from '../../src/extractors/paa-dom.mjs';
import { normalizeList } from '../../src/core/text.mjs';

const selectors = loadSelectors();
const sugSel = selectors.google_suggestions;
const extSel = selectors.extension_suggestions;
const paaSel = selectors.google_paa;

test('suggestions DOM: doc dropdown, bo entity label, dedupe, bo dong an', () => {
  const document = loadFixtureDocument('google-suggest-dropdown.html');
  const result = extractSuggestionDropdown({
    document,
    options: {
      listboxSelectors: cssSpecs(sugSel.listbox),
      optionSelectors: cssSpecs(sugSel.option_nodes),
      entityMarkers: sugSel.entity_label_markers,
      stripEntityLabels: true,
    },
  });
  assert.equal(result.found, true);
  assert.deepEqual(result.items, [
    'filipino vs samoan',
    'filipino vs samoan culture',
    'filipino vs samoan food',
  ]);
});

test('suggestions DOM: khong co dropdown thi found=false', () => {
  const document = loadFixtureDocument('serp-page2.html');
  const result = extractSuggestionDropdown({
    document,
    options: { listboxSelectors: cssSpecs(sugSel.listbox), optionSelectors: cssSpecs(sugSel.option_nodes) },
  });
  assert.equal(result.found, false);
  assert.deepEqual(result.items, []);
});

test('suggestions extension: doc popup va loai nut UI', () => {
  const document = loadFixtureDocument('extension-suggestions-popup.html');
  const result = extractExtensionSuggestions({
    document,
    options: { rowSelectors: cssSpecs(extSel.rows), noise: extSel.ui_noise },
  });
  assert.equal(result.found, true);
  assert.deepEqual(normalizeList(result.items, { noise: extSel.ui_noise }), [
    'filipino vs samoan',
    'filipino vs samoan language',
    'filipino vs samoan height',
  ]);
  assert.ok(!result.items.includes('Copy All'));
});

test('PAA DOM: doc cau hoi theo thu tu hien thi tu block Google', () => {
  const document = loadFixtureDocument('serp-mixed.html');
  const result = extractGooglePaa({
    document,
    options: {
      containerSelectors: cssSpecs(paaSel.container),
      questionSelectors: cssSpecs(paaSel.question_nodes),
      answerSelectors: cssSpecs(paaSel.answer_nodes),
      withAnswers: false,
    },
  });
  assert.equal(result.found, true);
  assert.deepEqual(result.items.map((i) => i.question), ['Are Filipinos and Samoans related?']);
  assert.equal(result.items[0].answer, '');
});

test('PAA DOM: khong co block PAA thi found=false, khong nem loi', () => {
  const document = loadFixtureDocument('serp-page2.html');
  const result = extractGooglePaa({
    document,
    options: {
      containerSelectors: cssSpecs(paaSel.container),
      questionSelectors: cssSpecs(paaSel.question_nodes),
    },
  });
  assert.equal(result.found, false);
  assert.deepEqual(result.items, []);
});
