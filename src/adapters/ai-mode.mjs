/**
 * AI Overview adapter - thao tac tren dung trang SERP dang mo.
 *
 *   SearchLoaded -> OverviewFound -> Expanded -> PromptBox -> Submitted
 *                -> Missing                         -> CopyReady -> Captured
 *
 * Nguyen tac: khong bao gio "bia" noi dung. Khong lay duoc AI answer thi ghi
 * canh banh ro rang trong section va danh dau run la COMPLETED_WITH_WARNINGS.
 */
import { createMachine } from '../core/state-machine.mjs';
import { firstVisible, anyPresent, describeSpec } from '../browser/locator.mjs';
import { normalizeMarkdownBlock, toRegExp } from '../core/text.mjs';
import { sleep } from '../core/retry.mjs';
import { WARNING_CODES } from '../core/errors.mjs';
import { NO_LOCK } from '../core/mutex.mjs';

export const AI_MISSING_NOTE =
  '> Khong tim thay AI Overview/AI Mode cho truy van nay.';
export const AI_TIMEOUT_NOTE =
  '> AI Overview khong tra loi xong trong thoi gian cho.';
export const AI_UNAVAILABLE_NOTE =
  '> Khong thao tac duoc AI Overview tren trang SERP nay.';

/**
 * @param {{page:object, config:object, selectors:object, logger:object, keyword:string, prompt:string, lock?:object}} args
 * @returns {Promise<{markdown:string, source:string, warnings:string[], chars:number, states:string[]}>}
 */
export async function collectAiAnswer(args) {
  const { page, config, selectors, logger, prompt } = args;
  const lock = args.lock ?? NO_LOCK;
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
            timeout: 8000, perSpec: 2000, logger, block: 'ai_prompt_box.input',
          });
          if (input) return { to: 'PromptBox', input: input.locator, source: 'google_ai_overview' };

          // Google co the render hop prompt ngoai node container ma selector
          // AI Overview da bat duoc, nen thu lai tren toan trang SERP.
          const pageInput = await firstVisible(page, promptSel.input, {
            timeout: 8000, perSpec: 2000, logger, block: 'ai_prompt_box.input',
          });
          if (pageInput) return { to: 'PromptBox', input: pageInput.locator, source: 'google_ai_overview' };

          await logger?.screenshot(page, 'ai-overview-khong-co-o-nhap-prompt');
          logger?.warn('Da bam Show more nhung khong tim thay o nhap prompt tren SERP.', {
            code: WARNING_CODES.AI_MODE_UNAVAILABLE,
          });
          ctx.warnings.push(WARNING_CODES.AI_MODE_UNAVAILABLE);
          return 'Missing';
        },
      },

      PromptBox: {
        async run(ctx) {
          const submitted = await lock.run(async () => {
            logger?.info('Dan prompt vao AI Overview tren trang SERP.');
            await ctx.input.click({ timeout: 5000 });
            await ctx.input.fill(prompt, { timeout: 10000 });
            await sleep(400);

            const load = await firstVisible(page, promptSel.submit, {
              timeout: 8000, perSpec: 1600, logger, block: 'ai_prompt_box.submit',
            });
            if (!load) return false;
            await load.locator.click({ timeout: 5000 });
            logger?.info('Da bam "Load" de gui prompt.');
            return true;
          });

          if (!submitted) {
            logger?.warn('Khong tim thay nut "Load" sau khi dan prompt.', {
              code: WARNING_CODES.AI_MODE_UNAVAILABLE,
            });
            ctx.warnings.push(WARNING_CODES.AI_MODE_UNAVAILABLE);
            return 'Missing';
          }
          return 'Submitted';
        },
      },

      Submitted: {
        async run(ctx) {
          const copy = await waitForCopyButton(page, promptSel, {
            timeoutMs: aiCfg.response_timeout_ms ?? 120000,
            pollMs: aiCfg.poll_interval_ms ?? 750,
          });
          if (!copy) {
            logger?.warn('Het thoi gian cho nut "Copy" cua AI Overview.', {
              code: WARNING_CODES.AI_RESPONSE_TIMEOUT,
            });
            ctx.warnings.push(WARNING_CODES.AI_RESPONSE_TIMEOUT);
            await logger?.screenshot(page, 'ai-overview-copy-timeout');
            return { to: 'Missing', note: AI_TIMEOUT_NOTE };
          }
          return { to: 'CopyReady', copy: copy.locator };
        },
      },

      CopyReady: {
        async run(ctx) {
          const copied = await lock.run(async () => {
            await ctx.copy.click({ timeout: 5000 });
            logger?.info('Da bam "Copy" cua AI Overview.');
            await sleep(600);
            return readClipboardText(page);
          });
          const markdown = normalizeMarkdownBlock(copied);
          if (!markdown || normalizeMarkdownBlock(markdown) === normalizeMarkdownBlock(prompt)) {
            logger?.warn('Nut Copy khong dua cau tra loi hop le vao clipboard.', {
              code: WARNING_CODES.AI_RESPONSE_TIMEOUT,
            });
            ctx.warnings.push(WARNING_CODES.AI_RESPONSE_TIMEOUT);
            return { to: 'Missing', note: AI_TIMEOUT_NOTE };
          }
          logger?.info(`Da doc ${markdown.length} ky tu AI Overview tu clipboard.`);
          return { to: 'Captured', markdown, source: 'google_ai_overview_clipboard' };
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

/** URL that su cua tab, doc lai tu trang neu engine ho tro. */
async function currentUrl(page) {
  if (typeof page.syncUrl === 'function') {
    const url = await page.syncUrl().catch(() => null);
    if (url) return url;
  }
  return page.url();
}

/**
 * Tim o nhap prompt cua AI Mode.
 *
 * Thu trong document cua tab truoc. Neu khong thay, thu bam sang target con:
 * mot so ban Chrome khong tai AI Mode trong tab ma nhet trang google that vao
 * mot <webview> ben trong chrome://contextual-tasks/. Khi do document cua tab
 * KHONG chua o nhap prompt du man hinh hien day du - xem ghi chu
 * ai_overview.embedded_shell_url trong config/selectors.yaml.
 */
async function findPromptBox(page, { promptSel, overviewSel, logger, timeout }) {
  const input = await firstVisible(page, promptSel.input, {
    timeout, perSpec: 2500, logger, block: 'ai_prompt_box.input',
  });
  if (input) return input;

  if (!(await adoptAiSurface(page, overviewSel, logger))) return null;

  return firstVisible(page, promptSel.input, {
    timeout, perSpec: 2500, logger, block: 'ai_prompt_box.input',
  });
}

/**
 * Bam vao target con dang chua trang AI Mode that.
 * @returns {Promise<boolean>} false neu engine khong ho tro hoac khong tim thay
 */
async function adoptAiSurface(page, overviewSel, logger) {
  // Engine playwright khong co kha nang nay (Playwright khong expose target
  // kieu webview thanh page). O do khong thay prompt box la khong thay that.
  if (typeof page.adoptEmbeddedTarget !== 'function') return false;

  const url = await currentUrl(page);
  const shell = toRegExp(overviewSel.embedded_shell_url);
  const inShell = shell ? shell.test(String(url)) : false;
  logger?.info(
    `Khong thay o nhap prompt trong tab (URL: ${url}`
    + `${inShell ? ' - day la vo giao dien noi bo cua Chrome' : ''}). `
    + 'Dang tim trang AI Mode trong target con...',
  );

  const match = toRegExp(overviewSel.embedded_target_url)
    ?? /^https?:\/\/([a-z0-9-]+\.)*google\.[a-z.]+\/search/i;
  const picked = await page.adoptEmbeddedTarget({ match, timeoutMs: 8000 });
  if (!picked) {
    logger?.debug('Khong co target con nao khop trang AI Mode.');
    return false;
  }
  return true;
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

export const _internals = { findResponseLocator, countResponseBlocks, describeSpec, findPromptBox, adoptAiSurface };
