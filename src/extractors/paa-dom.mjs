/**
 * Trich xuat "People also ask" tu DOM Google (fallback khi Ahrefs khong co PAA).
 * Ham self-contained de dung chung page.evaluate() va linkedom test.
 */

/**
 * @param {{options?:object, document?:Document}} arg
 * @returns {{found:boolean, items:Array<{question:string, answer:string}>}}
 */
export function extractGooglePaa(arg) {
  const a0 = arg || {};
  const options = a0.options || {};
  const doc = a0.document ? a0.document : document;

  const containerSelectors = options.containerSelectors || ['div[data-initq]', '[jsname="yEVEwb"]'];
  const questionSelectors = options.questionSelectors || ['div[data-q]', '[role="heading"][aria-level="3"]'];
  const answerSelectors = options.answerSelectors || ['[data-attrid="wa:/description"]', '[jsname="vpsFbe"]'];
  const withAnswers = options.withAnswers === true;
  const maxItems = options.maxItems || 30;
  const headingText = options.headingText || '(?i)^people also ask$';

  function collapse(text) {
    return String(text == null ? '' : text)
      .replace(new RegExp('[\\u200b-\\u200d\\ufeff]', 'g'), '')
      .replace(new RegExp('[\\u00a0\\u2007\\u202f]', 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function toRe(pattern) {
    const m = /^\(\?([a-z]+)\)([\s\S]*)$/.exec(String(pattern || ''));
    try {
      if (m) return new RegExp(m[2], m[1].replace(/[^imsu]/g, ''));
      return new RegExp(String(pattern || ''));
    } catch (e) { return null; }
  }
  function qsa(root, selector) {
    if (!root || !root.querySelectorAll) return [];
    try { return Array.prototype.slice.call(root.querySelectorAll(selector)); } catch (e) { return []; }
  }
  function qs(root, selector) {
    if (!root || !root.querySelector) return null;
    try { return root.querySelector(selector); } catch (e) { return null; }
  }

  // 1) Tim container PAA
  let container = null;
  for (let i = 0; i < containerSelectors.length && !container; i += 1) {
    container = qs(doc, containerSelectors[i]);
  }
  if (!container) {
    const headRe = toRe(headingText);
    const candidates = qsa(doc, 'h2, h3, [role="heading"], div, span');
    for (let i = 0; i < candidates.length && !container; i += 1) {
      const el = candidates[i];
      if (el.children && el.children.length > 0) continue;
      if (headRe && headRe.test(collapse(el.textContent))) {
        let node = el;
        for (let up = 0; up < 5 && node.parentElement; up += 1) node = node.parentElement;
        container = node;
      }
    }
  }
  if (!container) return { found: false, items: [] };

  // 2) Doc cac cau hoi theo thu tu hien thi
  const nodes = [];
  for (let i = 0; i < questionSelectors.length && nodes.length === 0; i += 1) {
    const found = qsa(container, questionSelectors[i]);
    for (let j = 0; j < found.length; j += 1) nodes.push(found[j]);
  }

  const items = [];
  const seen = {};
  for (let i = 0; i < nodes.length && items.length < maxItems; i += 1) {
    const node = nodes[i];
    const attr = node.getAttribute ? node.getAttribute('data-q') : null;
    const question = collapse(attr || node.textContent);
    if (!question) continue;
    const key = question.toLowerCase().replace(/\s+/g, ' ');
    if (seen[key]) continue;
    seen[key] = true;

    let answer = '';
    if (withAnswers) {
      for (let j = 0; j < answerSelectors.length && !answer; j += 1) {
        const el = qs(node, answerSelectors[j]) ||
          (node.parentElement ? qs(node.parentElement, answerSelectors[j]) : null);
        if (el) answer = collapse(el.textContent);
      }
    }
    items.push({ question, answer });
  }

  return { found: true, items };
}
