import test from 'node:test';
import assert from 'node:assert/strict';
import { createMachine } from '../../src/core/state-machine.mjs';
import { AppError } from '../../src/core/errors.mjs';

test('state machine: chay het cac state va giu lich su', async () => {
  const machine = createMachine({
    id: 'demo',
    initial: 'A',
    states: {
      A: { run: async () => 'B' },
      B: { run: async () => ({ to: 'C', value: 42 }) },
      C: { final: true, run: async () => 'C' },
    },
  });
  const ctx = await machine.run();
  assert.equal(ctx.value, 42);
  assert.equal(ctx.finalState, 'C');
  assert.deepEqual(machine.history, ['A', 'B', 'C']);
});

test('state machine: patch context giua cac state', async () => {
  const machine = createMachine({
    id: 'demo',
    initial: 'A',
    context: { count: 0 },
    states: {
      A: { run: async (ctx) => ({ to: 'B', count: ctx.count + 1 }) },
      B: { run: async (ctx) => (ctx.count < 3 ? { to: 'A', count: ctx.count + 1 } : 'End') },
      End: { final: true, run: async () => 'End' },
    },
  });
  const ctx = await machine.run();
  assert.equal(ctx.count, 3);
});

test('state machine: state khong ton tai thi nem AppError', async () => {
  const machine = createMachine({
    id: 'demo', initial: 'A',
    states: { A: { run: async () => 'KhongCo' } },
  });
  await assert.rejects(() => machine.run(), AppError);
});

test('state machine: chan vong lap vo han', async () => {
  const machine = createMachine({
    id: 'loop', initial: 'A', maxTransitions: 5,
    states: { A: { run: async () => 'A' } },
  });
  await assert.rejects(() => machine.run(), /vuot qua 5 lan/);
});

test('state machine: initial khong hop le thi nem ngay', () => {
  assert.throws(() => createMachine({ id: 'x', initial: 'Z', states: { A: { run: async () => 'A' } } }), AppError);
});
