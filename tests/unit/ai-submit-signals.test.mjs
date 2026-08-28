/**
 * Xac nhan "prompt da duoc gui" (dac ta Fast Path v1 - P0 muc 2-4).
 *
 * Boi canh loi that (run 20260827-171404):
 *   log ghi `Enter -> generating` roi cho DUNG 120 giay va timeout. Cai duoc coi
 *   la "generating" chi la mot `[aria-busy=true]` o KHOI KHAC tren trang; DOM
 *   cuoi run khong he co response container, nut Copy hay loading marker nao
 *   trong khoi AI.
 *
 * Test o day chay khong can trinh duyet: no kiem chinh phan RA QUYET DINH -
 * tin hieu nao du de ket luan da gui, tin hieu nao thi khong.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { _internals } from '../../src/adapters/ai-mode.mjs';

const { verifySubmitted } = _internals;

const PROMPT_SEL = {
  copy_button: [{ type: 'css', css: 'button[aria-label="Copy text"]' }],
  response_container: [{ type: 'css', css: '[data-rp-response]' }],
  generating_markers: [{ type: 'css', css: '[aria-busy="true"]' }],
};

/** Scope gia: tra ve so phan tu khop tung selector theo `counts`. */
function fakeScope(counts) {
  return {
    locator(css) {
      return { async count() { return counts[css] ?? 0; } };
    },
  };
}

/** Page gia: co them evaluate (dau moc reload) va url. */
function fakePage(counts, opts = {}) {
  const scope = fakeScope(counts);
  return {
    ...scope,
    async evaluate() { return opts.reloaded ? false : true; },
    url: () => opts.url ?? 'https://www.google.com/search?q=x',
    async syncUrl() { return opts.url ?? 'https://www.google.com/search?q=x'; },
  };
}

const BASELINE = { copy: [0], response: 0, loading: 1, url: 'https://www.google.com/search?q=x' };
const clearedInput = { async inputValue() { return ''; } };
const filledInput = { async inputValue() { return 'prompt van con day'; } };

test('marker aria-busy NGOAI khoi AI + o nhap trong = CHUA du de ket luan da gui', async () => {
  // Toan trang co 3 marker busy (thanh Ahrefs, carousel...), nhung trong khoi AI
  // thi so marker khong doi so voi baseline.
  const page = fakePage({ '[aria-busy="true"]': 3, '[data-rp-response]': 0, 'button[aria-label="Copy text"]': 0 });
  const aiScope = fakeScope({ '[aria-busy="true"]': 1 });

  const result = await verifySubmitted({
    page, input: clearedInput, promptSel: PROMPT_SEL, baseline: BASELINE, aiScope,
    via: 'Enter', timeoutMs: 1200, noProgressMs: 400, pollMs: 50,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_PROGRESS', 'o nhap trong ma khong tien trien -> NO_PROGRESS');
});

test('loading marker MOI trong khoi AI thi moi duoc coi la da gui', async () => {
  const page = fakePage({ '[aria-busy="true"]': 3, '[data-rp-response]': 0, 'button[aria-label="Copy text"]': 0 });
  const aiScope = fakeScope({ '[aria-busy="true"]': 2 });

  const result = await verifySubmitted({
    page, input: clearedInput, promptSel: PROMPT_SEL, baseline: BASELINE, aiScope,
    via: 'Enter', timeoutMs: 1200, noProgressMs: 400, pollMs: 50,
  });

  assert.equal(result.ok, true);
  assert.equal(result.signal, 'loading@ai');
});

test('so response tang -> da gui', async () => {
  const page = fakePage({ '[data-rp-response]': 1, '[aria-busy="true"]': 0, 'button[aria-label="Copy text"]': 0 });
  const result = await verifySubmitted({
    page, input: filledInput, promptSel: PROMPT_SEL, baseline: BASELINE, aiScope: fakeScope({}),
    via: 'submit@up3', timeoutMs: 1200, noProgressMs: 400, pollMs: 50,
  });
  assert.equal(result.ok, true);
  assert.equal(result.signal, 'response');
});

test('so nut Copy tang -> da gui', async () => {
  const page = fakePage({ 'button[aria-label="Copy text"]': 1, '[data-rp-response]': 0, '[aria-busy="true"]': 0 });
  const result = await verifySubmitted({
    page, input: filledInput, promptSel: PROMPT_SEL, baseline: BASELINE, aiScope: fakeScope({}),
    via: 'submit@up3', timeoutMs: 1200, noProgressMs: 400, pollMs: 50,
  });
  assert.equal(result.ok, true);
  assert.equal(result.signal, 'copy');
});

test('URL VON DA chua udm=50 tu truoc khong duoc tinh la tin hieu', async () => {
  const url = 'https://www.google.com/search?udm=50&q=x';
  const page = fakePage(
    { '[aria-busy="true"]': 0, '[data-rp-response]': 0, 'button[aria-label="Copy text"]': 0 },
    { url },
  );
  const result = await verifySubmitted({
    page,
    input: clearedInput,
    promptSel: PROMPT_SEL,
    // Baseline da o dung URL do -> khong co transition nao ca.
    baseline: { ...BASELINE, url },
    aiScope: fakeScope({}),
    via: 'Enter',
    timeoutMs: 1200,
    noProgressMs: 400,
    pollMs: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_PROGRESS');
});

test('URL DOI sang dang AI Mode moi la tin hieu', async () => {
  const page = fakePage(
    { '[aria-busy="true"]': 0, '[data-rp-response]': 0, 'button[aria-label="Copy text"]': 0 },
    { url: 'https://www.google.com/search?udm=50&q=x' },
  );
  const result = await verifySubmitted({
    page, input: clearedInput, promptSel: PROMPT_SEL, baseline: BASELINE, aiScope: fakeScope({}),
    via: 'Enter', timeoutMs: 1200, noProgressMs: 400, pollMs: 50,
  });
  assert.equal(result.ok, true);
  assert.equal(result.signal, 'url');
});

test('prompt van nam nguyen trong o nhap -> NO_SIGNAL de thu cach gui khac', async () => {
  const page = fakePage({ '[aria-busy="true"]': 0, '[data-rp-response]': 0, 'button[aria-label="Copy text"]': 0 });
  const result = await verifySubmitted({
    page, input: filledInput, promptSel: PROMPT_SEL, baseline: BASELINE, aiScope: fakeScope({}),
    via: 'Enter', timeoutMs: 3000, graceMs: 200, noProgressMs: 400, pollMs: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NO_SIGNAL');
});

test('trang bi tai lai (bam nham nut Search) -> RELOADED', async () => {
  const page = fakePage(
    { '[aria-busy="true"]': 0, '[data-rp-response]': 0, 'button[aria-label="Copy text"]': 0 },
    { reloaded: true },
  );
  const result = await verifySubmitted({
    page, input: clearedInput, promptSel: PROMPT_SEL, baseline: BASELINE, aiScope: fakeScope({}),
    via: 'submit@page', timeoutMs: 1200, noProgressMs: 400, pollMs: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'RELOADED');
});

test('NO_PROGRESS phai tra ve trong khoang no_progress, khong doi het timeout', async () => {
  const page = fakePage({ '[aria-busy="true"]': 5, '[data-rp-response]': 0, 'button[aria-label="Copy text"]': 0 });
  const startedAt = Date.now();
  const result = await verifySubmitted({
    page, input: clearedInput, promptSel: PROMPT_SEL, baseline: BASELINE,
    aiScope: fakeScope({ '[aria-busy="true"]': 1 }),
    via: 'Enter', timeoutMs: 30000, noProgressMs: 300, pollMs: 50,
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.reason, 'NO_PROGRESS');
  assert.ok(elapsed < 3000, `phai bo som, dang mat ${elapsed}ms`);
});
