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

import { clipboardMatchesResponse, _internals } from '../../src/adapters/ai-mode.mjs';

const { sendPrompt, verifySubmitted, findResponseLocator } = _internals;

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

test('chi chon cay response thu hai duoc tao sau khi gui prompt', async () => {
  const nodes = [{ id: 'answer-dau-tien' }, { id: 'answer-sau-prompt' }];
  const page = {
    locator(css) {
      assert.equal(css, '[data-rp-response]');
      return {
        async count() { return nodes.length; },
        nth(index) { return nodes[index]; },
      };
    },
  };

  const second = await findResponseLocator(page, PROMPT_SEL, 1);
  assert.equal(second.locator.id, 'answer-sau-prompt');
});

test('khong fallback ve cau tra loi dau tien khi prompt chua tao response moi', async () => {
  const page = {
    locator() {
      return {
        async count() { return 1; },
        nth() { throw new Error('khong duoc chon response cu'); },
      };
    },
  };

  assert.equal(await findResponseLocator(page, PROMPT_SEL, 1), null);
});

test('hoi quy Paniolo: clipboard PAA khong khop response AI moi thi bi tu choi', () => {
  const paaClipboard = [
    'What does paniolo mean?',
    'What does paniolo mean in Spanish?',
    'Who owns Paniolos Hawaii?',
    'What do Hawaiians call cowboys?',
  ].join('\n');
  const aiResponse = [
    'Paniolo refers to Hawaiian cowboys, a tradition that began in the nineteenth century.',
    'Mexican vaqueros taught Native Hawaiians cattle-handling and riding skills.',
    'Today paniolo culture remains an important part of Hawaiian history and identity.',
  ].join(' ');

  assert.equal(clipboardMatchesResponse(paaClipboard, aiResponse), false);
});

test('clipboard Markdown cua dung response duoc chap nhan du khac formatting DOM', () => {
  const copied = '### Paniolo history\n\nPaniolo are **Hawaiian cowboys** trained by Mexican vaqueros.';
  const response = 'Paniolo history Paniolo are Hawaiian cowboys trained by Mexican vaqueros.';
  assert.equal(clipboardMatchesResponse(copied, response), true);
});

test('khong co response DOM thi van cho phep duong clipboard-only', () => {
  assert.equal(clipboardMatchesResponse('A sufficiently long copied answer.', ''), true);
});

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

test('Enter bi mat khi tab nen -> kich hoat/dien lai va retry Enter, khong can nut Send', async () => {
  let value = 'prompt test';
  let loading = 0;
  let presses = 0;
  const input = {
    async click() {},
    async fill(next) { value = next; },
    async inputValue() { return value; },
    async press(key) {
      assert.equal(key, 'Enter');
      presses += 1;
      if (presses === 2) {
        value = '';
        loading = 1;
      }
    },
  };
  const page = fakePage({
    '[aria-busy="true"]': 0,
    '[data-rp-response]': 0,
    'button[aria-label="Copy text"]': 0,
  });
  const aiScope = {
    locator(css) {
      return { async count() { return css === '[aria-busy="true"]' ? loading : 0; } };
    },
  };

  const result = await sendPrompt({
    page,
    input,
    promptSel: { ...PROMPT_SEL, submit: [], control_exclude: [], container_up: [1] },
    baseline: { copy: [0], response: 0, loading: 0, url: 'https://www.google.com/search?q=x' },
    aiScope,
    prompt: 'prompt test',
    aiCfg: {
      submit_confirm_ms: 500,
      submit_grace_ms: 80,
      submit_no_progress_ms: 120,
      submit_retries: 1,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.via, 'retry@Enter');
  assert.equal(result.signal, 'loading@ai');
  assert.equal(presses, 2);
  assert.deepEqual(result.attempts.map((attempt) => attempt.reason), ['NO_SIGNAL', null]);
});
