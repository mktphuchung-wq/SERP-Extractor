import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { BridgeServer } from '../../src/bridge/bridge-server.mjs';

let nextConnectionId = 1;

class FakeConnection extends EventEmitter {
  constructor({ autoRespond = true, delayedClose = false } = {}) {
    super();
    this.autoRespond = autoRespond;
    this.delayedClose = delayedClose;
    this.connectionId = nextConnectionId;
    nextConnectionId += 1;
    this.closed = false;
    this.sent = [];
    this.closeInfo = null;
  }

  send(text) {
    const msg = JSON.parse(text);
    this.sent.push(msg);
    if (!this.autoRespond) return;
    queueMicrotask(() => {
      this.emit('message', JSON.stringify({
        id: msg.id,
        ok: true,
        result: { method: msg.method, connectionId: this.connectionId },
      }));
    });
  }

  close(code = 1000, reason = '') {
    this.closed = true;
    this.closeInfo = { code, reason, source: 'test' };
    if (!this.delayedClose) this.emit('close', this.closeInfo);
  }

  finishClose() {
    this.emit('close', this.closeInfo ?? { code: 1006, reason: 'test', source: 'test' });
  }
}

function hello(conn) {
  conn.emit('message', JSON.stringify({
    event: 'hello',
    params: { name: 'Fake Bridge', version: '2.0.1', chromeVersion: '151.0.0.0' },
  }));
}

test('call phan biet chua tung ket noi voi disconnect giua run', async () => {
  const warnings = [];
  const bridge = new BridgeServer({
    reconnectTimeout: 20,
    logger: {
      debug: () => {},
      info: () => {},
      warn: (message, data) => warnings.push({ message, data }),
    },
  });
  await assert.rejects(
    bridge.call('browserInfo'),
    (err) => err.code === 'BRIDGE_NOT_CONNECTED',
  );

  const first = new FakeConnection();
  bridge._adopt(first);
  hello(first);
  first.close(1006, 'mat mang');
  assert.match(warnings[0].message, /WebSocket 1006: mat mang/);
  assert.equal(warnings[0].data.source, 'test');

  await assert.rejects(
    bridge.call('browserInfo'),
    (err) => err.code === 'BRIDGE_DISCONNECTED' && /khong tu noi lai/.test(err.message),
  );
});

test('call doi extension ket noi lai roi gui RPC tren socket moi', async () => {
  const bridge = new BridgeServer({ reconnectTimeout: 500 });
  const first = new FakeConnection();
  bridge._adopt(first);
  hello(first);
  first.close(1012, 'service restart');

  const resultPromise = bridge.call('browserInfo');
  const second = new FakeConnection();
  setTimeout(() => {
    bridge._adopt(second);
    hello(second);
  }, 20);

  const result = await resultPromise;
  assert.equal(result.method, 'browserInfo');
  assert.equal(result.connectionId, second.connectionId);
  assert.equal(second.sent.length, 1);
});

test('RPC dang cho bi reject ngay khi socket rot', async () => {
  const bridge = new BridgeServer({ reconnectTimeout: 100 });
  const conn = new FakeConnection({ autoRespond: false });
  bridge._adopt(conn);
  hello(conn);

  const pending = bridge.call('cdp', {}, { timeout: 5000 });
  conn.close(1006, 'mat ket noi');
  await assert.rejects(pending, (err) => err.code === 'BRIDGE_DISCONNECTED');
  assert.equal(bridge._pending.size, 0);
});

test('close event tre cua socket cu khong lam mat socket moi', async () => {
  const bridge = new BridgeServer();
  const first = new FakeConnection({ delayedClose: true });
  bridge._adopt(first);
  hello(first);

  const second = new FakeConnection();
  bridge._adopt(second);
  hello(second);
  first.finishClose();

  assert.equal(bridge.conn, second);
  assert.equal(bridge.connected, true);
  const result = await bridge.call('browserInfo');
  assert.equal(result.connectionId, second.connectionId);
});
