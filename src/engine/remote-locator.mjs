/**
 * Locator kieu Playwright, chay tren CDP.
 *
 * Chi phai ho tro dung phan bo mat API ma src/adapters/ thuc su goi:
 *   first() nth() count() waitFor() click() fill() press() pressSequentially()
 *   type() innerText() textContent() inputValue() locator() getByRole() getByText()
 *   elementHandle() page()
 *
 * Su khac biet quan trong so voi Playwright: o day KHONG co auto-wait ngam.
 * Playwright tu doi phan tu on dinh truoc moi thao tac. Ta thay bang cach
 * giai lai selector ngay truoc tung thao tac (_resolve), nen phan tu luon
 * la ban moi nhat cua DOM chu khong phai anh chup cu.
 */
import { AppError } from '../core/errors.mjs';
import { composeExtractor } from '../browser/page-eval.mjs';
import {
  resolveSpec, describeNode, nodeTextContent, nodeInnerText, fillNode, focusNode, valueOfNode,
} from './selector-resolver.mjs';

const RESOLVE_SRC = composeExtractor(resolveSpec).toString();
const DESCRIBE_SRC = composeExtractor(describeNode).toString();
const TEXT_SRC = composeExtractor(nodeTextContent).toString();
const INNER_TEXT_SRC = composeExtractor(nodeInnerText).toString();
const FILL_SRC = composeExtractor(fillNode).toString();
const FOCUS_SRC = composeExtractor(focusNode).toString();
const VALUE_SRC = composeExtractor(valueOfNode).toString();

/** Goi mot ham da serialize voi doi so JSON. */
function callWith(fnSource, arg) {
  return `(${fnSource})(${JSON.stringify(arg)})`;
}

export class RemoteLocator {
  /**
   * @param {import('./remote-page.mjs').RemotePage} page
   * @param {Array<object>} chain danh sach spec long nhau, ap dung tu trai sang phai
   * @param {{index?:number}} [opts]
   */
  constructor(page, chain, opts = {}) {
    this._page = page;
    this._chain = chain;
    this._index = opts.index ?? null;
    this._visibleOnly = opts.visibleOnly ?? false;
  }

  page() {
    return this._page;
  }

  /* --------------------------------------------------------- tao locator con */

  locator(selector) {
    // 'xpath=...' la cu phap cua Playwright ma locator.mjs dung cho text_container.
    const spec = selector.startsWith('xpath=')
      ? { type: 'xpath', xpath: selector.slice(6) }
      : { type: 'css', css: selector };
    return new RemoteLocator(this._page, [...this._chain, spec], { visibleOnly: this._visibleOnly });
  }

  getByRole(role, options = {}) {
    return new RemoteLocator(
      this._page,
      [...this._chain, { type: 'role', role, name: options.name ? sourceOf(options.name) : undefined }],
      { visibleOnly: this._visibleOnly },
    );
  }

  getByText(text) {
    return new RemoteLocator(
      this._page,
      [...this._chain, { type: 'text', text: sourceOf(text) }],
      { visibleOnly: this._visibleOnly },
    );
  }

  first() {
    return new RemoteLocator(this._page, this._chain, { index: 0, visibleOnly: this._visibleOnly });
  }

  nth(index) {
    return new RemoteLocator(this._page, this._chain, { index, visibleOnly: this._visibleOnly });
  }

  /* ------------------------------------------------------------------ giai */

  /**
   * Giai chuoi spec thanh chi so node trong window.__serpNodes.
   * @returns {Promise<number|null>}
   */
  async _resolve({ visibleOnly = this._visibleOnly } = {}) {
    const session = await this._page._session();
    let scopeIndex;

    for (let i = 0; i < this._chain.length; i += 1) {
      const spec = this._chain[i];
      const last = i === this._chain.length - 1;
      const wantIndex = last ? (this._index ?? 0) : 0;

      const res = await session.evaluate(callWith(RESOLVE_SRC, {
        spec,
        scopeIndex,
        // Chi buoc CUOI moi loc theo visible: cac buoc trung gian chi la pham vi
        // tim kiem, khong nhat thiet phai tu nhin thay duoc.
        visibleOnly: last ? visibleOnly : false,
        limit: last ? wantIndex + 1 : 1,
      }));

      if (!res || !res.indexes.length) return null;
      if (last && wantIndex >= res.indexes.length) return null;
      scopeIndex = res.indexes[last ? wantIndex : 0];
    }
    return scopeIndex ?? null;
  }

  async _requireNode(action, { visibleOnly = false } = {}) {
    const index = await this._resolve({ visibleOnly });
    if (index == null) {
      throw new AppError(
        'LOCATOR_NOT_FOUND',
        `Khong tim thay phan tu de ${action}: ${describeChain(this._chain)}`,
        { retryable: true },
      );
    }
    return index;
  }

  /* ----------------------------------------------------------------- doc */

  async count() {
    const session = await this._page._session();
    let scopeIndex;
    for (let i = 0; i < this._chain.length; i += 1) {
      const last = i === this._chain.length - 1;
      const res = await session.evaluate(callWith(RESOLVE_SRC, {
        spec: this._chain[i],
        scopeIndex,
        visibleOnly: false,
        limit: last ? 200 : 1,
      }));
      if (!res || !res.indexes.length) return 0;
      if (last) return res.found;
      scopeIndex = res.indexes[0];
    }
    return 0;
  }

  async textContent() {
    const index = await this._requireNode('doc text');
    const session = await this._page._session();
    return session.evaluate(callWith(TEXT_SRC, { index }));
  }

  async innerText(options = {}) {
    const index = await this._requireNode('doc innerText');
    const session = await this._page._session();
    return session.evaluate(callWith(INNER_TEXT_SRC, { index }), {
      timeout: options.timeout ?? 30000,
    });
  }

  /** Cung ten va cung y nghia voi Locator.inputValue() cua Playwright. */
  async inputValue() {
    const index = await this._requireNode('doc gia tri o nhap');
    const session = await this._page._session();
    const value = await session.evaluate(callWith(VALUE_SRC, { index }));
    return typeof value === 'string' ? value : '';
  }

  /**
   * Doi phan tu dat trang thai mong muon.
   * Chi ho tro state 'visible' va 'attached' - la nhung gi locator.mjs dung.
   */
  async waitFor(options = {}) {
    const state = options.state ?? 'visible';
    const timeout = options.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const visibleOnly = state === 'visible';

    for (;;) {
      const index = await this._resolve({ visibleOnly });
      if (index != null) return;
      if (Date.now() >= deadline) {
        throw new AppError(
          'LOCATOR_TIMEOUT',
          `Phan tu khong ${state} sau ${timeout}ms: ${describeChain(this._chain)}`,
          { retryable: true },
        );
      }
      await sleep(120);
    }
  }

  /* ------------------------------------------------------------- thao tac */

  /**
   * Click bang su kien chuot THAT qua Input.dispatchMouseEvent.
   *
   * Khong dung el.click() cua JavaScript: su kien do co isTrusted=false, va mot
   * so thanh phan cua Google (dac biet la o tim kiem va nut cua AI Mode) bo qua
   * su kien khong dang tin cay.
   */
  async click(options = {}) {
    const timeout = options.timeout ?? 30000;
    // Tab phai dang hien thi thi Chrome moi chuyen su kien chuot vao trang.
    // Da do thuc te 2026-08-26: tab o che do nen nhan lenh Input.* thanh cong
    // (CDP tra ve OK) nhung trang KHONG he nhan duoc su kien nao.
    await this._page._ensureVisible();
    const target = await this._waitAndDescribe(timeout);
    const session = await this._page._session();

    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: target.x, y: target.y, button: 'none', buttons: 0,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: target.x, y: target.y, button: 'left', buttons: 1, clickCount: 1,
    });
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: target.x, y: target.y, button: 'left', buttons: 0, clickCount: 1,
    });
  }

  async _waitAndDescribe(timeout) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const nodeIndex = await this._resolve({ visibleOnly: true });
      if (nodeIndex != null) {
        const session = await this._page._session();
        const box = await session.evaluate(callWith(DESCRIBE_SRC, { index: nodeIndex }));
        // Cuon xong toa do moi dung; doc lai mot lan nua sau khi cuon.
        if (box?.ok && box.visible) {
          await sleep(60);
          const settled = await session.evaluate(callWith(DESCRIBE_SRC, { index: nodeIndex }));
          return settled?.ok ? { ...settled, index: nodeIndex } : { ...box, index: nodeIndex };
        }
      }
      if (Date.now() >= deadline) {
        throw new AppError(
          'LOCATOR_TIMEOUT',
          `Phan tu khong san sang de thao tac sau ${timeout}ms: ${describeChain(this._chain)}`,
          { retryable: true },
        );
      }
      await sleep(120);
    }
  }

  async fill(value, options = {}) {
    const timeout = options.timeout ?? 30000;
    const target = await this._waitAndDescribe(timeout);
    const session = await this._page._session();
    // Focus bang click that truoc, roi dat gia tri. Cach nay giu nguyen hanh vi
    // cua nhung o nhap lieu chi khoi tao khi duoc focus that.
    await this.click({ timeout });
    await session.evaluate(callWith(FILL_SRC, { index: target.index, value }));
  }

  /**
   * Go tung ky tu bang su kien ban phim that.
   *
   * Day la mau chot cua buoc Search Suggestions: Google chi bung dropdown khi
   * nhan su kien ban phim dang tin cay. Input.insertText khong du - phai co
   * ca keyDown/keyUp.
   */
  async pressSequentially(text, options = {}) {
    const delay = options.delay ?? 100;
    await this._page._ensureVisible();
    await this._waitAndDescribe(options.timeout ?? 30000);
    const session = await this._page._session();
    for (const char of String(text)) {
      await session.send('Input.dispatchKeyEvent', {
        type: 'keyDown', text: char, key: char, unmodifiedText: char,
      });
      await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
      if (delay) await sleep(delay);
    }
  }

  /** Ten cu cua pressSequentially, giu de tuong thich voi adapter. */
  async type(text, options = {}) {
    return this.pressSequentially(text, options);
  }

  async press(key, options = {}) {
    await this._page._ensureVisible();
    const target = await this._waitAndDescribe(options.timeout ?? 30000);
    const session = await this._page._session();
    await session.evaluate(callWith(FOCUS_SRC, { index: target.index }));
    await dispatchKey(session, key);
  }

  /**
   * Tra ve mot "handle" tro toi phan tu, dung cho runExtractorOnLocator.
   * Khac Playwright: day khong phai JSHandle that, chi la chi so trong
   * window.__serpNodes. remote-page.mjs biet cach doi no thanh tham so.
   */
  async elementHandle() {
    const index = await this._resolve({ visibleOnly: false });
    if (index == null) return null;
    return new RemoteElementHandle(this._page, index);
  }
}

/** Tham chieu toi mot phan tu da luu trong trang. */
export class RemoteElementHandle {
  constructor(page, index) {
    this._page = page;
    this._index = index;
  }

  /** Bieu thuc JS lay lai phan tu nay trong trang. */
  get expression() {
    return `window.__serpNodes[${this._index}]`;
  }

  async dispose() {
    // Kho node duoc don mot lan o cuoi run (clearNodeStore). Giu ham nay de
    // adapter goi .dispose() nhu voi Playwright ma khong phai sua.
  }
}

/* -------------------------------------------------------------- ho tro */

/** Ban phim: doi ten phim thanh bo tham so CDP. */
export async function dispatchKey(session, key) {
  const map = {
    Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
    Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
    Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab', text: '\t' },
    Backspace: { windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' },
    ArrowDown: { windowsVirtualKeyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
    ArrowUp: { windowsVirtualKeyCode: 38, code: 'ArrowUp', key: 'ArrowUp' },
  };
  const desc = map[key] ?? { key, text: key };
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...desc });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...desc });
}

/** Lay lai chuoi goc cua RegExp de gui qua ranh gioi tien trinh. */
function sourceOf(value) {
  if (value instanceof RegExp) {
    return value.flags.includes('i') ? `(?i)${value.source}` : value.source;
  }
  return String(value);
}

function describeChain(chain) {
  return chain.map((spec) => {
    if (spec.type === 'css') return `css=${spec.css}`;
    if (spec.type === 'role') return `role=${spec.role}[name=${spec.name ?? ''}]`;
    if (spec.type === 'text') return `text=${spec.text}`;
    if (spec.type === 'text_container') return `text_container=${spec.text}^${spec.up ?? 3}`;
    if (spec.type === 'xpath') return `xpath=${spec.xpath}`;
    return JSON.stringify(spec);
  }).join(' >> ');
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export const _internals = { sourceOf, describeChain, callWith };
