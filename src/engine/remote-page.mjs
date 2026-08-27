/**
 * Page kieu Playwright, chay tren CDP qua extension.
 *
 * Muc tieu: cac file trong src/adapters/ KHONG PHAI SUA MOT DONG NAO.
 * Vi vay bo mat API o day duoc chep dung theo nhung gi adapter goi:
 *   goto reload url waitForLoadState evaluate screenshot close isClosed
 *   bringToFront setViewportSize context keyboard.press locator getByRole
 *   getByText request.get frames mainFrame waitForEvent('download')
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../core/errors.mjs';
import { CdpSession } from './cdp-session.mjs';
import { RemoteLocator, RemoteElementHandle, dispatchKey } from './remote-locator.mjs';
import { composeExtractor } from '../browser/page-eval.mjs';
import { clearNodeStore } from './selector-resolver.mjs';

const CLEAR_STORE_SRC = composeExtractor(clearNodeStore).toString();

export class RemotePage {
  /**
   * @param {{context:object, tabId:number, bridge:object, logger?:object}} opts
   */
  constructor(opts) {
    this._context = opts.context;
    this._bridge = opts.bridge;
    this._tabId = opts.tabId;
    this._logger = opts.logger;
    this._closed = false;
    this._url = 'about:blank';
    this._cdp = null;
    /** Target con dang duoc bam vao (vd <webview> cua AI Mode); null = chinh tab. */
    this._targetId = null;
    // Tab moi luon mo o che do nen de khong cuop viec dang lam cua nguoi dung.
    this._visible = false;
    /** @type {Array<{tabId:number, target:object}>} */
    this._downloads = [];

    this.keyboard = {
      press: async (key) => {
        const session = await this._session();
        await dispatchKey(session, key);
      },
    };

    this.request = {
      /**
       * Goi HTTP TU TRONG TRANG chu khong tu Node.
       * Bat buoc phai vay: endpoint complete/search cua Google tra ve ket qua
       * khac nhau tuy cookie va vi tri cua phien. Fetch tu Node se mat het
       * ngu canh do va cho ra goi y sai.
       */
      get: async (url, options = {}) => {
        const session = await this._session();
        const body = await session.evaluate(
          `(async () => {
             const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
             return { status: res.status, body: await res.text() };
           })()`,
          { timeout: options.timeout ?? 15000 },
        );
        return {
          status: () => body.status,
          ok: () => body.status >= 200 && body.status < 300,
          text: async () => body.body,
          json: async () => JSON.parse(body.body),
        };
      },
    };
  }

  get tabId() {
    return this._tabId;
  }

  async _session() {
    if (this._closed) {
      throw new AppError('PAGE_CLOSED', 'Tab da dong, khong thao tac duoc nua.');
    }
    if (!this._cdp) {
      this._cdp = await this._openSession(
        this._targetId ? { targetId: this._targetId } : { tabId: this._tabId },
      );
    }
    return this._cdp;
  }

  /** Tao mot phien CDP moi gan vao tab hoac vao mot target con. */
  async _openSession(debuggee) {
    const cdp = new CdpSession({ ...debuggee, bridge: this._bridge, logger: this._logger });
    await cdp.enable('Page');
    await cdp.enable('Runtime');
    cdp.on('Page.frameNavigated', (params) => {
      if (!params.frame?.parentId) this._url = params.frame.url;
    });
    return cdp;
  }

  /* --------------------------------------------------------- target con */

  /**
   * Liet ke moi target trong trinh duyet (ke ca <webview>).
   * @returns {Promise<object[]>} TargetInfo cua chrome.debugger.getTargets()
   */
  async listTargets() {
    const res = await this._bridge.call('getTargets', {}).catch(() => null);
    return res?.targets ?? [];
  }

  /** Target id cua chinh tab nay (khong phai target con nao). */
  async _ownTargetId(targets) {
    const list = targets ?? (await this.listTargets());
    const mine = list.find((t) => t.tabId === this._tabId && (t.type === 'page' || !t.type));
    return mine?.id ?? mine?.targetId ?? null;
  }

  /**
   * Chuyen moi thao tac sang mot target con - vi du <webview> ma Chrome dung de
   * hien AI Mode ben trong chrome://contextual-tasks/.
   *
   * VI SAO CAN: khi Google chuyen SERP sang AI Mode (udm=50), mot so ban Chrome
   * khong tai trang do trong tab nua ma nhet no vao mot <webview>. Document cua
   * TAB khi do rong hoac chi la vo giao dien noi bo, nen moi selector cua o nhap
   * prompt deu truot - trieu chung dung nhu run that 2026-08-27: mo udm=50 thanh
   * cong nhung khong tim thay ai_prompt_box.input, muc AI Mode ra rong.
   *
   * Chi doi duong di cua lenh CDP. tabId giu nguyen nen bringToFront/close
   * van tac dong dung tab do.
   *
   * @param {{match:RegExp, timeoutMs?:number, pollMs?:number}} opts
   * @returns {Promise<object|null>} TargetInfo da bam vao, null neu khong co
   */
  async adoptEmbeddedTarget(opts) {
    const { match } = opts;
    const deadline = Date.now() + (opts.timeoutMs ?? 8000);
    const pollMs = opts.pollMs ?? 500;

    for (;;) {
      const targets = await this.listTargets();
      const ownId = await this._ownTargetId(targets);
      const candidates = targets.filter((t) => {
        const id = t.id ?? t.targetId;
        if (!id || id === ownId || id === this._targetId) return false;
        return Boolean(t.url) && match.test(t.url);
      });
      // <webview> truoc, roi den iframe/page tach tien trinh.
      candidates.sort((a, b) => rankTarget(a) - rankTarget(b));

      const pick = candidates[0];
      if (pick) {
        const id = pick.id ?? pick.targetId;
        try {
          await this._bridge.call('attachTarget', { targetId: id });
          this._cdp?.dispose();
          this._cdp = await this._openSession({ targetId: id });
          this._targetId = id;
          this._url = pick.url;
          this._logger?.info(
            `Da bam vao target con "${pick.type ?? '?'}" de doc noi dung: ${pick.url}`,
          );
          return pick;
        } catch (err) {
          this._logger?.debug(`Khong attach duoc target ${id}: ${err.message}`);
        }
      }
      if (Date.now() >= deadline) return null;
      await new Promise((resolve) => { setTimeout(resolve, pollMs); });
    }
  }

  /** Quay lai lam viec voi chinh tab, bo target con dang bam. */
  async releaseTarget() {
    if (!this._targetId) return;
    const targetId = this._targetId;
    this._targetId = null;
    this._cdp?.dispose();
    this._cdp = null;
    await this._bridge.call('detachTarget', { targetId }).catch(() => {});
  }

  /** Dang lam viec tren target con hay tren chinh tab. */
  get embeddedTargetId() {
    return this._targetId;
  }

  /* ------------------------------------------------------------ dieu huong */

  async goto(url, options = {}) {
    // Dieu huong luon la viec cua TAB. Neu dang bam vao mot target con thi
    // target do se bien mat khi tab roi trang, nen tra ve tab truoc da.
    await this.releaseTarget();
    const session = await this._session();
    const timeout = options.timeout ?? 45000;
    const waitUntil = options.waitUntil ?? 'load';

    // Dang ky truoc khi dieu huong, neu khong su kien co the den truoc khi kip nghe.
    const settled = this._waitForNavigation(session, waitUntil, timeout);
    await session.send('Page.navigate', { url }, { timeout });
    await settled;
    this._url = await this._readUrl(session);
    return null;
  }

  async reload(options = {}) {
    const session = await this._session();
    const timeout = options.timeout ?? 45000;
    const settled = this._waitForNavigation(session, options.waitUntil ?? 'load', timeout);
    await session.send('Page.reload', {}, { timeout });
    await settled;
    this._url = await this._readUrl(session);
  }

  /**
   * Doi trang tai xong.
   *
   * 'domcontentloaded' -> Page.domContentEventFired
   * 'load'             -> Page.loadEventFired
   * Neu su kien khong den (trang SPA khong dieu huong that), ta van tra ve
   * sau timeout thay vi nem loi: adapter co logic doi rieng cua no.
   */
  _waitForNavigation(session, waitUntil, timeout) {
    const event = waitUntil === 'domcontentloaded'
      ? 'Page.domContentEventFired'
      : 'Page.loadEventFired';
    return session.waitForEvent(event, { timeout }).catch(() => null);
  }

  async waitForLoadState(state = 'load', options = {}) {
    const session = await this._session();
    const ready = await session.evaluate('document.readyState');
    if (state === 'domcontentloaded' && (ready === 'interactive' || ready === 'complete')) return;
    if (state === 'load' && ready === 'complete') return;
    await this._waitForNavigation(session, state, options.timeout ?? 30000);
  }

  async _readUrl(session) {
    try {
      return await session.evaluate('location.href');
    } catch {
      return this._url;
    }
  }

  /**
   * URL hien tai. Playwright tra ve dong bo nen ta phai giu ban cache,
   * duoc cap nhat sau moi lan dieu huong va boi Page.frameNavigated.
   */
  url() {
    return this._url;
  }

  /** Dong bo lai URL tu trang - goi khi nghi trang tu dieu huong. */
  async syncUrl() {
    const session = await this._session();
    this._url = await this._readUrl(session);
    return this._url;
  }

  /* ---------------------------------------------------------------- script */

  /**
   * Chay ham trong trang.
   *
   * Playwright nhan Function va tu serialize. Ta lam dung the: doi ham thanh
   * source roi goi voi doi so da JSON hoa. Nho vay page-eval.mjs va toan bo
   * src/extractors/ chay y nguyen, khong sua.
   */
  async evaluate(fn, arg) {
    const session = await this._session();
    const source = typeof fn === 'function' ? fn.toString() : String(fn);

    // ElementHandle khong JSON hoa duoc: thay bang bieu thuc tro toi node that.
    const { json, replacements } = encodeArg(arg);
    let argExpr = json;
    for (const [token, expression] of replacements) {
      argExpr = argExpr.replace(JSON.stringify(token), expression);
    }

    if (typeof fn !== 'function') {
      return session.evaluate(source);
    }
    return session.evaluate(`(${source})(${argExpr})`);
  }

  /* ------------------------------------------------------------- locator */

  locator(selector) {
    const spec = selector.startsWith('xpath=')
      ? { type: 'xpath', xpath: selector.slice(6) }
      : { type: 'css', css: selector };
    return new RemoteLocator(this, [spec]);
  }

  getByRole(role, options = {}) {
    return new RemoteLocator(this, [{
      type: 'role',
      role,
      name: options.name instanceof RegExp
        ? (options.name.flags.includes('i') ? `(?i)${options.name.source}` : options.name.source)
        : options.name,
    }]);
  }

  getByText(text) {
    return new RemoteLocator(this, [{
      type: 'text',
      text: text instanceof RegExp
        ? (text.flags.includes('i') ? `(?i)${text.source}` : text.source)
        : String(text),
    }]);
  }

  /* ------------------------------------------------------------- cua so tab */

  context() {
    return this._context;
  }

  async bringToFront() {
    await this._bridge.call('activateTab', { tabId: this._tabId });
    this._visible = true;
    this._context._markVisible(this);
  }

  /**
   * Dam bao tab dang hien thi truoc khi gui su kien chuot/ban phim.
   *
   * RANG BUOC CUA CHROME (do thuc te ngay 2026-08-26):
   * Voi tab o che do nen, lenh Input.dispatchMouseEvent / dispatchKeyEvent van
   * tra ve THANH CONG qua CDP, nhung trang khong nhan duoc su kien nao. Khong
   * co thong bao loi - chi la khong co gi xay ra. Vi vay moi thao tac mo phong
   * nguoi dung deu phai kich hoat tab truoc.
   *
   * He qua kien truc: o che do song song, cac tab phai lan luot duoc dua len
   * truoc khi thao tac. Do chinh la ly do activeTabLock trong orchestrator van
   * can thiet voi engine nay - xem src/core/mutex.mjs.
   */
  async _ensureVisible() {
    if (this._visible) return;
    await this.bringToFront();

    // Cho DEN KHI trang thuc su nhin thay duoc, thay vi cho mot khoang co dinh.
    // Chrome hoan viec ve tab nen, nen ngay sau activateTab thi
    // document.visibilityState van con 'hidden' them mot luc; gui su kien
    // trong khoang do la mat trang.
    const session = await this._session();
    const deadline = Date.now() + 5000;
    for (;;) {
      const state = await session.evaluate('document.visibilityState').catch(() => null);
      if (state === 'visible') return;
      if (Date.now() >= deadline) {
        this._logger?.debug('Tab van khong hien thi sau 5s; van thu thao tac.');
        return;
      }
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
  }

  async setViewportSize(viewport) {
    const session = await this._session();
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
  }

  isClosed() {
    return this._closed;
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    this._cdp?.dispose();
    this._cdp = null;
    this._context._forget(this);
    await this._bridge.call('closeTab', { tabId: this._tabId }).catch(() => {});
  }

  /** Danh dau da dong tu ben ngoai (nguoi dung tu dong tab). */
  _markClosed() {
    this._closed = true;
    this._cdp?.dispose();
    this._cdp = null;
  }

  /* ------------------------------------------------------------ screenshot */

  async screenshot(options = {}) {
    const session = await this._session();
    const res = await session.send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    if (options.path) {
      fs.mkdirSync(path.dirname(options.path), { recursive: true });
      fs.writeFileSync(options.path, buffer);
    }
    return buffer;
  }

  /* ------------------------------------------------------------- download */

  /**
   * Doi mot file tai ve.
   *
   * Khac Playwright o mot diem quan trong: file da nam san trong thu muc
   * Downloads cua nguoi dung (extension khong chan duoc luong tai). Nen
   * saveAs() la mot phep COPY, va file goc duoc giu nguyen - dung nhu
   * hanh vi cua V1 (khong bao gio xoa file cua nguoi dung).
   */
  waitForEvent(event, options = {}) {
    if (event !== 'download') {
      return Promise.reject(new AppError(
        'UNSUPPORTED_EVENT',
        `Engine nay chi ho tro waitForEvent('download'), khong ho tro '${event}'.`,
      ));
    }
    const timeout = options.timeout ?? 30000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._bridge.off('download', handler);
        reject(new AppError('DOWNLOAD_TIMEOUT', `Khong co file nao duoc tai ve sau ${timeout}ms.`));
      }, timeout);

      const handler = async (params) => {
        if (params.state !== 'complete') return;
        clearTimeout(timer);
        this._bridge.off('download', handler);
        const info = await this._bridge.call('takeDownload', { id: params.id }).catch(() => params);
        resolve(makeDownload(info));
      };
      this._bridge.on('download', handler);
    });
  }

  /* ------------------------------------------------------------------ frame */

  /**
   * Cac frame cua trang, dung cho --capture-dom.
   * Bao gom ca target kieu webview - do chinh la cho AI Mode an minh tu Chrome 152.
   */
  async frames() {
    const session = await this._session();
    const tree = await session.send('Page.getFrameTree');
    const out = [];
    const walk = (node) => {
      out.push(this._makeFrame(node.frame));
      for (const child of node.childFrames ?? []) walk(child);
    };
    walk(tree.frameTree);
    return out;
  }

  mainFrame() {
    return this._makeFrame({ id: 'main', url: this._url });
  }

  _makeFrame(frame) {
    const page = this;
    return {
      url: () => frame.url,
      name: () => frame.name ?? '',
      async evaluate(fn, arg) {
        // Frame con duoc danh gia trong execution context rieng. Voi pham vi
        // ta can (chup DOM), danh gia o frame chinh la du; frame con chi dung
        // de bao cao URL nen khong can context rieng.
        return page.evaluate(fn, arg);
      },
    };
  }
}

/**
 * Uu tien target khi phai chon giua nhieu target con cung khop URL.
 * So nho hon = uu tien cao hon.
 */
function rankTarget(target) {
  const type = String(target?.type ?? '').toLowerCase();
  if (type === 'webview') return 0;
  if (type === 'iframe') return 1;
  if (type === 'page') return 2;
  return 3;
}

/** Doi ban ghi download cua extension thanh doi tuong kieu Playwright. */
function makeDownload(info) {
  return {
    suggestedFilename: () => path.basename(info.filename ?? 'download.csv'),
    path: async () => info.filename ?? null,
    async saveAs(target) {
      if (!info.filename || !fs.existsSync(info.filename)) {
        throw new AppError('DOWNLOAD_TIMEOUT', `Khong tim thay file da tai: ${info.filename}`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // COPY chu khong MOVE: file goc trong Downloads la cua nguoi dung.
      fs.copyFileSync(info.filename, target);
      return target;
    },
    async delete() { /* khong bao gio xoa file trong Downloads cua nguoi dung */ },
  };
}

/**
 * JSON hoa doi so, thay ElementHandle bang mot token de sau do doi thanh
 * bieu thuc tro toi node that trong trang.
 */
function encodeArg(arg) {
  const replacements = [];
  let counter = 0;
  const walk = (value) => {
    if (value instanceof RemoteElementHandle) {
      const token = `__serp_handle_${counter}__`;
      counter += 1;
      replacements.push([token, value.expression]);
      return token;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  const encoded = walk(arg);
  return { json: JSON.stringify(encoded ?? null), replacements };
}

export const _internals = { encodeArg, makeDownload, rankTarget, CLEAR_STORE_SRC };
