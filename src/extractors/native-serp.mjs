/**
 * Native SERP extractor - fallback khi SEO SERP Extraction Tool khong dung duoc.
 *
 * Ham `extractOrganicResults` self-contained (khong tham chieu bien ngoai)
 * de vua chay duoc trong page.evaluate() vua goi truc tiep tren linkedom trong test.
 *
 * Bo theo dac ta muc 6 - Step 6:
 *   Ads/Sponsored, AI Overview, PAA, carousel Videos/Images/Shopping/Forums,
 *   Ahrefs toolbar rows va moi node chrome-extension://
 * Giu featured snippet neu no cung la ket qua organic hop le.
 */

export const CANONICAL_CSV_HEADER = [
  'position', 'title', 'url', 'displayed_url', 'description',
  'result_type', 'source_page', 'captured_at',
];

/**
 * @param {{options?:object, document?:Document}} arg
 * @returns {Array<{position:number,title:string,url:string,displayed_url:string,description:string,result_type:string,source_page:number,captured_at:string}>}
 */
export function extractOrganicResults(arg) {
  const a0 = arg || {};
  const options = a0.options || {};
  const doc = a0.document ? a0.document : document;

  const resultContainers = options.resultContainers || ['#rso', '#search'];
  const excludeContainers = options.excludeContainers || [];
  const excludeTextAnchors = options.excludeTextAnchors || [];
  const excludeUrlPatterns = options.excludeUrlPatterns || [];
  const featuredSnippetContainers = options.featuredSnippetContainers || [];
  const startOffset = options.startOffset || 0;
  const sourcePage = options.sourcePage || 1;
  const capturedAt = options.capturedAt || '';
  const baseUrl = options.baseUrl || (doc.location ? doc.location.href : 'https://www.google.com/');
  const maxResults = options.maxResults || 50;

  function toRe(pattern) {
    if (!pattern) return null;
    const str = String(pattern);
    const m = /^\(\?([a-z]+)\)([\s\S]*)$/.exec(str);
    try {
      if (m) return new RegExp(m[2], m[1].replace(/[^imsu]/g, ''));
      return new RegExp(str);
    } catch (e) { return null; }
  }
  const excludeTextRes = excludeTextAnchors.map(toRe).filter(Boolean);
  const excludeUrlRes = excludeUrlPatterns.map(toRe).filter(Boolean);

  function collapse(text) {
    return String(text == null ? '' : text)
      .replace(new RegExp('[\\u200b-\\u200d\\ufeff]', 'g'), '')
      .replace(new RegExp('[\\u00a0\\u2007\\u202f]', 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function qsa(root, selector) {
    if (!root || !root.querySelectorAll) return [];
    try { return Array.prototype.slice.call(root.querySelectorAll(selector)); } catch (e) { return []; }
  }
  function qs(root, selector) {
    if (!root || !root.querySelector) return null;
    try { return root.querySelector(selector); } catch (e) { return null; }
  }
  function matches(el, selector) {
    if (!el || !el.matches) return false;
    try { return el.matches(selector); } catch (e) { return false; }
  }

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute && (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true')) return true;
    const style = el.getAttribute ? el.getAttribute('style') : null;
    if (style && /(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) return true;
    return false;
  }

  // 1) Xac dinh vung ket qua
  let scope = null;
  for (let i = 0; i < resultContainers.length && !scope; i += 1) {
    scope = qs(doc, resultContainers[i]);
  }
  if (!scope) scope = doc.body || doc.documentElement || doc;

  // 2) Cac vung bi loai hoan toan
  const excludedRoots = [];
  for (let i = 0; i < excludeContainers.length; i += 1) {
    const found = qsa(doc, excludeContainers[i]);
    for (let j = 0; j < found.length; j += 1) excludedRoots.push(found[j]);
  }
  function isInsideExcluded(el) {
    let node = el;
    let depth = 0;
    while (node && depth < 40) {
      if (excludedRoots.indexOf(node) !== -1) return true;
      if (isHidden(node)) return true;
      node = node.parentElement;
      depth += 1;
    }
    return false;
  }

  // 3) Chuan hoa URL (bo /url?q= wrapper cua Google)
  function normalizeUrl(href) {
    let value = String(href || '').trim();
    if (!value) return '';
    if (value.indexOf('/url?') === 0 || value.indexOf('/interstitial?') === 0) {
      const qm = /[?&](?:q|url)=([^&]+)/.exec(value);
      if (qm) { try { value = decodeURIComponent(qm[1]); } catch (e) { value = qm[1]; } }
    }
    if (/^https?:\/\//i.test(value)) return value;
    if (value.indexOf('//') === 0) return `https:${value}`;
    try { return new URL(value, baseUrl).href; } catch (e) { return value; }
  }

  // 4) Khoi ket qua: to nhat ma van chi chua dung mot tieu de
  function headingCount(el) {
    return qsa(el, 'h3').length + qsa(el, '[role="heading"][aria-level="3"]').length;
  }

  /**
   * Tim khoi DOM bao quanh MOT ket qua, di len tu the <a>.
   *
   * Bat buoc: khoi tra ve chi duoc chua DUNG MOT ket qua. Neu no phinh ra om ca
   * cac ket qua khac thi:
   *   - description va displayed_url lay nham cua ket qua ben canh;
   *   - va nang hon, hasExcludedLabel() gap chu "People also ask" / "Videos" cua
   *     mot khoi khac nam trong do roi loai bo TOAN BO ket qua.
   *
   * Ban truoc co dong `if (parent === scope) { best = node; break; }` - no ghi de
   * mat `best` da tim dung, roi lay luon con truc tiep cua scope lam khoi. Dieu do
   * chi dung khi Google xep `#rso > div.MjjYud` (moi ket qua mot con). Tu ban
   * layout them mot DIV bao o giua (`#rso > DIV > div.MjjYud`), con truc tiep cua
   * scope tro thanh khoi 50 KB chua ca 9 ket qua lan khoi PAA - va truy van
   * "best running shoes" mat sach page 1 vi ly do do.
   */
  function findBlock(anchor) {
    let node = anchor;
    let best = anchor;
    let depth = 0;
    while (node && node.parentElement && node !== scope && depth < 10) {
      const parent = node.parentElement;
      // Khong bao gio lay chinh scope (hoac to hon) lam khoi ket qua.
      if (parent === scope) break;

      const count = headingCount(parent);
      // So tieu de chi tang dan khi di len, nen gap ancestor bao tu hai ket qua
      // tro len la co the dung han.
      if (count > 1) break;
      if (count === 1) best = parent;

      node = parent;
      depth += 1;
    }
    return best;
  }

  function textMatchesExcluded(text) {
    const t = collapse(text);
    if (!t) return false;
    for (let i = 0; i < excludeTextRes.length; i += 1) {
      if (excludeTextRes[i].test(t)) return true;
    }
    return false;
  }

  function isHeadingLike(el) {
    if (!el || el.nodeType !== 1) return false;
    if (/^H[1-6]$/.test(el.tagName)) return true;
    return el.getAttribute && el.getAttribute('role') === 'heading';
  }

  /**
   * Nhan "Sponsored"/"Ad"/"Videos" nam TRONG block (leaf node), hoac heading
   * dung ngay truoc block (kieu section carousel: heading roi den danh sach item).
   * Chi so khop tuyet doi tren text cua leaf de tranh loai nham ket qua organic.
   */
  function hasExcludedLabel(block) {
    const leaves = qsa(block, 'span, div, b, strong, cite, [role="heading"], h1, h2, h3, h4');
    for (let i = 0; i < leaves.length && i < 200; i += 1) {
      const el = leaves[i];
      if (el.children && el.children.length > 0) continue;
      if (textMatchesExcluded(el.textContent)) return true;
    }
    const prev = block.previousElementSibling;
    if (isHeadingLike(prev) && textMatchesExcluded(prev.textContent)) return true;
    return false;
  }

  function isFeaturedSnippet(block) {
    for (let i = 0; i < featuredSnippetContainers.length; i += 1) {
      if (matches(block, featuredSnippetContainers[i])) return true;
      if (qs(block, featuredSnippetContainers[i])) return true;
    }
    return false;
  }

  function extractDescription(block, title, displayedUrl) {
    const preferred = ['[data-sncf]', '[data-snf]', '.VwiC3b', '[data-content-feature] div', '[data-attrid="wa:/description"]'];
    for (let i = 0; i < preferred.length; i += 1) {
      const el = qs(block, preferred[i]);
      const text = el ? collapse(el.textContent) : '';
      if (text && text.length >= 20) return text.slice(0, 600);
    }
    let text = collapse(block.textContent);
    if (title) text = text.split(title).join(' ');
    if (displayedUrl) text = text.split(displayedUrl).join(' ');
    text = collapse(text);
    return text.slice(0, 600);
  }

  // 5) Ung vien: the <a> co tieu de ben trong
  const anchors = qsa(scope, 'a[href]');
  const rows = [];
  const seenUrls = {};

  for (let i = 0; i < anchors.length; i += 1) {
    if (rows.length >= maxResults) break;
    const anchor = anchors[i];
    const heading = qs(anchor, 'h3') || qs(anchor, '[role="heading"]');
    if (!heading) continue;
    if (isInsideExcluded(anchor)) continue;

    const rawHref = anchor.getAttribute('href') || '';
    if (/^chrome-extension:\/\//i.test(rawHref)) continue;
    const url = normalizeUrl(rawHref);
    if (!url) continue;

    let blocked = false;
    for (let j = 0; j < excludeUrlRes.length; j += 1) {
      if (excludeUrlRes[j].test(url)) { blocked = true; break; }
    }
    if (blocked) continue;
    if (!/^https?:\/\//i.test(url)) continue;

    const title = collapse(heading.textContent);
    if (!title) continue;

    const block = findBlock(anchor);
    if (hasExcludedLabel(block)) continue;

    const key = url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (seenUrls[key]) continue;
    seenUrls[key] = true;

    const citeEl = qs(block, 'cite');
    const displayedUrl = citeEl ? collapse(citeEl.textContent) : '';

    rows.push({
      position: startOffset + rows.length + 1,
      title,
      url,
      displayed_url: displayedUrl,
      description: extractDescription(block, title, displayedUrl),
      result_type: isFeaturedSnippet(block) ? 'featured_snippet' : 'organic',
      source_page: sourcePage,
      captured_at: capturedAt,
    });
  }

  return rows;
}
