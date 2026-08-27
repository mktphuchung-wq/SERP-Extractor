/**
 * WebSocket server RFC6455 toi thieu, viet bang node:http + node:crypto.
 *
 * TAI SAO TU VIET THAY VI DUNG THU VIEN:
 * Tool nay chay tren may nguoi dung cuoi, cai bang mot dong lenh. Moi dependency
 * them vao la them mot thu phai tai ve, phai ghim phien ban, phai vet lo hong.
 * Phan giao thuc ta THUC SU can rat hep:
 *   - chi mot client (extension), chi tren 127.0.0.1
 *   - chi frame text (JSON), khong can permessage-deflate, khong can extension
 *   - khong can TLS vi khong roi khoi loopback
 * Khoang 200 dong duoi day phu het phan do.
 *
 * GIOI HAN CO Y (khong phai thieu sot):
 *   - Khong ho tro permessage-deflate. Client trong extension/ khong yeu cau no.
 *   - Server KHONG BAO GIO gui frame masked (dung chuan: server->client khong mask).
 *   - Payload toi da MAX_PAYLOAD; vuot qua thi dong ket noi voi ma 1009.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 64MB - du cho mot lan tra ve outerHTML cua SERP lon nhat tung gap. */
const MAX_PAYLOAD = 64 * 1024 * 1024;

const OP = {
  CONTINUATION: 0x0,
  TEXT: 0x1,
  BINARY: 0x2,
  CLOSE: 0x8,
  PING: 0x9,
  PONG: 0xa,
};

/**
 * Mot ket noi WebSocket da bat tay xong.
 * Su kien: 'message' (string), 'close', 'error'.
 */
class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.closed = false;
    /** @type {Buffer} du lieu chua du mot frame */
    this._buffer = Buffer.alloc(0);
    /** @type {{opcode:number, chunks:Buffer[]}|null} frame bi chia nho */
    this._fragment = null;

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', (err) => {
      this.emit('error', err);
      this._finish();
    });
    socket.on('close', () => this._finish());
  }

  _finish() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _onData(chunk) {
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
    // Mot goi TCP co the chua nhieu frame, hoac mot frame trai qua nhieu goi.
    for (;;) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handleFrame(frame);
      if (this.closed) break;
    }
  }

  /** Doc mot frame tu buffer, tra ve null neu chua du byte. */
  _readFrame() {
    const buf = this._buffer;
    if (buf.length < 2) return null;

    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let length = buf[1] & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (buf.length < offset + 2) return null;
      length = buf.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_PAYLOAD)) {
        this.close(1009, 'payload qua lon');
        return null;
      }
      length = Number(big);
      offset += 8;
    }

    if (length > MAX_PAYLOAD) {
      this.close(1009, 'payload qua lon');
      return null;
    }

    // RFC6455: client BAT BUOC phai mask. Frame khong mask tu client la sai giao thuc.
    if (!masked) {
      this.close(1002, 'client phai mask frame');
      return null;
    }

    if (buf.length < offset + 4 + length) return null;
    const mask = buf.subarray(offset, offset + 4);
    offset += 4;

    const payload = Buffer.allocUnsafe(length);
    const raw = buf.subarray(offset, offset + length);
    for (let i = 0; i < length; i += 1) payload[i] = raw[i] ^ mask[i & 3];
    offset += length;

    this._buffer = buf.subarray(offset);
    return { fin, opcode, payload };
  }

  _handleFrame(frame) {
    const { fin, opcode, payload } = frame;

    if (opcode === OP.PING) {
      this._send(OP.PONG, payload);
      return;
    }
    if (opcode === OP.PONG) return;
    if (opcode === OP.CLOSE) {
      this.close(1000, '');
      return;
    }

    if (opcode === OP.CONTINUATION) {
      if (!this._fragment) return;
      this._fragment.chunks.push(payload);
      if (fin) {
        const full = Buffer.concat(this._fragment.chunks);
        const isText = this._fragment.opcode === OP.TEXT;
        this._fragment = null;
        if (isText) this.emit('message', full.toString('utf8'));
      }
      return;
    }

    if (opcode === OP.TEXT || opcode === OP.BINARY) {
      if (!fin) {
        this._fragment = { opcode, chunks: [payload] };
        return;
      }
      if (opcode === OP.TEXT) this.emit('message', payload.toString('utf8'));
    }
  }

  /** Gui frame khong mask (dung chuan cho chieu server -> client). */
  _send(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const length = payload.length;
    let header;
    if (length < 126) {
      header = Buffer.allocUnsafe(2);
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.allocUnsafe(4);
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.allocUnsafe(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch (err) {
      this.emit('error', err);
    }
  }

  /** @param {string} text */
  send(text) {
    this._send(OP.TEXT, Buffer.from(text, 'utf8'));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this._send(OP.CLOSE, payload);
    this.closed = true;
    this.socket.end();
    this.emit('close');
  }
}

/**
 * Mo server WebSocket tren 127.0.0.1.
 *
 * Chi bind loopback: khong bao gio nhan ket noi tu may khac trong mang LAN.
 *
 * @param {{port:number, token:string, onConnection:(conn:WsConnection)=>void, logger?:object}} opts
 * @returns {Promise<{port:number, close:()=>Promise<void>, server:http.Server}>}
 */
export function startWsServer(opts) {
  const server = http.createServer((req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('Chi chap nhan ket noi WebSocket.\n');
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    // Token dung mot lan cho moi run: extension khac (hoac trang web bat ky) khong
    // the dieu khien trinh duyet qua cong nay. Trang web thuong khong doc duoc token
    // vi no chi nam trong file cuc bo va trong extension da cai.
    if (!key || url.searchParams.get('token') !== opts.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '', '',
    ].join('\r\n'));

    socket.setNoDelay(true);
    opts.onConnection(new WsConnection(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      const actual = server.address().port;
      opts.logger?.debug(`WebSocket bridge dang nghe tren 127.0.0.1:${actual}`);
      resolve({
        port: actual,
        server,
        close: () => new Promise((done) => { server.close(() => done()); }),
      });
    });
  });
}

export const _internals = { WsConnection, MAX_PAYLOAD, OP };
