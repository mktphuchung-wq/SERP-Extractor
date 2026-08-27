/**
 * Bo giai selector chay TRONG TRANG.
 *
 * Playwright co san getByRole/getByText; CDP thi khong - no chi biet
 * DOM.querySelector. File nay lap lai dung phan ma selectors.yaml thuc su dung,
 * khong hon: role + accessible name, text, css, xpath tuong doi.
 *
 * RANG BUOC GIONG HET src/extractors/ (co test page-eval.test.mjs canh):
 *   - Ham PHAI self-contained: khong import, khong tham chieu bien ngoai scope.
 *     Ly do: no duoc serialize bang toString() roi bom vao trang qua
 *     Runtime.evaluate. Bien ngoai scope se thanh ReferenceError trong trang.
 *   - Moi helper khai bao BEN TRONG ham.
 *
 * Khac mot diem so voi src/extractors/: ham nay chi bao gio chay trong Chrome
 * that, nen duoc phep dung getComputedStyle va getBoundingClientRect.
 */

/**
 * Tim cac phan tu khop mot spec, tra ve mang chi so trong mang __serpNodes.
 *
 * Ket qua duoc luu vao window.__serpNodes de cac loi goi sau (click, fill, doc
 * text) tro lai dung phan tu do ma khong phai tim lai - tim lai co the ra phan tu
 * khac khi trang dang thay doi.
 *
 * @param {{spec:object, scopeIndex?:number, visibleOnly?:boolean, limit?:number}} arg
 */
export function resolveSpec(arg) {
  const spec = (arg && arg.spec) || {};
  const visibleOnly = arg ? arg.visibleOnly !== false : true;
  const limit = (arg && arg.limit) || 200;

  if (!window.__serpNodes) window.__serpNodes = [];
  const store = window.__serpNodes;

  const scope = (arg && typeof arg.scopeIndex === 'number')
    ? store[arg.scopeIndex]
    : document;
  if (!scope) return { found: 0, indexes: [] };

  /* --------------------------------------------------------------- helpers */

  // Dich cu phap '(?i)abc' cua selectors.yaml thanh RegExp, giong toRegExp
  // trong src/core/text.mjs. Phai lap lai o day vi khong import duoc.
  function toRe(pattern) {
    if (!pattern) return null;
    const text = String(pattern);
    const ci = text.match(/^\(\?i\)([\s\S]*)$/);
    try {
      return ci ? new RegExp(ci[1], 'i') : new RegExp(text);
    } catch {
      return null;
    }
  }

  function qsa(root, css) {
    try {
      return Array.prototype.slice.call(root.querySelectorAll(css));
    } catch {
      return [];
    }
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute('hidden')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Ten hien thi cua phan tu theo accessible name. Day la ban rut gon cua
  // thuat toan accname: du cho selectors.yaml (aria-label, aria-labelledby,
  // <label>, alt, title, roi den textContent).
  function accessibleName(el) {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map((id) => {
          const node = document.getElementById(id);
          return node ? node.textContent : '';
        })
        .filter(Boolean);
      if (parts.length) return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    if (el.id) {
      const forLabel = qsa(document, 'label[for="' + el.id.replace(/"/g, '\\"') + '"]')[0];
      if (forLabel && forLabel.textContent.trim()) return forLabel.textContent.replace(/\s+/g, ' ').trim();
    }

    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      if (alt) return alt.trim();
    }
    if (tag === 'input') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') {
        return (el.value || '').trim();
      }
      const ph = el.getAttribute('placeholder');
      if (ph && ph.trim()) return ph.trim();
    }

    const title = el.getAttribute('title');
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;
    return title ? title.trim() : '';
  }

  // Role hien co cua phan tu: role tuong minh truoc, roi den role ngam dinh.
  // Chi anh xa nhung role that su xuat hien trong selectors.yaml.
  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.trim().toLowerCase();

    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'img') return 'img';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return el.hasAttribute('list') ? 'combobox' : 'searchbox';
      if (['text', 'email', 'tel', 'url'].indexOf(type) >= 0) {
        return el.hasAttribute('list') ? 'combobox' : 'textbox';
      }
      return null;
    }
    return null;
  }

  function allElements(root) {
    const base = root === document ? document.documentElement : root;
    if (!base) return [];
    const out = qsa(base, '*');
    if (base.nodeType === 1 && root !== document) out.unshift(base);
    return out;
  }

  /* ----------------------------------------------------------- theo tung kieu */

  let matched = [];

  if (spec.type === 'css') {
    matched = qsa(scope, spec.css || '');
  } else if (spec.type === 'role') {
    const wantRole = String(spec.role || '').toLowerCase();
    const nameRe = spec.name ? toRe(spec.name) : null;
    matched = allElements(scope).filter((el) => {
      if (roleOf(el) !== wantRole) return false;
      if (!nameRe) return true;
      return nameRe.test(accessibleName(el));
    });
  } else if (spec.type === 'text' || spec.type === 'text_container') {
    const re = toRe(spec.text);
    if (re) {
      // Chi giu phan tu la node text "la" gan nhat: neu ca cha lan con deu khop
      // thi lay con, giong cach getByText cua Playwright hoat dong.
      const candidates = allElements(scope).filter((el) => {
        const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!own || !re.test(own)) return false;
        for (let i = 0; i < el.children.length; i += 1) {
          const childText = (el.children[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (childText && re.test(childText)) return false;
        }
        return true;
      });

      if (spec.type === 'text_container') {
        // Leo len 'up' cap - dung cho cac block chi nhan dien duoc qua nhan chu
        // (vi du "AI Overview", "Keywords Ideas") chu khong co attribute on dinh.
        const up = Math.max(1, spec.up || 3);
        matched = candidates.map((el) => {
          let node = el;
          for (let i = 0; i < up && node && node.parentElement; i += 1) node = node.parentElement;
          return node;
        }).filter(Boolean);
      } else {
        matched = candidates;
      }
    }
  } else if (spec.type === 'xpath') {
    try {
      const base = scope === document ? document : scope;
      const it = document.evaluate(spec.xpath, base, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let i = 0; i < it.snapshotLength; i += 1) matched.push(it.snapshotItem(i));
    } catch { /* xpath sai cu phap */ }
  }

  // Bo trung (text_container hay lam nhieu node la cung tro ve mot to tien).
  const seen = [];
  const unique = [];
  for (const el of matched) {
    if (!el || el.nodeType !== 1) continue;
    if (seen.indexOf(el) >= 0) continue;
    seen.push(el);
    unique.push(el);
  }

  const finalList = visibleOnly ? unique.filter(isVisible) : unique;
  const indexes = [];
  for (let i = 0; i < finalList.length && i < limit; i += 1) {
    store.push(finalList[i]);
    indexes.push(store.length - 1);
  }
  return { found: finalList.length, indexes };
}

/**
 * Doc thong tin can thiet de click/fill mot phan tu da luu.
 * @param {{index:number}} arg
 */
export function describeNode(arg) {
  const store = window.__serpNodes || [];
  const el = store[(arg && arg.index) || 0];
  if (!el || !el.isConnected) return { ok: false, reason: 'detached' };

  // Bat buoc cuon tuc thoi: neu trang dat scroll-behavior:smooth, toa do co
  // the van thay doi sau luc doc rect va Input.dispatchMouseEvent se click hut.
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const visible = rect.width > 0 && rect.height > 0
    && style.display !== 'none' && style.visibility !== 'hidden';

  return {
    ok: true,
    visible,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
    tag: el.tagName.toLowerCase(),
    editable: el.isContentEditable
      || el.tagName.toLowerCase() === 'input'
      || el.tagName.toLowerCase() === 'textarea',
  };
}

/** Doc textContent cua phan tu da luu. */
export function nodeTextContent(arg) {
  const store = window.__serpNodes || [];
  const el = store[(arg && arg.index) || 0];
  if (!el) return null;
  return el.textContent;
}

/**
 * Doc innerText - khac textContent o cho no ton trong cach trinh bay
 * (bo phan bi an, giu xuong dong). AI Mode dung ham nay.
 */
export function nodeInnerText(arg) {
  const store = window.__serpNodes || [];
  const el = store[(arg && arg.index) || 0];
  if (!el) return null;
  return el.innerText != null ? el.innerText : el.textContent;
}

/** Xoa rong o nhap lieu roi dat gia tri moi, phat su kien nhu nguoi dung go. */
export function fillNode(arg) {
  const store = window.__serpNodes || [];
  const el = store[(arg && arg.index) || 0];
  const value = (arg && arg.value) || '';
  if (!el) return { ok: false, reason: 'missing' };

  el.focus();
  if (el.isContentEditable) {
    el.textContent = value;
  } else {
    const proto = el.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    // React/Angular boc setter cua value; goi thang setter goc de framework
    // van nhan duoc su kien input dung cach.
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}

/** Focus dung node truoc khi phat su kien ban phim that qua CDP. */
export function focusNode(arg) {
  const store = window.__serpNodes || [];
  const el = store[(arg && arg.index) || 0];
  if (!el || !el.isConnected) return { ok: false, reason: 'missing' };
  el.focus({ preventScroll: true });
  return { ok: document.activeElement === el };
}

/** Don kho node da luu de tranh giu tham chieu DOM qua lau. */
export function clearNodeStore() {
  window.__serpNodes = [];
  return { cleared: true };
}
