import test from 'node:test';
import assert from 'node:assert/strict';
import { Mutex, NO_LOCK } from '../../src/core/mutex.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('mutex: cac vung duoc bao ve khong chay chong len nhau', async () => {
  const lock = new Mutex('test');
  const events = [];

  async function critical(name, ms) {
    return lock.run(async () => {
      events.push(`${name}:start`);
      await sleep(ms);
      events.push(`${name}:end`);
    });
  }

  await Promise.all([critical('A', 40), critical('B', 10), critical('C', 5)]);

  // Moi cap start/end phai lien tiep nhau -> khong bi xen ke
  for (let i = 0; i < events.length; i += 2) {
    const [nameStart, kindStart] = events[i].split(':');
    const [nameEnd, kindEnd] = events[i + 1].split(':');
    assert.equal(kindStart, 'start');
    assert.equal(kindEnd, 'end');
    assert.equal(nameStart, nameEnd, `"${nameStart}" bi xen ke boi tac vu khac`);
  }
  assert.equal(events.length, 6);
});

test('mutex: giu dung thu tu vao hang doi', async () => {
  const lock = new Mutex('order');
  const order = [];
  await Promise.all(['A', 'B', 'C'].map((name) => lock.run(async () => {
    order.push(name);
    await sleep(5);
  })));
  assert.deepEqual(order, ['A', 'B', 'C']);
});

test('mutex: nha khoa ngay ca khi ham nem loi', async () => {
  const lock = new Mutex('err');
  await assert.rejects(() => lock.run(async () => { throw new Error('boom'); }));
  // Neu khoa khong duoc nha, lenh duoi day se treo va test timeout
  const value = await lock.run(async () => 'van chay duoc');
  assert.equal(value, 'van chay duoc');
  assert.equal(lock.locked, false);
});

test('mutex: chay tuan tu thi NO_LOCK khong lam gi ca', async () => {
  const events = [];
  await Promise.all([
    NO_LOCK.run(async () => { events.push('a:start'); await sleep(20); events.push('a:end'); }),
    NO_LOCK.run(async () => { events.push('b:start'); await sleep(1); events.push('b:end'); }),
  ]);
  // NO_LOCK khong tuan tu hoa -> b ket thuc truoc a
  assert.deepEqual(events, ['a:start', 'b:start', 'b:end', 'a:end']);
});
