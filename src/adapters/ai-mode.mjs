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
import {
  firstVisible, anyPresent, buildLocator, describeSpec,
} from '../browser/locator.mjs';
import { runExtractorOnLocator } from '../browser/page-eval.mjs';
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
export const AI_SUBMIT_FAILED_NOTE =
  '> Da dan prompt nhung khong gui duoc cho AI Overview.';
export const AI_STALE_CLIPBOARD_NOTE =
  '> Nut Copy khong dua duoc cau tra loi moi vao clipboard.';

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
          const opened = await openOverviewPrompt({
            page, overview: ctx.overview, overviewSel, promptSel, lock, logger,
          });
          return {
            to: 'Expanded',
            input: opened?.input ?? null,
            surface: opened?.surface ?? null,
          };
        },
      },

      Expanded: {
        async run(ctx) {
          if (ctx.input) {
            return {
              to: 'PromptBox', input: ctx.input, surface: ctx.surface, source: 'google_ai_overview',
            };
          }
          const input = await firstVisible(ctx.overview, promptSel.input, {
            timeout: 8000, perSpec: 2000, logger, block: 'ai_prompt_box.input',
          });
          if (input) {
            return {
              to: 'PromptBox', input: input.locator, surface: ctx.overview, source: 'google_ai_overview',
            };
          }

          // Google co the render hop prompt ngoai node container ma selector
          // AI Overview da bat duoc, nen thu lai tren toan trang SERP.
          const pageInput = await firstVisible(page, promptSel.input, {
            timeout: 8000, perSpec: 2000, logger, block: 'ai_prompt_box.input',
          });
          if (pageInput) {
            return {
              to: 'PromptBox', input: pageInput.locator, surface: page, source: 'google_ai_overview',
            };
          }

          await saveAiControls(page, logger);
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

            // AI Overview goc da co san mot nut "Copy text". Ghi baseline
            // truoc khi submit de sau do chi nhan nut Copy MOI cua answer,
            // khong copy nham noi dung overview cu.
            const baseline = {
              copy: await countCopyButtons(page, promptSel),
              response: await countResponseBlocks(page, promptSel),
            };
            logger?.debug(`So nut Copy truoc khi gui: ${baseline.copy.join(',')}`);

            const sent = await sendPrompt({ page, input: ctx.input, promptSel, logger, baseline });
            return { baseline, sent };
          });

          if (!submitted.sent.ok) {
            const { reason } = submitted.sent;
            logger?.warn(
              reason === 'RELOADED'
                ? 'Bam nham control lam trang tai lai; prompt da mat.'
                : 'Da dan prompt nhung khong gui di duoc (khong tim thay nut gui hop le).',
              { code: WARNING_CODES.AI_PROMPT_SUBMIT_FAILED, reason },
            );
            ctx.warnings.push(WARNING_CODES.AI_PROMPT_SUBMIT_FAILED);
            await logger?.screenshot(page, 'ai-overview-submit-that-bai');
            return { to: 'Missing', note: AI_SUBMIT_FAILED_NOTE };
          }
          logger?.info(
            `Da xac minh prompt duoc gui (${submitted.sent.via} -> ${submitted.sent.signal}).`,
          );
          return { to: 'Submitted', copyCountsBefore: submitted.baseline.copy };
        },
      },

      Submitted: {
        async run(ctx) {
          const timeoutMs = aiCfg.response_timeout_ms ?? 120000;
          const pollMs = aiCfg.poll_interval_ms ?? 750;
          // Sau khi bam Load, Google thay the toan bo cay DOM cua AI Overview.
          // Locator container cu van ton tai trong object store nhung khong con
          // la ancestor cua response moi, vi vay phai tim Copy tren trang hien
          // tai. Selector Copy text chinh xac giu cho no khong bat nham nut
          // "Copy <prompt>" o phia tren cau tra loi.
          let copy = await waitForCopyButton(page, promptSel, {
            timeoutMs: Math.min(timeoutMs, 15000), pollMs,
            beforeCounts: ctx.copyCountsBefore,
          });

          // Sau khi gui prompt, Google co the chuyen giao dien hoi dap sang
          // target con. Thu bam lai surface do truoc khi cho het timeout con lai.
          if (!copy && await adoptAiSurface(page, overviewSel, logger)) {
            copy = await waitForCopyButton(page, promptSel, {
              timeoutMs: Math.max(1000, timeoutMs - 15000), pollMs,
              beforeCounts: ctx.copyCountsBefore,
            });
          } else if (!copy) {
            copy = await waitForCopyButton(page, promptSel, {
              timeoutMs: Math.max(1000, timeoutMs - 15000), pollMs,
              beforeCounts: ctx.copyCountsBefore,
            });
          }
          if (!copy) {
            await saveAiControls(page, logger, 'ai-overview-after-load-controls');
            logger?.info(`URL sau khi bam Load: ${await currentUrl(page)}`);
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
          const minChars = Math.max(1, aiCfg.min_response_chars ?? 40);
          const copied = await lock.run(async () => {
            // Phai biet clipboard TRUOC khi bam. Buoc Ahrefs ngay truoc do da de
            // lai noi dung trong clipboard; khong so sanh thi noi dung cu di
            // thang vao muc AI Mode ma van trong nhu thanh cong
            // (run that 20260827-152533: 4 cau PAA lot vao "## AI Mode").
            //
            // Uu tien dat SAN mot chuoi danh dau: khi do "clipboard doi" la bang
            // chung chac chan nut Copy da ghi, ke ca luc cau tra loi tinh co
            // trung y het noi dung cu. Khong ghi duoc thi doc lai lam moc so sanh.
            const sentinel = await poisonClipboard(page);
            const before = sentinel ?? (await readClipboardText(page));
            await ctx.copy.click({ timeout: 5000 });
            logger?.info('Da bam "Copy" cua AI Overview.');
            return waitForClipboardChange(page, before, {
              timeoutMs: aiCfg.clipboard_timeout_ms ?? 5000,
              pollMs: aiCfg.clipboard_poll_ms ?? 300,
            });
          });

          if (!copied.changed) {
            logger?.warn(
              'Bam Copy nhung clipboard khong doi - noi dung dang giu la cua buoc truoc, khong dung.',
              { code: WARNING_CODES.AI_COPY_STALE_CLIPBOARD },
            );
            ctx.warnings.push(WARNING_CODES.AI_COPY_STALE_CLIPBOARD);
            return { to: 'Missing', note: AI_STALE_CLIPBOARD_NOTE };
          }

          const markdown = normalizeMarkdownBlock(copied.text);
          const isEchoOfPrompt = normalizeMarkdownBlock(markdown) === normalizeMarkdownBlock(prompt);
          if (!markdown || isEchoOfPrompt || markdown.length < minChars) {
            logger?.warn(
              `Nut Copy khong dua cau tra loi hop le vao clipboard (${markdown.length} ky tu`
              + `${isEchoOfPrompt ? ', trung voi prompt' : ''}).`,
              { code: WARNING_CODES.AI_RESPONSE_TIMEOUT },
            );
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
          // Chi bao "khong tim thay AI Overview" khi that su khong co ly do nao
          // ro rang hon. Cac ma duoi day da noi chinh xac hong o dau roi.
          const explained = [
            WARNING_CODES.AI_MODE_UNAVAILABLE,
            WARNING_CODES.AI_RESPONSE_TIMEOUT,
            WARNING_CODES.AI_PROMPT_SUBMIT_FAILED,
            WARNING_CODES.AI_COPY_STALE_CLIPBOARD,
          ];
          if (!explained.some((code) => ctx.warnings.includes(code))) {
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

/**
 * Bam Show more va CHI coi la thanh cong khi o prompt that su xuat hien.
 * Google thay node trong luc render nen locator co the stale; moi lan deu tim
 * lai va thu toi da 3 lan. Khong nuot loi click roi bao thanh cong gia.
 */
async function openOverviewPrompt({ page, overview, overviewSel, promptSel, lock, logger }) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const showMore = await firstVisible(overview, overviewSel.show_more, {
      timeout: 2000, perSpec: 1500, logger, block: 'ai_overview.show_more',
    });
    if (!showMore) break;

    try {
      await lock.run(() => showMore.locator.click({ timeout: 6000 }));
      logger?.info(`Da click "Show more" lan ${attempt}; dang xac minh o prompt.`);
    } catch (err) {
      logger?.debug(`Click "Show more" lan ${attempt} chua thanh cong: ${err.message}`);
      await sleep(500);
      continue;
    }

    await sleep(900);
    const inOverview = await firstVisible(overview, promptSel.input, {
      timeout: 1500, perSpec: 700,
    });
    if (inOverview) {
      logger?.info('Da mo o prompt trong AI Overview.');
      return { input: inOverview.locator, surface: overview };
    }
    const inPage = await firstVisible(page, promptSel.input, {
      timeout: 1500, perSpec: 700,
    });
    if (inPage) {
      logger?.info('Da mo o prompt tren Page 1.');
      return { input: inPage.locator, surface: page };
    }

    // Fallback ban phim cho control role=button: focus dung node roi Enter.
    try {
      await lock.run(() => showMore.locator.press('Enter', { timeout: 6000 }));
      logger?.info(`Da nhan Enter tren "Show more" lan ${attempt}; dang xac minh o prompt.`);
      await sleep(900);
      const afterEnter = await firstVisible(page, promptSel.input, {
        timeout: 1500, perSpec: 700,
      });
      if (afterEnter) {
        logger?.info('Da mo o prompt tren Page 1 bang phim Enter.');
        return { input: afterEnter.locator, surface: page };
      }
    } catch (err) {
      logger?.debug(`Enter tren "Show more" lan ${attempt} chua thanh cong: ${err.message}`);
    }

    // Phuong an cuoi cho dung control da dinh danh tu DOM that. Mot so ban
    // Google bo qua toa do chuot CDP khi layout dang animation, nhung handler
    // click tren chinh node van mo duoc panel.
    const domState = await page.evaluate(() => {
      const el = document.querySelector("[role='button'][aria-label='Show more AI Overview' i]");
      if (!el) return { found: false, expanded: false };
      el.click();
      return { found: true, expanded: el.getAttribute('aria-expanded') === 'true' };
    }).catch(() => ({ found: false, expanded: false }));
    if (domState.found) {
      logger?.info(`Da kich hoat DOM "Show more" lan ${attempt} (expanded=${domState.expanded}).`);
      await sleep(1200);
      const afterDomClick = await firstVisible(page, promptSel.input, {
        timeout: 2500, perSpec: 900,
      });
      if (afterDomClick) {
        logger?.info('Da mo o prompt tren Page 1 bang DOM fallback.');
        return { input: afterDomClick.locator, surface: page };
      }
    }
  }
  return null;
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
 * Cho nut Copy cua cau tra loi xuat hien sau khi gui prompt.
 *
 * Hai rang buoc, thieu cai nao cung tung ra bug that:
 *   1. So luong phai NHIEU HON baseline -> khong bam lai nut Copy cua overview cu.
 *   2. Ung vien phai khong nam trong khoi UI khac (control_exclude) -> khong bam
 *      nut "Copy" cua thanh Ahrefs Toolbar (run that 20260827-152533).
 */
async function waitForCopyButton(scope, promptSel, opts) {
  const deadline = Date.now() + opts.timeoutMs;
  const beforeCounts = opts.beforeCounts ?? [];
  const exclude = promptSel.control_exclude ?? [];
  while (Date.now() < deadline) {
    for (const [index, spec] of (promptSel.copy_button ?? []).entries()) {
      try {
        const all = buildLocator(scope, spec);
        if (!all) continue;
        const count = await all.count();
        if (count <= (beforeCounts[index] ?? 0)) continue;
        // Nut cua answer moi nam cuoi cay DOM; duyet nguoc de gap no truoc,
        // va bo qua ung vien thuoc ve UI khac thay vi dung han.
        for (let i = count - 1; i >= 0; i -= 1) {
          const candidate = all.nth(i);
          try {
            await candidate.waitFor({ state: 'visible', timeout: Math.min(opts.pollMs, 1000) });
          } catch { continue; }
          // eslint-disable-next-line no-await-in-loop
          if (await isForeignControl(candidate, exclude)) continue;
          return { locator: candidate, spec };
        }
      } catch { /* cau tra loi chua san sang */ }
    }
    await sleep(opts.pollMs);
  }
  return null;
}

/**
 * Phan tu co nam trong mot khoi UI KHONG phai cua AI Overview khong?
 *
 * Ham thuan, chay trong trang. Xuat khau de test rieng bang linkedom.
 * @param {Element} root
 * @param {{selectors:string[]}} options
 */
export function isExcludedControl(root, options) {
  if (!root || typeof root.closest !== 'function') return true;
  const list = (options && options.selectors) || [];
  for (let i = 0; i < list.length; i += 1) {
    try {
      if (root.closest(list[i])) return true;
    } catch (err) {
      // Selector khong hop le voi trinh duyet nay - bo qua, khong lam hong ca vong.
    }
  }
  return false;
}

/**
 * Ban bat dong bo cua isExcludedControl cho mot locator.
 * Khong doc duoc phan tu thi coi nhu KHONG dung duoc: tha bo qua con hon bam
 * nham vao nut cua UI khac.
 */
async function isForeignControl(locator, excludeSelectors) {
  if (!excludeSelectors?.length) return false;
  try {
    const excluded = await runExtractorOnLocator(locator, isExcludedControl, {
      selectors: excludeSelectors,
    });
    return excluded !== false;
  } catch {
    return true;
  }
}

/** Khoanh vung khoi prompt: di len `up` cap cha tinh tu chinh o nhap. */
function promptScope(input, up) {
  const levels = Math.max(1, Number(up) || 1);
  return input.locator(`xpath=${new Array(levels).fill('..').join('/')}`);
}

/** Cac muc "di len bao nhieu cap" se thu, tu hep den rong. */
function scopeLevels(configured) {
  const base = Number(configured) || 5;
  return Array.from(new Set([3, base, 7])).filter((n) => n > 0).sort((a, b) => a - b);
}

/**
 * Nhu firstVisible() nhung duyet MOI phan tu khop spec (khong chi cai dau tien)
 * va loai ung vien thuoc ve UI khac.
 */
async function firstAllowed(scope, specs, opts) {
  const list = Array.isArray(specs) ? specs : [];
  const exclude = opts.exclude ?? [];
  const perSpec = opts.perSpec ?? 1200;
  for (let i = 0; i < list.length; i += 1) {
    const all = buildLocator(scope, list[i]);
    if (!all) continue;
    let count = 0;
    try { count = await all.count(); } catch { continue; }
    for (let j = 0; j < Math.min(count, 12); j += 1) {
      const candidate = all.nth(j);
      try {
        await candidate.waitFor({ state: 'visible', timeout: perSpec });
      } catch { continue; }
      // eslint-disable-next-line no-await-in-loop
      if (await isForeignControl(candidate, exclude)) {
        opts.logger?.debug(`Bo qua ${describeSpec(list[i])}: thuoc ve UI khac (control_exclude).`);
        continue;
      }
      if (i > 0 && opts.logger && opts.block) {
        opts.logger.selectorDrift(opts.block, describeSpec(list[0]), describeSpec(list[i]));
      }
      return { locator: candidate, spec: list[i], index: i };
    }
  }
  return null;
}

/**
 * Gui prompt di, theo dung thu tu thao tac tay:
 *   1. Enter ngay tren o nhap (o "Ask anything" cua Google submit bang Enter).
 *   2. Nut gui TRONG khoi prompt, noi rong dan pham vi tim.
 *   3. Cuoi cung moi quet toan trang - van qua bo loc control_exclude.
 *
 * Moi lan thu deu phai duoc XAC MINH. Truoc day code bam mot nut roi coi nhu
 * xong: no bam trung nut Search cua Google (`button[type='submit']`), trang tai
 * lai, prompt bay mat, va vong cho Copy chay du 120s moi bao timeout
 * (run that 20260827-153106).
 */
async function sendPrompt({ page, input, promptSel, logger, baseline }) {
  const exclude = promptSel.control_exclude ?? [];
  const verify = (via) => verifySubmitted({ page, input, promptSel, logger, baseline, via });

  await stampPage(page);
  try {
    await input.press('Enter', { timeout: 5000 });
    const result = await verify('Enter');
    if (result.ok) return { ok: true, via: 'Enter', signal: result.signal };
    if (result.reason === 'RELOADED') return { ok: false, reason: 'RELOADED', via: 'Enter' };
  } catch (err) {
    logger?.debug(`Nhan Enter tren o prompt khong thanh cong: ${err.message}`);
  }

  for (const up of scopeLevels(promptSel.container_up)) {
    const found = await firstAllowed(promptScope(input, up), promptSel.submit, {
      perSpec: 1200, exclude, logger, block: 'ai_prompt_box.submit',
    });
    if (!found) continue;
    await stampPage(page);
    await found.locator.click({ timeout: 5000 });
    logger?.info(`Da bam nut gui trong khoi prompt (len ${up} cap, ${describeSpec(found.spec)}).`);
    const result = await verify(`submit@up${up}`);
    if (result.ok) return { ok: true, via: `submit@up${up}`, signal: result.signal };
    if (result.reason === 'RELOADED') return { ok: false, reason: 'RELOADED', via: `submit@up${up}` };
  }

  const wide = await firstAllowed(page, promptSel.submit, {
    perSpec: 1200, exclude, logger, block: 'ai_prompt_box.submit',
  });
  if (wide) {
    await stampPage(page);
    await wide.locator.click({ timeout: 5000 });
    logger?.info(`Da bam nut gui tim tren toan trang (${describeSpec(wide.spec)}).`);
    const result = await verify('submit@page');
    if (result.ok) return { ok: true, via: 'submit@page', signal: result.signal };
    if (result.reason === 'RELOADED') return { ok: false, reason: 'RELOADED', via: 'submit@page' };
  }

  // Chua tung co dump nao chup luc o prompt DA co chu - moi dump cu deu chup
  // sau khi trang da doi. Khong co no thi chi con nuoc doan selector.
  await saveAiControls(page, logger, 'ai-prompt-filled-controls');
  return { ok: false, reason: 'NO_SUBMIT_CONTROL' };
}

/**
 * Prompt da that su duoc gui di chua?
 *
 * Tin hieu manh (chac chan da gui): dang generating, co them khoi response,
 * co them nut Copy, hoac URL doi sang dang AI Mode.
 * Tin hieu vua: o nhap trong ma trang KHONG bi tai lai.
 * Rieng "o nhap trong" mot minh thi khong du - trang tai lai cung lam o nhap
 * trong, va do dung la kieu hong cua run 20260827-153106.
 */
async function verifySubmitted(args) {
  const {
    page, input, promptSel, logger, baseline,
  } = args;
  const timeoutMs = args.timeoutMs ?? 8000;
  const pollMs = args.pollMs ?? 400;
  // Moi giao dien hoi dap deu xoa o nhap NGAY khi nhan prompt. Neu qua khoang
  // an han ma chu van con nguyen trong o thi cach gui vua thu khong an - tra
  // ve som de thu cach khac, thay vi dung het timeout.
  const graceMs = args.graceMs ?? 2500;
  const started = Date.now();
  const deadline = started + timeoutMs;

  for (;;) {
    if (!(await pageStampAlive(page))) {
      logger?.debug(`Trang da tai lai sau khi thu gui bang ${args.via}; dau moc window da mat.`);
      return { ok: false, reason: 'RELOADED' };
    }
    if (await anyPresent(page, promptSel.generating_markers)) return { ok: true, signal: 'generating' };
    if (await countResponseBlocks(page, promptSel) > (baseline?.response ?? 0)) {
      return { ok: true, signal: 'response' };
    }
    const copyNow = await countCopyButtons(page, promptSel);
    if (copyNow.some((count, i) => count > (baseline?.copy?.[i] ?? 0))) {
      return { ok: true, signal: 'copy' };
    }
    if (looksLikeAiUrl(await currentUrl(page))) return { ok: true, signal: 'url' };

    const value = await readInputValue(input);
    if (value !== null && value.trim() === '') return { ok: true, signal: 'input-cleared' };
    if (value !== null && Date.now() - started >= graceMs) {
      logger?.debug(`Prompt van con trong o nhap sau ${graceMs}ms; ${args.via} chua gui duoc.`);
      return { ok: false, reason: 'NO_SIGNAL' };
    }

    if (Date.now() >= deadline) return { ok: false, reason: 'NO_SIGNAL' };
    await sleep(pollMs);
  }
}

/** URL da chuyen sang giao dien hoi dap cua Google chua. */
function looksLikeAiUrl(url) {
  return /[?&]udm=50\b/i.test(String(url ?? '')) || /\baimc\b/i.test(String(url ?? ''));
}

/** Doc gia tri o nhap; null nghia la khong doc duoc (khong ket luan gi). */
async function readInputValue(input) {
  if (typeof input?.inputValue !== 'function') return null;
  try {
    return await input.inputValue();
  } catch {
    return null;
  }
}

/** Dat dau moc len window de phat hien trang bi tai lai. */
async function stampPage(page) {
  return page
    .evaluate(() => { window.__serpAiSubmitMark = 1; return true; })
    .catch(() => false);
}

/** Dau moc con khong? Khong doc duoc thi coi nhu con, de khong bao dong gia. */
async function pageStampAlive(page) {
  return page
    .evaluate(() => Boolean(window.__serpAiSubmitMark))
    .catch(() => true);
}

/**
 * Dat mot chuoi danh dau vao clipboard truoc khi bam Copy.
 *
 * Ghi trong page context nen KHONG can them quyen clipboardWrite cho extension
 * bridge. Ghi xong phai DOC LAI bang chinh duong doc se dung ve sau: neu doc ra
 * khong phai chuoi vua ghi thi hai dau ghi/doc khong cung mot clipboard, luc do
 * sentinel vo nghia va ta quay ve cach so sanh voi noi dung doc duoc truoc do.
 * @returns {Promise<string|null>}
 */
async function poisonClipboard(page) {
  const sentinel = `__serp_ai_cho_copy_${Math.abs(Date.now() % 1e9)}__`;
  const written = await page
    .evaluate(async (mark) => {
      try {
        window.focus();
        if (!navigator.clipboard?.writeText) return false;
        await navigator.clipboard.writeText(mark);
        return true;
      } catch (err) {
        return false;
      }
    }, sentinel)
    .catch(() => false);
  if (written !== true) return null;
  return (await readClipboardText(page)) === sentinel ? sentinel : null;
}

/**
 * Cho clipboard doi so voi noi dung TRUOC khi bam Copy.
 * Day la cai chan cuoi cung giu cho noi dung cua buoc Ahrefs/PAA khong lot vao
 * muc AI Mode khi nut Copy bam trung hoac chua kip ghi.
 */
async function waitForClipboardChange(page, before, opts) {
  const deadline = Date.now() + (opts?.timeoutMs ?? 5000);
  const pollMs = opts?.pollMs ?? 300;
  let text = '';
  for (;;) {
    text = await readClipboardText(page);
    if (typeof text === 'string' && text !== before) return { changed: true, text };
    if (Date.now() >= deadline) return { changed: false, text: text ?? '' };
    await sleep(pollMs);
  }
}

/** Dem nut Copy theo tung selector de phan biet Overview cu va answer moi. */
async function countCopyButtons(scope, promptSel) {
  const counts = [];
  for (const spec of promptSel.copy_button ?? []) {
    try {
      const locator = buildLocator(scope, spec);
      counts.push(locator ? await locator.count() : 0);
    } catch {
      counts.push(0);
    }
  }
  return counts;
}

/**
 * Doc noi dung do nut Copy vua ghi, uu tien quyen clipboardRead cua bridge.
 *
 * Duong du phong qua navigator.clipboard.readText() nem NotAllowedError
 * ("Document is not focused") khi tab khong phai tab dang hoat dong - loi that
 * trong run 20260827-141637, va cung la ly do E2E cuc bo doc duoc clipboard o
 * run nay nhung khong doc duoc o run ke tiep. Vi vay phai dua tab len truoc va
 * focus lai document truoc moi lan doc.
 */
async function readClipboardText(page) {
  if (typeof page.readClipboardText === 'function') {
    const text = await page.readClipboardText().catch(() => '');
    if (text) return text;
  }
  if (typeof page.bringToFront === 'function') await page.bringToFront().catch(() => {});
  return page.evaluate(async () => {
    try {
      window.focus();
      if (document.body && typeof document.body.focus === 'function') document.body.focus();
    } catch (err) { /* khong focus duoc thi van thu doc */ }
    if (!navigator.clipboard?.readText) return '';
    try {
      return await navigator.clipboard.readText();
    } catch (err) {
      return '';
    }
  }).catch(() => '');
}

/** Luu cac control dang hien thi de sua selector theo DOM that, khong theo anh. */
async function saveAiControls(page, logger, name = 'ai-overview-visible-controls') {
  const html = await page.evaluate(() => {
    const css = [
      'button', '[role="button"]', 'input', 'textarea', '[role="textbox"]',
      '[contenteditable="true"]', '[aria-label]', '[placeholder]',
    ].join(',');
    const controls = Array.from(document.querySelectorAll(css)).filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    });
    return controls.map((el) => el.outerHTML).join('\n');
  }).catch(() => '');
  const file = logger?.saveHtmlSnippet(name, html);
  if (file) logger?.info(`Da luu DOM control AI Overview: ${file}`);
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
  if (!inShell) {
    logger?.debug(`Tab AI dang la trang web binh thuong (${url}); khong bam sang target con.`);
    return false;
  }
  logger?.info(
    `Khong thay o nhap prompt trong tab (URL: ${url}`
    + ' - day la vo giao dien noi bo cua Chrome). '
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

export const _internals = {
  findResponseLocator, countResponseBlocks, describeSpec, findPromptBox, adoptAiSurface,
  waitForCopyButton, countCopyButtons, readClipboardText, openOverviewPrompt,
  isExcludedControl, isForeignControl, promptScope, scopeLevels, firstAllowed,
  sendPrompt, verifySubmitted, looksLikeAiUrl, waitForClipboardChange, readInputValue,
  poisonClipboard,
};
