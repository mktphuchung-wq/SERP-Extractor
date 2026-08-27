/**
 * Cau noi giua tien trinh Node va extension "SERP Extractor Bridge" dang chay
 * trong Chrome CA NHAN cua nguoi dung.
 *
 * TAI SAO TON TAI FILE NAY (khac biet cot loi cua V2):
 * V1 phai spawn mot Chrome rieng vi tu Chrome 136, co --remote-debugging-port bi
 * TU CHOI khi --user-data-dir tro vao profile mac dinh, va khong the bat cong debug
 * cho mot cua so Chrome DANG chay. Nghia la duong CDP truc tiep khong bao gio cham
 * duoc vao trinh duyet that cua nguoi dung.
 *
 * chrome.debugger API thi KHONG bi rang buoc do: mot extension da duoc nguoi dung
 * cai co quyen attach vao tab do CHINH NO tao ra, va noi CDP day du voi tab day.
 * Vay nen huong di la: Node <-- WebSocket --> extension --> chrome.debugger --> tab.
 *
 * Giao thuc: JSON moi dong, kieu JSON-RPC rut gon.
 *   Node -> ext : {id, method, params}
 *   ext -> Node : {id, ok:true, result} | {id, ok:false, error:{message, code}}
 *   ext -> Node : {event, params}                (khong co id, khong cho tra loi)
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { startWsServer } from './ws-server.mjs';
import { AppError } from '../core/errors.mjs';

/** Cong mac dinh. 0 = de HDH chon cong trong. */
export const DEFAULT_BRIDGE_PORT = 47653;

/**
 * Server cho MOT phien lam viec. Chi phuc vu dung mot extension client.
 *
 * Su kien phat ra:
 *   'connected'          extension da bat tay xong
 *   'disconnected'       extension ngat (Chrome dong, hoac service worker bi ngu)
 *   'cdp'                {tabId, method, params} - su kien CDP tu tab
 *   'tab-removed'        {tabId}
 *   'download'           {id, filename, state, ...}
 */
export class BridgeServer extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.token = opts.token ?? crypto.randomBytes(24).toString('hex');
    this.port = opts.port ?? DEFAULT_BRIDGE_PORT;
    this.logger = opts.logger;
    this.defaultTimeout = opts.timeout ?? 30000;

    /** @type {import('./ws-server.mjs')._internals.WsConnection|null} */
    this.conn = null;
    this.server = null;
    this.clientInfo = null;
    this._nextId = 1;
    /** @type {Map<number, {resolve:Function, reject:Function, timer:NodeJS.Timeout, method:string}>} */
    this._pending = new Map();
    this._waiters = [];
  }

  async start() {
    this.server = await startWsServer({
      port: this.port,
      token: this.token,
      logger: this.logger,
      onConnection: (conn) => this._adopt(conn),
    });
    this.port = this.server.port;
    return { port: this.port, token: this.token };
  }

  _adopt(conn) {
    // Chi phuc vu mot client. Client cu (vi du service worker vua hoi sinh) bi thay the.
    if (this.conn && !this.conn.closed) {
      this.logger?.debug('Extension ket noi lai, thay the ket noi cu.');
      this.conn.close(1000, 'thay the boi ket noi moi');
    }
    this.conn = conn;

    conn.on('message', (text) => this._onMessage(text));
    conn.on('error', (err) => this.logger?.debug(`Loi WebSocket: ${err.message}`));
    conn.on('close', () => {
      if (this.conn === conn) {
        this.conn = null;
        this.emit('disconnected');
      }
      // Khong de lai promise treo vinh vien khi client bien mat.
      for (const [id, entry] of this._pending) {
        clearTimeout(entry.timer);
        entry.reject(new AppError(
          'BRIDGE_DISCONNECTED',
          `Extension ngat ket noi khi dang cho "${entry.method}".`,
        ));
        this._pending.delete(id);
      }
    });
  }

  _onMessage(text) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      this.logger?.debug('Bo qua message khong phai JSON tu extension.');
      return;
    }

    if (msg.event) {
      this._onEvent(msg);
      return;
    }

    const entry = this._pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this._pending.delete(msg.id);

    if (msg.ok === false) {
      entry.reject(new AppError(
        msg.error?.code ?? 'BRIDGE_CALL_FAILED',
        msg.error?.message ?? `Loi khong ro khi goi "${entry.method}".`,
      ));
    } else {
      entry.resolve(msg.result);
    }
  }

  _onEvent(msg) {
    switch (msg.event) {
      case 'hello': {
        this.clientInfo = msg.params ?? {};
        this.logger?.info(
          `Extension da ket noi: ${this.clientInfo.name ?? 'bridge'} v${this.clientInfo.version ?? '?'} `
          + `(Chrome ${this.clientInfo.chromeVersion ?? '?'})`,
        );
        this.emit('connected', this.clientInfo);
        for (const resolve of this._waiters.splice(0)) resolve(this.clientInfo);
        break;
      }
      case 'cdp':
        this.emit('cdp', msg.params);
        break;
      case 'tab-removed':
        this.emit('tab-removed', msg.params);
        break;
      case 'download':
        this.emit('download', msg.params);
        break;
      case 'detached':
        this.emit('detached', msg.params);
        break;
      default:
        this.logger?.debug(`Su kien la tu extension: ${msg.event}`);
    }
  }

  get connected() {
    return Boolean(this.conn && !this.conn.closed && this.clientInfo);
  }

  /**
   * Cho extension ket noi. Tra ve thong tin client.
   * @param {number} timeoutMs
   */
  waitForClient(timeoutMs = 120000) {
    if (this.connected) return Promise.resolve(this.clientInfo);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._waiters.indexOf(resolve);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new AppError(
          'BRIDGE_NOT_CONNECTED',
          `Extension khong ket noi sau ${Math.round(timeoutMs / 1000)}s.`,
        ));
      }, timeoutMs);
      this._waiters.push((info) => { clearTimeout(timer); resolve(info); });
    });
  }

  /**
   * Goi mot method o phia extension.
   * @param {string} method
   * @param {object} [params]
   * @param {{timeout?:number}} [opts]
   */
  call(method, params = {}, opts = {}) {
    if (!this.conn || this.conn.closed) {
      return Promise.reject(new AppError(
        'BRIDGE_NOT_CONNECTED',
        'Chua co extension nao ket noi toi bridge.',
      ));
    }
    const id = this._nextId;
    this._nextId += 1;
    const timeout = opts.timeout ?? this.defaultTimeout;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new AppError(
          'BRIDGE_TIMEOUT',
          `Extension khong tra loi "${method}" sau ${timeout}ms.`,
        ));
      }, timeout);
      this._pending.set(id, { resolve, reject, timer, method });
      this.conn.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    for (const [, entry] of this._pending) clearTimeout(entry.timer);
    this._pending.clear();
    // Doc lai this.conn sau moi await: ket noi co the bien mat giua chung
    // (Chrome dong, service worker ngu) va truoc day cho nay nem TypeError.
    if (this.conn && !this.conn.closed) {
      try { await this.call('shutdown', {}, { timeout: 2000 }); } catch { /* khong quan trong */ }
      if (this.conn && !this.conn.closed) this.conn.close(1000, 'ket thuc run');
    }
    if (this.server) await this.server.close();
    this.logger?.debug('Da dong bridge server.');
  }
}
