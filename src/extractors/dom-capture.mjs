/**
 * Chup DOM that cua mot block de soan selector tu bang chung (dac ta v2.0 §4).
 *
 * Ham self-contained, chay duoc ca trong page.evaluate() lan trong linkedom test.
 * Nhiem vu:
 *   1. Dinh vi block bang danh sach CSS selector, co XUYEN shadow root.
 *   2. Neu khong thay, do bang probe_text de tim shadow host.
 *   3. Serialize ca cay ke ca noi dung shadow root.
 *   4. Sinh danh sach selector ung vien, cham diem theo do on dinh.
 *
 * Ly do ton tai: v1.0 §18.1 tu khai selector Ahrefs "chua co du lieu that lan nao"
 * - tuc la duoc doan. Khong co duong lay DOM that ra thi moi lan UI doi lai quay
 * ve doan mo.
 */

/**
 * @param {{options?:object, document?:Document}} arg
 * @returns {{found:boolean, scopeKind:string, shadowHostPath:string|null,
 *            matchedSelector:string|null, matchedIndex:number, html:string,
 *            htmlTruncated:boolean, candidates:Array, probeMatches:Array, stats:object}}
 */
export function captureBlockDom(arg) {
  const a0 = arg || {};
  const options = a0.options || {};
  const doc = a0.document ? a0.document : document;

  const cssSelectors = options.cssSelectors || [];
  const probeText = options.probeText || '';
  const maxHtmlBytes = options.maxHtmlBytes || 4000000;
  const includeShadow = options.includeShadow !== false;
  const probeUp = options.probeUp || 6;
  const maxCandidates = options.maxCandidates || 12;

  /* ---------------------------------------------------------- tien ich */

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

  /** querySelectorAll co XUYEN open shadow root. */
  function deepQueryAll(root, css) {
    const out = [];
    const visited = [];
    function walk(node) {
      if (!node) return;
      for (let i = 0; i < visited.length; i += 1) if (visited[i] === node) return;
      visited.push(node);
      try {
        const found = node.querySelectorAll(css);
        for (let i = 0; i < found.length; i += 1) out.push(found[i]);
      } catch (e) { /* selector khong hop le trong runtime nay */ }
      let kids = [];
      try { kids = node.querySelectorAll('*'); } catch (e) { kids = []; }
      for (let i = 0; i < kids.length; i += 1) {
        if (kids[i] && kids[i].shadowRoot) walk(kids[i].shadowRoot);
      }
    }
    walk(root);
    return out;
  }

  /** Element nay co nam trong shadow root khong. */
  function isInShadow(el) {
    let node = el;
    let guard = 0;
    while (node && guard < 200) {
      const root = node.getRootNode ? node.getRootNode() : null;
      if (root && root.host) return true;
      if (!root || root === doc) return false;
      node = root.host || null;
      guard += 1;
    }
    return false;
  }

  /** Duong CSS ngan gon tu document toi element (di qua ca shadow host). */
  function cssPath(el, limit) {
    const parts = [];
    let node = el;
    let depth = 0;
    const max = limit || 8;
    while (node && node.nodeType === 1 && depth < max) {
      let part = String(node.tagName || '').toLowerCase();
      if (node.id && !looksRandom(node.id)) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        let index = 1;
        let sib = node.previousElementSibling;
        while (sib) { if (sib.tagName === node.tagName) index += 1; sib = sib.previousElementSibling; }
        if (index > 1) part += `:nth-of-type(${index})`;
      }
      parts.unshift(part);
      if (!parent) {
        const root = node.getRootNode ? node.getRootNode() : null;
        node = root && root.host ? root.host : null;
      } else {
        node = parent;
      }
      depth += 1;
    }
    return parts.join(' > ');
  }

  /** Chuoi kieu hash sinh tu dong: 'a1b2c3d4', 'x9Kj2' ... */
  function looksRandom(value) {
    const v = String(value || '');
    if (!v) return true;
    if (/^[a-z]{1,3}[0-9A-Za-z]{5,}$/.test(v) && /[0-9]/.test(v)) return true;
    if (/^[0-9a-f]{8,}$/i.test(v)) return true;
    if (/^ng-|^css-[0-9a-z]{5,}/.test(v)) return true;
    return false;
  }

  function escapeAttr(value) {
    return String(value || '').replace(/["\\]/g, '\\$&');
  }

  /* ------------------------------------------------- sinh selector ung vien */

  function candidatesFor(el) {
    const list = [];
    if (!el || el.nodeType !== 1) return list;
    const tag = String(el.tagName || '').toLowerCase();

    // Hang 1: data-* co ngu nghia
    const attrs = el.attributes || [];
    for (let i = 0; i < attrs.length; i += 1) {
      const name = attrs[i].name;
      const value = attrs[i].value;
      if (name.indexOf('data-') !== 0) continue;
      if (!value || value.length > 40 || looksRandom(value)) {
        list.push({ rank: 1, css: `[${name}]`, why: `thuoc tinh ${name}` });
      } else {
        list.push({ rank: 1, css: `[${name}="${escapeAttr(value)}"]`, why: `${name}=${value}` });
      }
    }

    // Hang 2: role + aria-label
    const role = el.getAttribute ? el.getAttribute('role') : null;
    const label = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (role && label) {
      list.push({ rank: 2, css: `[role="${escapeAttr(role)}"][aria-label*="${escapeAttr(label.slice(0, 24))}"]`, why: 'role + aria-label' });
    } else if (role) {
      list.push({ rank: 2, css: `${tag}[role="${escapeAttr(role)}"]`, why: 'role' });
    }

    // Hang 3: id on dinh
    if (el.id && !looksRandom(el.id)) {
      list.push({ rank: 3, css: `#${el.id}`, why: 'id on dinh' });
    }

    // Hang 4: ten custom element
    if (tag.indexOf('-') !== -1) {
      list.push({ rank: 4, css: tag, why: 'custom element' });
    }

    // Hang 5: class khong phai hash
    const className = typeof el.className === 'string' ? el.className : '';
    const classes = className.split(/\s+/).filter(Boolean);
    for (let i = 0; i < classes.length && i < 4; i += 1) {
      if (!looksRandom(classes[i])) {
        list.push({ rank: 5, css: `${tag}.${classes[i]}`, why: 'class on dinh' });
      }
    }

    // Hang 6: duong CSS ngan nhat
    const path = cssPath(el, 6);
    if (path) list.push({ rank: 6, css: path, why: 'duong CSS' });

    return list;
  }

  /** Cham diem + dem so node khop de biet selector co duy nhat khong. */
  function scoreCandidates(list, el) {
    const out = [];
    const seen = {};
    for (let i = 0; i < list.length; i += 1) {
      const cand = list[i];
      if (seen[cand.css]) continue;
      seen[cand.css] = true;
      const matches = deepQueryAll(doc, cand.css);
      let hitsTarget = false;
      for (let j = 0; j < matches.length; j += 1) if (matches[j] === el) hitsTarget = true;
      out.push({
        rank: cand.rank,
        css: cand.css,
        why: cand.why,
        matchCount: matches.length,
        unique: matches.length === 1,
        hitsTarget,
        inShadow: isInShadow(el),
      });
    }
    // Uu tien: dung target > duy nhat > rank thap > it node khop
    out.sort((a, b) => {
      if (a.hitsTarget !== b.hitsTarget) return a.hitsTarget ? -1 : 1;
      if (a.unique !== b.unique) return a.unique ? -1 : 1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.matchCount - b.matchCount;
    });
    return out.slice(0, maxCandidates);
  }

  /* ------------------------------------------------------ serialize sau */

  function serializeDeep(el, budget) {
    if (!el) return '';
    if (!includeShadow) {
      const plain = el.outerHTML || '';
      return plain.length > budget ? plain.slice(0, budget) : plain;
    }

    function serializeNode(node) {
      if (!node) return '';
      if (node.nodeType === 3) return String(node.nodeValue || '');
      if (node.nodeType === 8) return `<!--${node.nodeValue || ''}-->`;
      if (node.nodeType !== 1) return '';

      const tag = String(node.tagName || '').toLowerCase();
      let attrs = '';
      const list = node.attributes || [];
      for (let i = 0; i < list.length; i += 1) {
        attrs += ` ${list[i].name}="${String(list[i].value || '').replace(/"/g, '&quot;')}"`;
      }

      let inner = '';
      if (node.shadowRoot) {
        inner += '<!--shadow-root open-->';
        const shadowKids = node.shadowRoot.childNodes || [];
        for (let i = 0; i < shadowKids.length; i += 1) inner += serializeNode(shadowKids[i]);
        inner += '<!--/shadow-root-->';
      }
      const kids = node.childNodes || [];
      for (let i = 0; i < kids.length; i += 1) inner += serializeNode(kids[i]);

      return `<${tag}${attrs}>${inner}</${tag}>`;
    }

    const html = serializeNode(el);
    return html.length > budget ? html.slice(0, budget) : html;
  }

  /* ------------------------------------------------------------ dinh vi */

  let target = null;
  let matchedSelector = null;
  let matchedIndex = -1;

  for (let i = 0; i < cssSelectors.length && !target; i += 1) {
    const found = deepQueryAll(doc, cssSelectors[i]);
    if (found.length) {
      target = found[0];
      matchedSelector = cssSelectors[i];
      matchedIndex = i;
    }
  }

  // Khong co selector nao trung -> do bang text
  const probeRe = toRe(probeText);
  const probeMatches = [];
  if (probeRe) {
    const all = deepQueryAll(doc, '*');
    for (let i = 0; i < all.length && probeMatches.length < 8; i += 1) {
      const el = all[i];
      if (el.children && el.children.length > 0) continue;
      const text = collapse(el.textContent);
      if (!text || text.length > 80) continue;
      if (!probeRe.test(text)) continue;
      probeMatches.push({
        text,
        inShadow: isInShadow(el),
        path: cssPath(el, 8),
        candidates: scoreCandidates(candidatesFor(el), el),
      });
    }
  }

  if (!target && probeMatches.length) {
    // Leo len tu node text de lay khoi bao quanh
    const all = deepQueryAll(doc, '*');
    for (let i = 0; i < all.length && !target; i += 1) {
      const el = all[i];
      if (el.children && el.children.length > 0) continue;
      const text = collapse(el.textContent);
      if (!text || !probeRe.test(text)) continue;
      let node = el;
      for (let up = 0; up < probeUp && node.parentElement; up += 1) node = node.parentElement;
      target = node;
    }
  }

  if (!target) {
    return {
      found: false,
      scopeKind: 'none',
      shadowHostPath: null,
      matchedSelector: null,
      matchedIndex: -1,
      html: '',
      htmlTruncated: false,
      candidates: [],
      probeMatches,
      stats: { selectorsTried: cssSelectors.length },
    };
  }

  const inShadow = isInShadow(target);
  let shadowHostPath = null;
  if (inShadow) {
    const root = target.getRootNode ? target.getRootNode() : null;
    if (root && root.host) shadowHostPath = cssPath(root.host, 8);
  }

  const html = serializeDeep(target, maxHtmlBytes);

  return {
    found: true,
    scopeKind: inShadow ? 'shadow' : 'page',
    shadowHostPath,
    matchedSelector,
    matchedIndex,
    html,
    htmlTruncated: html.length >= maxHtmlBytes,
    candidates: scoreCandidates(candidatesFor(target), target),
    probeMatches,
    stats: {
      selectorsTried: cssSelectors.length,
      childCount: target.children ? target.children.length : 0,
      textLength: collapse(target.textContent).length,
    },
  };
}
