/**
 * AI Overview / AI Mode adapter - trien khai dung state machine o Step 2 cua dac ta.
 *
 *   SearchLoaded --> OverviewFound --> Expanded --> PromptBox --> Submitted
 *                 --> AIModeTab ---------------------^
 *                 --> Missing ------------------------------------> Captured
 *
 * Nguyen tac: khong bao gio "bia" noi dung. Khong lay duoc AI answer thi ghi
 * canh banh ro rang trong section va danh dau run la COMPLETED_WITH_WARNINGS.
 */
import { createMachine } from '../core/state-machine.mjs';
import { firstVisible, anyPresent, describeSpec } from '../browser/locator.mjs';
import { runExtractorOnLocator } from '../browser/page-eval.mjs';
import { domToMarkdown } from '../extractors/dom-to-markdown.mjs';
import { normalizeMarkdownBlock, dedupeKey, toRegExp } from '../core/text.mjs';
import { sleep } from '../core/retry.mjs';
import { WARNING_CODES } from '../core/errors.mjs';

export const AI_MISSING_NOTE =
  '> Khong tim thay AI Overview/AI Mode cho truy van nay.';
export const AI_TIMEOUT_NOTE =
  '> AI Mode khong tra loi xong trong thoi gian cho. Noi dung co the thieu.';
export const AI_UNAVAILABLE_NOTE =
  '> Khong mo duoc AI Mode cho truy van nay (Google khong cung cap hoac yeu cau dang nhap).';

/**
 * @param {{page:object, config:object, selectors:object, logger:object, keyword:string, prompt:string}} args
 * @returns {Promise<{markdown:string, source:string, warnings:string[], chars:number, states:string[]}>}
 */
export async function collectAiAnswer(args) {
  const { page, config, selectors, logger, keyword, prompt } = args;
  const aiCfg = config.ai ?? {};
  const overviewSel = selectors.ai_overview ?? {};
  const promptSel = selectors.ai_prompt_box ?? {};
  const warnings = [];

  const machine = createMachine({
    id: 'ai-mode',
    initial: 'SearchLoaded',
    logger,
    context: { markdown: '', source: 'none', warnings },
    states: {
      SearchLoaded: {
        async run(ctx) {
          if (aiCfg.open_overview_first !== false) {
            const overview = await firstVisible(page, overviewSel.container, {
              timeout: aiCfg.overview_timeout_ms ?? 15000,
              perSpec: 3000, logger, block: 'ai_overview.container',
            });
            if (overview) {
              logger?.info('Tim thay khoi AI Overview.');
              return { to: 'OverviewFound', overview: overview.locator };
            }
          }
          logger?.warn('Khong thay AI Overview tren SERP.', { code: WARNING_CODES.AI_OVERVIEW_NOT_FOUND });
          ctx.warnings.push(WARNING_CODES.AI_OVERVIEW_NOT_FOUND);

          const entry = await firstVisible(page, overviewSel.ai_mode_entry, {
            perSpec: 2000, logger, block: 'ai_overview.ai_mode_entry',
          });
          if (entry) return { to: 'AIModeTab', entry: entry.locator };
          if (aiCfg.direct_ai_mode_fallback !== false) return 'AIModeDirect';
          return 'Missing';
        },
      },

      OverviewFound: {
        async run(ctx) {
          const showMore = await firstVisible(ctx.overview, overviewSel.show_more, {
            perSpec: 2000, logger, block: 'ai_overview.show_more',
          });
          if (showMore) {
            await showMore.locator.click({ timeout: 5000 }).catch(() => {});
            logger?.info('Da bam "Show more" trong AI Overview.');
            await sleep(1200);
          }
          return 'Expanded';
        },
      },

      Expanded: {
        async run(ctx) {
          const input = await firstVisible(ctx.overview, promptSel.input, {
            perSpec: 2000, logger, block: 'ai_prompt_box.input',
          });
          if (input) return { to: 'PromptBox', input: input.locator, source: 'google_ai_overview' };

          const pageInput = await firstVisible(page, promptSel.input, { perSpec: 2000 });
          if (pageInput) return { to: 'PromptBox', input: pageInput.locator, source: 'google_ai_overview' };

          logger?.info('AI Overview khong co o nhap prompt, chuyen sang AI Mode.');
          const entry = await firstVisible(page, overviewSel.ai_mode_entry, { perSpec: 2000 });
          if (entry) return { to: 'AIModeTab', entry: entry.locator };
          if (aiCfg.direct_ai_mode_fallback !== false) return 'AIModeDirect';
          return 'Missing';
        },
      },

      AIModeTab: {
        async run(ctx) {
          if (ctx.entry) {
            await ctx.entry.click({ timeout: 8000 }).catch(() => {});
            await page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
            await sleep(1500);
          }
          const input = await firstVisible(page, promptSel.input, {
            timeout: 8000, perSpec: 2500, logger, block: 'ai_prompt_box.input',
          });
          if (input) return { to: 'PromptBox', input: input.locator, source: 'google_ai_mode' };
          if (aiCfg.direct_ai_mode_fallback !== false) return 'AIModeDirect';
          return 'Missing';
        },
      },

      AIModeDirect: {
        async run() {
          const template = overviewSel.direct_url || 'https://www.google.com/search?udm=50&q={{keyword}}&hl=en&gl=us';
          const url = template.replace('{{keyword}}', encodeURIComponent(keyword));
          logger?.info(`Thu mo AI Mode truc tiep: ${url}`);
          try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          } catch (err) {
            logger?.warn(`Khong mo duoc AI Mode truc tiep: ${err.message}`, {
              code: WARNING_CODES.AI_MODE_UNAVAILABLE,
            });
            return 'Missing';
          }
          await sleep(1500);
          const input = await firstVisible(page, promptSel.input, {
            timeout: 10000, perSpec: 2500, logger, block: 'ai_prompt_box.input',
          });
          if (input) return { to: 'PromptBox', input: input.locator, source: 'google_ai_mode_direct' };
          return 'Missing';
        },
      },

      PromptBox: {
        async run(ctx) {
          const before = await countResponseBlocks(page, promptSel);
          logger?.info('Gui prompt vao AI Mode.');
          await ctx.input.click({ timeout: 5000 }).catch(() => {});
          await ctx.input.fill(prompt, { timeout: 10000 });
          await sleep(300);

          const submit = await firstVisible(page, promptSel.submit, { perSpec: 1500 });
          if (submit) {
            await submit.locator.click({ timeout: 5000 }).catch(() => {});
          } else {
            await ctx.input.press('Enter').catch(() => {});
          }
          return { to: 'Submitted', beforeCount: before, submittedAt: Date.now() };
        },
      },

      Submitted: {
        async run(ctx) {
          const result = await waitForStableResponse(page, {
            selectors: promptSel,
            beforeCount: ctx.beforeCount,
            minChars: aiCfg.min_response_chars ?? 40,
            stableMs: aiCfg.stable_ms ?? 2500,
            timeoutMs: aiCfg.response_timeout_ms ?? 120000,
            pollMs: aiCfg.poll_interval_ms ?? 750,
            logger,
          });
          if (!result.locator) {
            logger?.warn('Het thoi gian cho AI Mode tra loi.', { code: WARNING_CODES.AI_RESPONSE_TIMEOUT });
            ctx.warnings.push(WARNING_CODES.AI_RESPONSE_TIMEOUT);
            await logger?.screenshot(page, 'ai-response-timeout');
            return { to: 'Missing', note: AI_TIMEOUT_NOTE };
          }
          return { to: 'ResponseStable', response: result.locator, stable: result.stable };
        },
      },

      ResponseStable: {
        async run(ctx) {
          const markdown = await responseToMarkdown(ctx.response, promptSel, prompt);
          if (!markdown) {
            ctx.warnings.push(WARNING_CODES.AI_RESPONSE_TIMEOUT);
            return { to: 'Missing', note: AI_TIMEOUT_NOTE };
          }
          if (!ctx.stable) ctx.warnings.push(WARNING_CODES.AI_RESPONSE_TIMEOUT);
          return { to: 'Captured', markdown, source: ctx.source ?? 'google_ai_mode' };
        },
      },

      Missing: {
        async run(ctx) {
          const note = ctx.note
            ?? (ctx.warnings.includes(WARNING_CODES.AI_MODE_UNAVAILABLE)
              ? AI_UNAVAILABLE_NOTE
              : AI_MISSING_NOTE);
          if (!ctx.warnings.includes(WARNING_CODES.AI_MODE_UNAVAILABLE)
            && !ctx.warnings.includes(WARNING_CODES.AI_RESPONSE_TIMEOUT)) {
            ctx.warnings.push(WARNING_CODES.AI_OVERVIEW_NOT_FOUND);
          }
          return { to: 'Captured', markdown: note, source: 'none' };
        },
      },

      Captured: { final: true, run: async () => 'Captured' },
    },
  });

  const ctx = await machine.run();
  const markdown = normalizeMarkdownBlock(ctx.markdown || AI_MISSING_NOTE);
  return {
    markdown,
    source: ctx.source ?? 'none',
    warnings: Array.from(new Set(ctx.warnings)),
    chars: markdown.replace(/^>.*$/gm, '').trim().length,
    states: machine.history,
  };
}

/** Dem so block response dang co truoc khi gui prompt. */
async function countResponseBlocks(page, promptSel) {
  let total = 0;
  for (const spec of promptSel.response_container ?? []) {
    if (spec.type !== 'css') continue;
    try { total = Math.max(total, await page.locator(spec.css).count()); } catch { /* bo qua */ }
  }
  return total;
}

/** Locator cua cau tra loi MOI (sinh ra sau prompt). */
async function findResponseLocator(page, promptSel, beforeCount) {
  for (const spec of promptSel.response_container ?? []) {
    if (spec.type !== 'css') continue;
    try {
      const all = page.locator(spec.css);
      const count = await all.count();
      if (count === 0) continue;
      const index = count > beforeCount ? beforeCount : count - 1;
      return { locator: all.nth(index), spec };
    } catch { /* thu spec ke tiep */ }
  }
  return null;
}

/**
 * Cho response bat dau roi cho on dinh (dac ta Step 2 muc 5).
 */
export async function waitForStableResponse(page, opts) {
  const deadline = Date.now() + opts.timeoutMs;
  let lastText = '';
  let lastChange = Date.now();
  let found = null;

  while (Date.now() < deadline) {
    found = await findResponseLocator(page, opts.selectors, opts.beforeCount);
    if (found) {
      let text = '';
      try { text = (await found.locator.innerText({ timeout: 5000 })) ?? ''; } catch { text = ''; }
      if (text !== lastText) {
        lastText = text;
        lastChange = Date.now();
      }
      const generating = await anyPresent(page, opts.selectors.generating_markers);
      const longEnough = lastText.trim().length >= opts.minChars;
      const quiet = Date.now() - lastChange >= opts.stableMs;
      if (longEnough && quiet && !generating) {
        opts.logger?.info(`AI response on dinh (${lastText.trim().length} ky tu).`);
        return { locator: found.locator, stable: true, text: lastText };
      }
    }
    await sleep(opts.pollMs);
  }

  if (found && lastText.trim().length >= opts.minChars) {
    return { locator: found.locator, stable: false, text: lastText };
  }
  return { locator: null, stable: false, text: lastText };
}

/** DOM response -> Markdown, bo prompt echo, follow-up chips va khoi UI Share/Export. */
async function responseToMarkdown(locator, promptSel, prompt) {
  const markdown = await runExtractorOnLocator(locator, domToMarkdown, {
    excludeSelectors: promptSel.exclude_in_response ?? [],
    headingBase: 3,
    keepLinks: true,
  });
  if (!markdown) return '';
  const cleaned = normalizeMarkdownBlock(markdown);
  const lines = cleaned.split('\n');
  while (lines.length && dedupeKey(lines[0]) === dedupeKey(prompt)) lines.shift();
  return trimTrailingUi(lines.join('\n'), promptSel.response_stop_markers ?? []);
}

/**
 * Cat cau tra loi tai moc UI dau tien (Share public link, Export, danh sach mang xa hoi),
 * roi bo not dong "moi chao" cut o cuoi.
 * Xuat khau de test rieng duoc.
 * @param {string} markdown
 * @param {string[]} stopMarkers
 */
export function trimTrailingUi(markdown, stopMarkers) {
  const markers = (stopMarkers ?? []).map(toRegExp).filter(Boolean);
  const lines = String(markdown ?? '').split('\n');

  let cut = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    if (markers.some((re) => re.test(line))) { cut = i; break; }
  }
  const kept = lines.slice(0, cut);

  // Bo dong cuoi kieu "If you'd like, I can:" khong con noi dung theo sau
  while (kept.length) {
    const last = kept[kept.length - 1].trim();
    if (!last || /[:：]$/.test(last)) kept.pop();
    else break;
  }
  return kept.join('\n').trim();
}

export const _internals = { findResponseLocator, countResponseBlocks, describeSpec };
