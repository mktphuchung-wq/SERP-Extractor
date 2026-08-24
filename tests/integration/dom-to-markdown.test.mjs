/**
 * Integration test: DOM -> Markdown cho khoi cau tra loi AI Mode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixtureDocument, parseHtml } from '../helpers/dom.mjs';
import { domToMarkdown } from '../../src/extractors/dom-to-markdown.mjs';
import { loadSelectors } from '../../src/core/config.mjs';

const excludeSelectors = loadSelectors().ai_prompt_box.exclude_in_response;

function convert(fixture, selector, options = {}) {
  const document = loadFixtureDocument(fixture);
  return domToMarkdown(document.querySelector(selector), { excludeSelectors, ...options });
}

test('dom->md: heading nho, paragraph, bold va italic', () => {
  const md = convert('ai-response.html', '[data-rp-response]');
  assert.ok(md.includes('### Key differences'));
  assert.ok(md.includes('**language**'));
  assert.ok(md.includes('*geography*'));
});

test('dom->md: bullet list ke ca list long nhau', () => {
  const md = convert('ai-response.html', '[data-rp-response]');
  assert.ok(md.includes('- Language families are related but distinct'));
  assert.ok(md.includes('  - Philippines has 7,000+ islands'));
});

test('dom->md: numbered list giu dung so thu tu', () => {
  const md = convert('ai-response.html', '[data-rp-response]');
  assert.ok(md.includes('1. First point'));
  assert.ok(md.includes('2. Second point'));
});

test('dom->md: link nguon thanh markdown link', () => {
  const md = convert('ai-response.html', '[data-rp-response]');
  assert.ok(md.includes('[this study](https://source.example.com/study)'));
});

test('dom->md: loai button, follow-up chip va node aria-hidden', () => {
  const md = convert('ai-response.html', '[data-rp-response]');
  assert.ok(!md.includes('Regenerate'));
  assert.ok(!md.includes('Follow-up'));
  assert.ok(!md.includes('Hidden helper text'));
});

test('dom->md: khong sinh chuoi undefined hay [object Object]', () => {
  const md = convert('ai-response.html', '[data-rp-response]');
  assert.ok(!md.includes('undefined'));
  assert.ok(!md.includes('[object Object]'));
});

test('dom->md: gioi han toi da mot dong trong giua cac block', () => {
  const md = convert('ai-response.html', '[data-rp-response]');
  assert.ok(!/\n{3,}/.test(md));
  assert.equal(md, md.trim());
});

test('dom->md: bo qua script/style va giu blockquote', () => {
  const document = parseHtml(`
    <div id="root">
      <style>.x { color: red }</style>
      <script>var a = 1;</script>
      <blockquote><p>Quoted text</p></blockquote>
      <p>After quote</p>
    </div>`);
  const md = domToMarkdown(document.querySelector('#root'), {});
  assert.ok(!md.includes('color: red'));
  assert.ok(!md.includes('var a = 1'));
  assert.ok(md.includes('> Quoted text'));
  assert.ok(md.includes('After quote'));
});

test('dom->md: root rong tra ve chuoi rong', () => {
  assert.equal(domToMarkdown(null, {}), '');
  const document = parseHtml('<div id="root"></div>');
  assert.equal(domToMarkdown(document.querySelector('#root'), {}), '');
});

test('dom->md: link khong co href thi chi giu text', () => {
  const document = parseHtml('<div id="root"><p>See <a>no link</a> here</p></div>');
  const md = domToMarkdown(document.querySelector('#root'), {});
  assert.equal(md, 'See no link here');
});
