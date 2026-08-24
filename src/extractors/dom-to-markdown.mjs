/**
 * Chuyen mot subtree DOM sang Markdown co kiem soat:
 * paragraph, bullet, numbered list, heading nho, link, blockquote, code.
 *
 * QUAN TRONG: ham `domToMarkdown` phai self-contained (khong dung bien ngoai scope)
 * vi no duoc bom vao trang bang page.evaluate(). Cung ham do duoc goi truc tiep
 * tren linkedom trong test => luat chuyen doi duoc test offline.
 */

/**
 * @param {Element} root
 * @param {{excludeSelectors?:string[], headingBase?:number, keepLinks?:boolean, maxChars?:number}} [options]
 * @returns {string} markdown
 */
export function domToMarkdown(root, options) {
  const opts = options || {};
  const excludeSelectors = opts.excludeSelectors || [];
  const headingBase = opts.headingBase || 3;
  const keepLinks = opts.keepLinks !== false;
  const maxChars = opts.maxChars || 200000;

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DD', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
    'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME',
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'AUDIO', 'VIDEO', 'PICTURE', 'SOURCE',
  ]);

  function collapse(text) {
    return String(text == null ? '' : text)
      .replace(new RegExp('[\\u200b-\\u200d\\ufeff]', 'g'), '')
      .replace(new RegExp('[\\u00a0\\u2007\\u202f]', 'g'), ' ')
      .replace(/\s+/g, ' ');
  }

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true')) return true;
    const style = el.getAttribute ? el.getAttribute('style') : null;
    if (style && /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) return true;
    return false;
  }

  function isExcluded(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (isHidden(el)) return true;
    for (let i = 0; i < excludeSelectors.length; i += 1) {
      try {
        if (el.matches && el.matches(excludeSelectors[i])) return true;
      } catch (e) { /* selector khong hop le trong runtime nay */ }
    }
    return false;
  }

  function hasBlockChild(el) {
    const kids = el.children || [];
    for (let i = 0; i < kids.length; i += 1) {
      if (isExcluded(kids[i])) continue;
      if (BLOCK_TAGS.has(kids[i].tagName)) return true;
      if (hasBlockChild(kids[i])) return true;
    }
    return false;
  }

  function renderInline(node) {
    if (!node) return '';
    if (node.nodeType === 3) return collapse(node.nodeValue);
    if (node.nodeType !== 1) return '';
    if (isExcluded(node)) return '';

    const tag = node.tagName;
    if (tag === 'BR') return '\n';

    let inner = '';
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i += 1) inner += renderInline(kids[i]);

    if (tag === 'A' && keepLinks) {
      const href = node.getAttribute('href') || '';
      const text = inner.trim();
      if (!text) return '';
      if (!href || href.indexOf('#') === 0 || href.indexOf('javascript:') === 0) return text;
      const safeText = text.replace(/([[\]])/g, '\\$1');
      return `[${safeText}](${href})`;
    }
    if (tag === 'STRONG' || tag === 'B') {
      const t = inner.trim();
      return t ? `**${t}**` : '';
    }
    if (tag === 'EM' || tag === 'I') {
      const t = inner.trim();
      return t ? `*${t}*` : '';
    }
    if (tag === 'CODE') {
      const t = inner.trim();
      return t ? '`' + t + '`' : '';
    }
    return inner;
  }

  function renderList(el, depth, ordered) {
    const out = [];
    const kids = el.children || [];
    let index = 1;
    for (let i = 0; i < kids.length; i += 1) {
      const li = kids[i];
      if (li.tagName !== 'LI' || isExcluded(li)) continue;
      const marker = ordered ? `${index}. ` : '- ';
      const indent = '  '.repeat(depth);

      const nested = [];
      const liKids = li.children || [];
      for (let j = 0; j < liKids.length; j += 1) {
        if (liKids[j].tagName === 'UL' || liKids[j].tagName === 'OL') nested.push(liKids[j]);
      }

      let text = '';
      const liNodes = li.childNodes || [];
      for (let j = 0; j < liNodes.length; j += 1) {
        const n = liNodes[j];
        if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) continue;
        text += renderInline(n);
      }
      text = text.replace(/\s*\n\s*/g, ' ').trim();
      if (text) out.push(indent + marker + text);

      for (let j = 0; j < nested.length; j += 1) {
        const sub = renderList(nested[j], depth + 1, nested[j].tagName === 'OL');
        if (sub) out.push(sub);
      }
      index += 1;
    }
    return out.join('\n');
  }

  function renderBlock(el, depth) {
    if (!el || el.nodeType !== 1 || isExcluded(el)) return '';
    const tag = el.tagName;

    if (tag === 'UL' || tag === 'OL') return renderList(el, 0, tag === 'OL');

    if (/^H[1-6]$/.test(tag)) {
      const level = Math.min(6, headingBase + (parseInt(tag.slice(1), 10) - 1));
      const text = renderInline(el).replace(/\s*\n\s*/g, ' ').trim();
      return text ? `${'#'.repeat(level)} ${text}` : '';
    }

    if (tag === 'PRE') {
      const text = (el.textContent || '').replace(/\s+$/g, '');
      return text ? '```\n' + text + '\n```' : '';
    }

    if (tag === 'BLOCKQUOTE') {
      const inner = renderChildren(el, depth + 1);
      return inner ? inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n') : '';
    }

    if (tag === 'HR') return '---';

    if (tag === 'TABLE') {
      const rows = [];
      const trs = el.querySelectorAll ? el.querySelectorAll('tr') : [];
      for (let i = 0; i < trs.length; i += 1) {
        const cells = [];
        const cs = trs[i].children || [];
        for (let j = 0; j < cs.length; j += 1) {
          cells.push(renderInline(cs[j]).replace(/\s*\n\s*/g, ' ').trim());
        }
        if (cells.length) rows.push(`| ${cells.join(' | ')} |`);
      }
      if (rows.length > 1) {
        const cols = (rows[0].match(/\|/g) || []).length - 1;
        rows.splice(1, 0, `|${' --- |'.repeat(Math.max(1, cols))}`);
      }
      return rows.join('\n');
    }

    if (!hasBlockChild(el)) {
      const text = renderInline(el).replace(/\n{2,}/g, '\n').trim();
      return text;
    }

    return renderChildren(el, depth + 1);
  }

  function renderChildren(el, depth) {
    const blocks = [];
    const kids = el.childNodes || [];
    let inlineBuffer = '';

    function flush() {
      const t = inlineBuffer.replace(/\n{2,}/g, '\n').trim();
      if (t) blocks.push(t);
      inlineBuffer = '';
    }

    for (let i = 0; i < kids.length; i += 1) {
      const node = kids[i];
      if (node.nodeType === 3) { inlineBuffer += collapse(node.nodeValue); continue; }
      if (node.nodeType !== 1) continue;
      if (isExcluded(node)) continue;

      if (BLOCK_TAGS.has(node.tagName)) {
        flush();
        const block = renderBlock(node, depth);
        if (block) blocks.push(block);
      } else {
        inlineBuffer += renderInline(node);
      }
    }
    flush();
    return blocks.join('\n\n');
  }

  if (!root) return '';
  const md = renderChildren(root, 0);
  const cleaned = md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

/**
 * Wrapper cho Node-side test: nhan HTML string, tra ve markdown.
 * (Test truyen vao parser cua linkedom de tranh phu thuoc DOM that.)
 * @param {(html:string)=>Element} parse
 */
export function markdownFromHtml(parse, html, options) {
  return domToMarkdown(parse(html), options);
}
