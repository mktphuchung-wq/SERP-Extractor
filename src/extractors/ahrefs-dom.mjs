/**
 * Doc widget Ahrefs SEO Toolbar duoc chen vao SERP:
 *  - tab "Keywords ideas"
 *  - tab "People also ask"
 *  - trang thai country (United States hay khong)
 * Ham self-contained de dung chung page.evaluate() va linkedom test.
 */

/**
 * @param {{options?:object, document?:Document}} arg
 * @returns {{found:boolean, items:string[], rowCount:number}}
 */
export function extractAhrefsList(arg) {
  const a0 = arg || {};
  const options = a0.options || {};
  const doc = a0.document ? a0.document : document;

  const containerSelectors = options.containerSelectors || ['[id*="ahrefs" i]', '[class*="ahrefs" i]'];
  const panelSelector = options.panelSelector || '';
  const rowSelectors = options.rowSelectors || ['[role="row"]', 'li', 'tr'];
  const noise = options.noise || [];
  const maxItems = options.maxItems || 50;
  const minLength = options.minLength || 2;

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

  const noiseRes = noise.map(toRe).filter(Boolean);

  let container = null;
  for (let i = 0; i < containerSelectors.length && !container; i += 1) {
    container = qs(doc, containerSelectors[i]);
  }
  if (!container) return { found: false, items: [], rowCount: 0 };

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true')) return true;
    const style = el.getAttribute ? el.getAttribute('style') : null;
    if (style && /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) return true;
    return false;
  }

  // Chi doc panel dang hien thi (tab dang active), tranh tron du lieu giua cac tab
  let panel = container;
  if (panelSelector) {
    const panels = qsa(container, panelSelector);
    for (let i = 0; i < panels.length; i += 1) {
      if (!isHidden(panels[i])) { panel = panels[i]; break; }
    }
  }

  let rows = [];
  for (let i = 0; i < rowSelectors.length && rows.length === 0; i += 1) {
    rows = qsa(panel, rowSelectors[i]);
  }

  const items = [];
  const seen = {};
  for (let i = 0; i < rows.length && items.length < maxItems; i += 1) {
    const row = rows[i];
    if (row.getAttribute && row.getAttribute('aria-hidden') === 'true') continue;
    // Uu tien o dau tien cua row (cot keyword), neu khong co thi lay ca row
    const firstCell = qs(row, '[role="cell"]') || qs(row, 'td') || qs(row, 'a') || null;
    const text = collapse(firstCell ? firstCell.textContent : row.textContent);
    if (!text || text.length < minLength) continue;

    let noisy = false;
    for (let j = 0; j < noiseRes.length; j += 1) {
      if (noiseRes[j].test(text)) { noisy = true; break; }
    }
    if (noisy) continue;

    const key = text.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    items.push(text);
  }

  return { found: true, items, rowCount: rows.length };
}

/**
 * Doc trang thai country dang hien thi trong toolbar.
 * @param {{options?:object, document?:Document}} arg
 * @returns {{found:boolean, text:string, isUS:boolean}}
 */
export function readAhrefsCountry(arg) {
  const a0 = arg || {};
  const options = a0.options || {};
  const doc = a0.document ? a0.document : document;

  const containerSelectors = options.containerSelectors || ['[id*="ahrefs" i]', '[class*="ahrefs" i]'];
  const controlSelectors = options.controlSelectors || ['[data-country]', 'select[name*="country" i]'];
  const usMarkers = options.usMarkers || ['(?i)united states'];

  function collapse(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }
  function toRe(pattern) {
    const m = /^\(\?([a-z]+)\)([\s\S]*)$/.exec(String(pattern || ''));
    try {
      if (m) return new RegExp(m[2], m[1].replace(/[^imsu]/g, ''));
      return new RegExp(String(pattern || ''));
    } catch (e) { return null; }
  }
  function qs(root, selector) {
    if (!root || !root.querySelector) return null;
    try { return root.querySelector(selector); } catch (e) { return null; }
  }

  let container = null;
  for (let i = 0; i < containerSelectors.length && !container; i += 1) {
    container = qs(doc, containerSelectors[i]);
  }
  if (!container) return { found: false, text: '', isUS: false };

  let text = '';
  for (let i = 0; i < controlSelectors.length && !text; i += 1) {
    const el = qs(container, controlSelectors[i]);
    if (!el) continue;
    text = collapse(el.getAttribute && el.getAttribute('data-country')
      ? el.getAttribute('data-country')
      : el.textContent);
  }
  if (!text) return { found: false, text: '', isUS: false };

  const res = usMarkers.map(toRe).filter(Boolean);
  let isUS = false;
  for (let i = 0; i < res.length; i += 1) {
    if (res[i].test(text)) { isUS = true; break; }
  }
  return { found: true, text, isUS };
}

/**
 * Parse text lay tu clipboard (nut Copy cua Ahrefs) thanh danh sach item.
 * Chay o phia Node, khong can DOM.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseCopiedList(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n/)
    .map((line) => line.split('\t')[0])
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
