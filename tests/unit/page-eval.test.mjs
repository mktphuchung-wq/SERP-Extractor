import test from 'node:test';
import assert from 'node:assert/strict';
import { composeExtractor } from '../../src/browser/page-eval.mjs';
import { extractOrganicResults } from '../../src/extractors/native-serp.mjs';
import { extractGooglePaa } from '../../src/extractors/paa-dom.mjs';
import { extractSuggestionDropdown, extractExtensionSuggestions } from '../../src/extractors/suggestions-dom.mjs';
import { extractAhrefsList, readAhrefsCountry } from '../../src/extractors/ahrefs-dom.mjs';
import { domToMarkdown } from '../../src/extractors/dom-to-markdown.mjs';
import { loadFixtureDocument } from '../helpers/dom.mjs';

const EXTRACTORS = {
  extractOrganicResults,
  extractGooglePaa,
  extractSuggestionDropdown,
  extractExtensionSuggestions,
  extractAhrefsList,
  readAhrefsCountry,
  domToMarkdown,
};

test('extractor phai self-contained: khong import/require ben trong', () => {
  for (const [name, fn] of Object.entries(EXTRACTORS)) {
    const source = fn.toString();
    assert.ok(!/\brequire\s*\(/.test(source), `${name} khong duoc dung require()`);
    assert.ok(!/^\s*import\s/m.test(source), `${name} khong duoc dung import`);
  }
});

test('composeExtractor: ghep source thanh ham chay duoc (giong page.evaluate)', () => {
  const composed = composeExtractor(extractOrganicResults);
  const document = loadFixtureDocument('serp-mixed.html');
  const rows = composed({ document, options: { resultContainers: ['#rso'] } });
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length > 0);
});

test('composeExtractor: ho tro bieu thuc goi tuy chon (root, options)', () => {
  const composed = composeExtractor(domToMarkdown, '__f(arg.root, arg.options)');
  const document = loadFixtureDocument('ai-response.html');
  const markdown = composed({ root: document.querySelector('[data-rp-response]'), options: {} });
  assert.ok(markdown.includes('Key differences'));
});

test('composeExtractor: ham ghep khong keo theo bien ngoai scope', () => {
  const source = composeExtractor(extractGooglePaa).toString();
  assert.ok(source.includes('const __f ='));
  assert.ok(!source.includes('import '));
});
