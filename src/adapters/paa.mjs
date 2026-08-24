/**
 * People Also Asked adapter (dac ta Step 4).
 * Thu tu nguon: Ahrefs widget -> Google PAA block (DOM fallback).
 * Mac dinh questions_only: KHONG tu click mo rong de tranh lam doi snapshot SERP.
 */
import { runExtractor } from '../browser/page-eval.mjs';
import { extractGooglePaa } from '../extractors/paa-dom.mjs';
import { collectPaaFromAhrefs } from './ahrefs-widget.mjs';
import { normalizeList } from '../core/text.mjs';
import { WARNING_CODES } from '../core/errors.mjs';
import { sleep } from '../core/retry.mjs';

/**
 * @returns {Promise<{items:Array<{question:string, answer:string}>, source:string, warnings:string[]}>}
 */
export async function collectPaa(args) {
  const { page, config, selectors, logger } = args;
  const mode = config.extractors.paa_capture_mode ?? 'questions_only';
  const warnings = [];

  // Nguon 1: tab People also ask cua Ahrefs
  const ahrefs = await collectPaaFromAhrefs(args).catch((err) => {
    logger?.debug(`Ahrefs PAA loi: ${err.message}`);
    return { items: [], source: 'none', warnings: [WARNING_CODES.AHREFS_PAA_UNAVAILABLE] };
  });
  warnings.push(...(ahrefs.warnings ?? []));

  if (ahrefs.items.length) {
    return {
      items: ahrefs.items.map((question) => ({ question, answer: '' })),
      source: ahrefs.source,
      warnings,
    };
  }

  // Nguon 2: block People also ask trong Google SERP
  logger?.info('Ahrefs khong co PAA, dung block People also ask cua Google.');
  const sel = selectors.google_paa ?? {};
  const withAnswers = mode === 'questions_and_answers';

  if (withAnswers) await expandAllQuestions(page, selectors, logger);

  const result = await runExtractor(page, extractGooglePaa, {
    options: {
      containerSelectors: cssSpecs(sel.container),
      questionSelectors: cssSpecs(sel.question_nodes),
      answerSelectors: cssSpecs(sel.answer_nodes),
      withAnswers,
      maxItems: 30,
    },
  });

  if (!result?.found || !result.items.length) {
    logger?.warn('Khong tim thay People also ask trong SERP.', { code: WARNING_CODES.PAA_NOT_FOUND });
    warnings.push(WARNING_CODES.PAA_NOT_FOUND);
    return { items: [], source: 'none', warnings };
  }

  const questions = normalizeList(result.items.map((i) => i.question), { minLength: 5 });
  const byQuestion = new Map(result.items.map((i) => [i.question.toLowerCase().trim(), i.answer]));
  const items = questions.map((question) => ({
    question,
    answer: byQuestion.get(question.toLowerCase().trim()) ?? '',
  }));

  logger?.info(`PAA tu Google: ${items.length} cau hoi (source ghi trong log, khong ghi vao Markdown).`);
  return { items, source: 'google_serp_dom', warnings };
}

/** Chi dung o che do questions_and_answers: click tuan tu tung cau hoi. */
async function expandAllQuestions(page, selectors, logger) {
  const sel = selectors.google_paa ?? {};
  for (const spec of sel.question_nodes ?? []) {
    if (spec.type !== 'css') continue;
    let nodes;
    try { nodes = page.locator(spec.css); } catch { continue; }
    const count = await nodes.count().catch(() => 0);
    if (!count) continue;
    for (let i = 0; i < Math.min(count, 10); i += 1) {
      try {
        await nodes.nth(i).click({ timeout: 3000 });
        await sleep(900);
      } catch { /* cau hoi khong click duoc */ }
    }
    logger?.info(`Da mo ${Math.min(count, 10)} cau hoi PAA de lay cau tra loi.`);
    return;
  }
}

function cssSpecs(specs) {
  return (specs ?? []).filter((s) => s && s.type === 'css' && s.css).map((s) => s.css);
}
