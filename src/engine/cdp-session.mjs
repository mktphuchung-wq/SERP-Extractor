/**
 * Mot phien CDP gan voi mot tab (hoac mot target con nhu <webview>).
 *
 * Lop nay chi lam mot viec: doi lenh CDP tho thanh cac thao tac co nghia
 * (danh gia bieu thuc, doc thuoc tinh, doi trang tai xong). Phan dich sang
 * API kieu Playwright nam o remote-page.mjs.
 */
import { AppError } from '../core/errors.mjs';

export class CdpSession {
  /**
   * @param {{bridge:object, tabId?:number, targetId?:string, logger?:object}} opts
   */
  constructor(opts) {
    this.bridge = opts.bridge;
    this.tabId = opts.tabId ?? null;
    this.targetId = opts.targetId ?? null;
    this.logger = opts.logger;
    this._enabled = new Set();
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();

    this._onCdp = (params) => {
      const mine = this.targetId
        ? params.targetId === this.targetId
        : params.tabId === this.tabId;
      if (!mine) return;
      const set = this._listeners.get(params.method);
      if (set) for (const fn of set) fn(params.params);
    };
    this.bridge.on('cdp', this._onCdp);
  }

  /** Gui mot lenh CDP tho. */
  send(method, params = {}, opts = {}) {
    return this.bridge.call('cdp', {
      tabId: this.tabId,
      targetId: this.targetId,
      method,
      params,
    }, opts);
  }

  /** Bat mot domain CDP dung mot lan. */
  async enable(domain) {
    if (this._enabled.has(domain)) return;
    this._enabled.add(domain);
    await this.send(`${domain}.enable`);
  }

  on(method, handler) {
    if (!this._listeners.has(method)) this._listeners.set(method, new Set());
    this._listeners.get(method).add(handler);
    return () => this.off(method, handler);
  }

  off(method, handler) {
    this._listeners.get(method)?.delete(handler);
  }

  /** Cho mot su kien CDP, co timeout. */
  waitForEvent(method, { timeout = 30000, predicate } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(method, handler);
        reject(new AppError('CDP_EVENT_TIMEOUT', `Khong nhan duoc "${method}" sau ${timeout}ms.`));
      }, timeout);
      const handler = (params) => {
        if (predicate && !predicate(params)) return;
        clearTimeout(timer);
        this.off(method, handler);
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  /**
   * Danh gia mot bieu thuc trong trang va tra ve gia tri thuan.
   *
   * awaitPromise: true de ham async (vi du doc clipboard) hoat dong dung.
   * returnByValue: true de ket qua di qua duoc ranh gioi tien trinh.
   */
  async evaluate(expression, { timeout = 30000, awaitPromise = true } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    }, { timeout });

    if (res.exceptionDetails) {
      const detail = res.exceptionDetails;
      const message = detail.exception?.description
        ?? detail.exception?.value
        ?? detail.text
        ?? 'Loi khong ro trong trang';
      throw new AppError('PAGE_EVAL_FAILED', `Loi khi chay script trong trang: ${message}`);
    }
    return res.result?.value;
  }

  dispose() {
    this.bridge.off('cdp', this._onCdp);
    this._listeners.clear();
  }
}
