import test from 'node:test';
import assert from 'node:assert/strict';

import { RemotePage } from '../../src/engine/remote-page.mjs';

function makePage(initiallyActive) {
  let active = initiallyActive;
  const calls = [];
  const sent = [];
  const context = {
    _markVisible() {},
    _forget() {},
  };
  const bridge = {
    async call(method, payload) {
      calls.push({ method, payload });
      if (method === 'activateTab') active = true;
    },
  };
  const session = {
    async evaluate() {
      return active
        ? { visibility: 'visible', focused: true }
        : { visibility: 'hidden', focused: false };
    },
    async send(method, payload) {
      sent.push({ method, payload });
    },
  };
  const page = new RemotePage({ context, bridge, tabId: 42 });
  page._session = async () => session;
  return { page, calls, sent };
}

test('_ensureVisible khong tin cache khi nguoi dung da chuyen sang tab khac', async () => {
  const { page, calls } = makePage(false);
  page._visible = true; // Cache cu: extension khong nhan duoc lan chuyen tab bang tay.

  await page._ensureVisible();

  assert.deepEqual(calls, [{ method: 'activateTab', payload: { tabId: 42 } }]);
});

test('_ensureVisible khong activate lai tab neu trang dang visible va co focus', async () => {
  const { page, calls } = makePage(true);

  await page._ensureVisible();

  assert.equal(calls.length, 0);
});

test('page.keyboard.press tu kich hoat tab nen truoc khi gui trusted key', async () => {
  const { page, calls, sent } = makePage(false);
  page._visible = true;

  await page.keyboard.press('Enter');

  assert.equal(calls[0]?.method, 'activateTab');
  assert.deepEqual(sent.map((item) => item.payload.type), ['keyDown', 'keyUp']);
});
