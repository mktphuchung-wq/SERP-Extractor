/**
 * Browser + BrowserContext kieu Playwright, chay tren extension bridge.
 *
 * Diem khac biet lon nhat so voi V1, va cung la muc dich cua V2:
 * KHONG co tien trinh Chrome nao duoc khoi dong. Cac tab duoc mo ngay trong
 * cua so Chrome ma nguoi dung dang lam viec, nen moi phien dang nhap
 * (Google, Ahrefs) va moi extension san co deu dung ngay - khong phai
 * dang nhap lai, khong phai dong goi extension.
 */
import { AppError } from '../core/errors.mjs';
import { RemotePage } from './remote-page.mjs';

export class RemoteContext {
  constructor(opts) {
    this._bridge = opts.bridge;
    this._logger = opts.logger;
    this._browser = opts.browser;
    /** @type {RemotePage[]} */
    this._pages = [];
    /** @type {Set<Function>} nguoi nghe su kien 'page' */
    this._pageListeners = new Set();

    this._onTabRemoved = ({ tabId }) => {
      const page = this._pages.find((p) => p.tabId === tabId);
      if (page) {
        page._markClosed();
        this._forget(page);
      }
    };
    this._bridge.on('tab-removed', this._onTabRemoved);
  }

  /**
   * Mo tab moi NGAY TRONG cua so Chrome hien tai cua nguoi dung.
   *
   * Tab duoc mo o trang thai HIEN THI. Khong phai lua chon tham my: tab do
   * extension tao ngam (active:false) bi Chrome giu o visibilityState='hidden'
   * vinh vien va khong nhan duoc su kien chuot/ban phim nao - xem ghi chu o
   * newTab() trong extension/background.js.
   */
  async newPage(options = {}) {
    const res = await this._bridge.call('newTab', {
      url: options.url ?? 'about:blank',
      active: options.active !== false,
    });
    const page = new RemotePage({
      context: this,
      bridge: this._bridge,
      tabId: res.tabId,
      logger: this._logger,
    });
    page._visible = true;
    this._markVisible(page);
    this._pages.push(page);
    for (const fn of this._pageListeners) {
      try { fn(page); } catch { /* nguoi nghe hong khong lam vo run */ }
    }
    return page;
  }

  pages() {
    return this._pages.filter((p) => !p.isClosed());
  }

  /**
   * Mot tab duoc dua len truoc thi moi tab con lai bi che khuat.
   *
   * Phai theo doi dieu nay vi su kien chuot/ban phim chi den duoc tab dang
   * hien thi (xem RemotePage._ensureVisible). Neu khong cap nhat, mot tab
   * tuong minh dang hien thi se gui su kien vao hu khong.
   */
  _markVisible(page) {
    for (const other of this._pages) {
      if (other !== page) other._visible = false;
    }
  }

  _forget(page) {
    this._pages = this._pages.filter((p) => p !== page);
  }

  /**
   * Nghe tab moi. serp-export.mjs dung cai nay de bat tab ket qua ma
   * extension SEO SERP tu mo ra.
   *
   * Luu y gioi han: chi bao cao duoc tab do CHINH TOOL mo. Tab do mot
   * extension khac mo khong thuoc quyen dieu khien cua bridge (xem
   * assertOwned trong extension/background.js), nen khong bao cao o day.
   */
  on(event, handler) {
    if (event === 'page') this._pageListeners.add(handler);
    return this;
  }

  off(event, handler) {
    if (event === 'page') this._pageListeners.delete(handler);
    return this;
  }

  /**
   * Playwright cap quyen clipboard o muc context. Voi engine nay, quyen do
   * da co san: extension khai clipboardRead trong manifest, va tab lam viec
   * tren chinh profile cua nguoi dung nen Google da duoc cap quyen tu truoc.
   */
  async grantPermissions() {
    return true;
  }

  async close() {
    this._bridge.off('tab-removed', this._onTabRemoved);
    for (const page of [...this._pages]) {
      await page.close().catch(() => {});
    }
  }
}

export class RemoteBrowser {
  constructor(opts) {
    this._bridge = opts.bridge;
    this._logger = opts.logger;
    this._context = new RemoteContext({ bridge: opts.bridge, logger: opts.logger, browser: this });
    this.version = opts.version ?? null;
  }

  contexts() {
    return [this._context];
  }

  isConnected() {
    return this._bridge.connected;
  }

  /** Ngat cau noi. KHONG dong Chrome cua nguoi dung. */
  async close() {
    await this._context.close();
  }
}

/**
 * Ket noi toi Chrome ca nhan cua nguoi dung qua extension bridge.
 *
 * @param {{bridge:object, logger?:object, timeout?:number}} opts
 */
export async function connectViaBridge(opts) {
  const info = await opts.bridge.waitForClient(opts.timeout ?? 120000);
  if (!info) {
    throw new AppError(
      'BRIDGE_NOT_CONNECTED',
      'Extension "SERP Extractor Bridge" chua ket noi. Kiem tra da cai va bat extension chua.',
    );
  }
  const browserInfo = await opts.bridge.call('browserInfo').catch(() => ({}));
  opts.logger?.info(`Da noi vao Chrome dang chay cua ban (${browserInfo.chromeVersion ?? '?'}).`);
  return new RemoteBrowser({
    bridge: opts.bridge,
    logger: opts.logger,
    version: { Browser: `Chrome/${browserInfo.chromeVersion ?? '?'}`, ...browserInfo },
  });
}
