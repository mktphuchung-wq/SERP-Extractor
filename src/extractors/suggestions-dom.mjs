/**
 * Trich xuat Google Search Suggestions tu dropdown (DOM fallback)
 * va tu trang popup cua extension "Google Search Suggestion Extractor".
 * Ham self-contained de dung chung page.evaluate() va linkedom test.
 */

/**
 * Doc suggestion tu dropdown cua o tim kiem Google.
 * @param {{options?:object, document?:Document}} arg
 * @returns {{found:boolean, items:string[]}}
 */
export function extractSuggestionDropdown(arg) {
  const a0 = arg || {};
  const options = a0.options || {};
  const doc = a0.document ? a0.document : document;

  const listboxSelectors = options.listboxSelectors || ['ul[role="listbox"]', '[role="listbox"]'];
  const optionSelectors = options.optionSelectors || ['li[role="presentation"]', '[role="option"]', 'li'];
  const entityMarkers = options.entityMarkers || [];
  const stripEntityLabels = options.stripEntityLabels !== false;
  const maxItems = options.maxItems || 20;
  // Nut dieu khien nam TRONG moi dong goi y (vi du "Delete" cua lich su tim kiem).
  const controlSelectors = (options.controlSelectors && options.controlSelectors.length)
    ? options.controlSelectors
    : ['button', '[role="button"]', '[aria-label*="Delete" i]', '[aria-label*="Remove" i]'];
  const controlWords = (options.controlWords && options.controlWords.length)
    ? options.controlWords
    : ['Delete', 'Remove', 'Report'];
  // Selector HEP chi danh cho nut xoa cua goi y lich su
  const deleteSelectors = (options.deleteSelectors && options.deleteSelectors.length)
    ? options.deleteSelectors
    : ['[aria-label*="Delete" i]', '[aria-label*="Remove" i]'];
  // Mac dinh LOAI goi y lay tu lich su tim kiem ca nhan (dong co nut Delete)
  const excludePersonalized = options.excludePersonalized !== false;

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

  const entityRes = entityMarkers.map(toRe).filter(Boolean);

  function matchesAnySelector(el, list) {
    if (!el || el.nodeType !== 1) return false;
    for (let i = 0; i < list.length; i += 1) {
      try {
        if (el.matches && el.matches(list[i])) return true;
      } catch (e) { /* selector khong ho tro trong runtime nay */ }
    }
    return false;
  }

  /**
   * Node can BO khi ghep text cua dong goi y: icon trang tri, nut bam...
   * Bao gom ca aria-hidden vi do la node trang tri.
   */
  function isControlNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return true;
    return matchesAnySelector(el, controlSelectors);
  }

  /**
   * Node la NUT XOA that su - dau hieu dong nay den tu lich su tim kiem.
   *
   * PHAI hep hon isControlNode: dropdown Google co icon aria-hidden va nut bam
   * o MOI dong, nen neu dung isControlNode de phan loai thi moi dong deu bi coi
   * la lich su ca nhan va du lieu dung bi vut het (loi that, run 2026-08-22).
   */
  function deleteControlReason(el) {
    if (!el || el.nodeType !== 1) return null;
    for (let i = 0; i < deleteSelectors.length; i += 1) {
      try {
        if (el.matches && el.matches(deleteSelectors[i])) return 'selector:' + deleteSelectors[i];
      } catch (e) { /* selector khong ho tro */ }
    }
    const label = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
    const own = collapse(el.textContent);
    for (let i = 0; i < controlWords.length; i += 1) {
      const word = String(controlWords[i]).toLowerCase();
      if (label.toLowerCase().indexOf(word) !== -1) return 'aria-label:' + label.slice(0, 40);
      if (own.toLowerCase() === word) return 'text:' + own.slice(0, 40);
    }
    return null;
  }

  /** Text cua mot dong goi y, BO cac nut dieu khien ben trong. */
  function suggestionText(node) {
    let out = '';
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i += 1) {
      const n = kids[i];
      if (n.nodeType === 3) { out += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      if (isControlNode(n)) continue;
      out += suggestionText(n);
    }
    return out;
  }

  /** Go phan duoi cua chuoi neu no la nhan dieu khien bi dinh vao. */
  function stripTrailingWords(text, words) {
    let result = text;
    for (let pass = 0; pass < 3; pass += 1) {
      let changed = false;
      for (let i = 0; i < words.length; i += 1) {
        const word = String(words[i]);
        const tail = result.slice(-word.length);
        if (result.length > word.length && tail.toLowerCase() === word.toLowerCase()) {
          result = result.slice(0, result.length - word.length).replace(/\s+$/, '');
          changed = true;
        }
      }
      if (!changed) break;
    }
    return result;
  }

  let listbox = null;
  for (let i = 0; i < listboxSelectors.length && !listbox; i += 1) listbox = qs(doc, listboxSelectors[i]);
  if (!listbox) return { found: false, items: [], personalized: [], personalizedCount: 0, totalRows: 0 };

  let nodes = [];
  for (let i = 0; i < optionSelectors.length && nodes.length === 0; i += 1) {
    nodes = qsa(listbox, optionSelectors[i]);
  }

  /**
   * Dong goi y co nut xoa (Delete/Remove) la goi y lay tu LICH SU TIM KIEM
   * cua tai khoan, khong phai Google Search Suggestion that su.
   * Dua chung vao ket qua se lam sai du lieu nghien cuu (va nguoc voi pws=0).
   */
  function personalizedReason(node) {
    const kids = node.querySelectorAll ? qsa(node, '*') : [];
    for (let i = 0; i < kids.length; i += 1) {
      const reason = deleteControlReason(kids[i]);
      if (reason) return 'nut-xoa/' + reason;
    }
    const raw = collapse(node.textContent);
    for (let i = 0; i < controlWords.length; i += 1) {
      const word = String(controlWords[i]);
      if (raw.length > word.length && raw.slice(-word.length).toLowerCase() === word.toLowerCase()) {
        return 'text-ket-thuc-bang/' + word;
      }
    }
    return null;
  }

  const items = [];
  const personalized = [];
  const seen = {};
  for (let i = 0; i < nodes.length && items.length < maxItems; i += 1) {
    const node = nodes[i];
    if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') continue;

    let text = collapse(suggestionText(node));
    text = stripTrailingWords(text, controlWords);
    if (!text) continue;

    const reason = personalizedReason(node);
    if (reason) {
      let already = false;
      for (let k = 0; k < personalized.length; k += 1) {
        if (personalized[k].text === text) already = true;
      }
      if (!already) personalized.push({ text, reason });
      if (excludePersonalized) continue;
    }

    if (stripEntityLabels && node.children && node.children.length > 1) {
      const last = node.children[node.children.length - 1];
      const lastText = isControlNode(last) ? '' : collapse(last.textContent);
      if (lastText && lastText !== text) {
        let isEntity = false;
        for (let j = 0; j < entityRes.length; j += 1) {
          if (entityRes[j].test(lastText)) { isEntity = true; break; }
        }
        if (isEntity && text.length > lastText.length) {
          text = collapse(text.slice(0, text.length - lastText.length));
        }
      }
    }

    if (!text) continue;
    const key = text.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    items.push(text);
  }

  return {
    found: true,
    items,
    personalized,
    personalizedCount: personalized.length,
    totalRows: nodes.length,
  };
}

/**
 * Doc suggestion tu trang popup cua extension.
 * @param {{options?:object, document?:Document}} arg
 * @returns {{found:boolean, items:string[]}}
 */
export function extractExtensionSuggestions(arg) {
  const a0 = arg || {};
  const options = a0.options || {};
  const doc = a0.document ? a0.document : document;

  const rowSelectors = options.rowSelectors || ['ul li', '[role="listitem"]', 'table tr td:first-child'];
  const noise = options.noise || [];
  const maxItems = options.maxItems || 50;

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

  const noiseRes = noise.map(toRe).filter(Boolean);
  const root = doc.body || doc.documentElement || doc;

  let nodes = [];
  for (let i = 0; i < rowSelectors.length && nodes.length === 0; i += 1) {
    nodes = qsa(root, rowSelectors[i]);
  }
  if (nodes.length === 0) return { found: false, items: [] };

  const items = [];
  const seen = {};
  for (let i = 0; i < nodes.length && items.length < maxItems; i += 1) {
    const text = collapse(nodes[i].textContent);
    if (!text) continue;
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

  return { found: items.length > 0, items };
}
