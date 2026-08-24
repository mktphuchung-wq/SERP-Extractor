/**
 * Che do --capture-dom (dac ta v2.0 §4): chup DOM that cua tung block ra file
 * de soan selector tu bang chung thay vi doan.
 *
 * Ghi vao logs\<run_id>\dom-snapshots\:
 *   <block>.html         outerHTML da serialize ca shadow root
 *   <block>.meta.json    scopeKind, frameUrl, shadowHostPath, selector da dung
 *   selector-candidates.md  bao cao de xuat selector, xep theo do on dinh
 *
 * Chay tren CA main frame va cac iframe -> tra loi duoc cau hoi "widget nam
 * trong shadow root hay trong iframe" (gia thuyet H1 cua dac ta v2.0 §2.1).
 */
import fs from 'node:fs';
import path from 'node:path';

import { runExtractor } from './page-eval.mjs';
import { captureBlockDom } from '../extractors/dom-capture.mjs';

/** Lay danh sach CSS selector tu spec (extractor chi hieu CSS). */
function cssSpecs(specs) {
  return (specs ?? []).filter((s) => s && s.type === 'css' && s.css).map((s) => s.css);
}

/**
 * Chup mot block. Thu main frame truoc, khong thay thi thu tung iframe.
 * @param {{page:object, block:string, selectors:object, config:object, logger:object}} args
 */
export async function captureBlock(args) {
  const { page, block, selectors, config, logger } = args;
  const blockSel = selectors[block] ?? {};
  const groupName = args.group ?? 'container';
  const options = {
    cssSelectors: args.cssSelectors ?? cssSpecs(blockSel[groupName]),
    probeText: args.probeText ?? blockSel.probe_text ?? '',
    maxHtmlBytes: config.capture?.max_html_bytes ?? 4000000,
    includeShadow: config.capture?.include_shadow !== false,
  };

  // 1) Main frame
  let result = await runExtractor(page, captureBlockDom, { options }).catch((err) => {
    logger?.debug(`capture ${block} loi tren main frame: ${err.message}`);
    return null;
  });
  let frameUrl = null;

  // 2) Cac iframe
  if (!result?.found) {
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const inFrame = await frame.evaluate(
        new Function('arg', `const __f = ${captureBlockDom.toString()};\nreturn __f(arg);`),
        { options },
      ).catch(() => null);
      if (inFrame?.found) {
        result = inFrame;
        frameUrl = frame.url();
        break;
      }
    }
  }

  const meta = {
    block,
    group: groupName,
    captured_at: new Date().toISOString(),
    page_url: page.url(),
    found: Boolean(result?.found),
    scope_kind: frameUrl ? 'frame' : (result?.scopeKind ?? 'none'),
    frame_url: frameUrl,
    shadow_host_path: result?.shadowHostPath ?? null,
    matched_selector: result?.matchedSelector ?? null,
    matched_index: result?.matchedIndex ?? -1,
    selectors_tried: options.cssSelectors,
    probe_text: options.probeText,
    html_truncated: Boolean(result?.htmlTruncated),
    stats: result?.stats ?? {},
    candidates: result?.candidates ?? [],
    probe_matches: result?.probeMatches ?? [],
  };

  if (meta.found) {
    const where = meta.scope_kind === 'frame' ? `iframe ${frameUrl}`
      : meta.scope_kind === 'shadow' ? `shadow root (host: ${meta.shadow_host_path})`
        : 'main document';
    logger?.info(`[capture] ${block}: tim thay trong ${where}`);
    if (meta.scope_kind === 'shadow') {
      logger?.warn(`Block "${block}" nam trong shadow root.`, {
        code: 'AHREFS_SCOPE_SHADOW', block, host: meta.shadow_host_path,
      });
    } else if (meta.scope_kind === 'frame') {
      logger?.warn(`Block "${block}" nam trong iframe.`, {
        code: 'AHREFS_SCOPE_FRAME', block, frameUrl,
      });
    }
  } else {
    logger?.info(`[capture] ${block}: KHONG tim thay (da thu ${options.cssSelectors.length} selector + probe text)`);
  }

  return { meta, html: result?.html ?? '' };
}

/** Ghi snapshot cua mot block ra dia. */
export function writeSnapshot(snapshotDir, capture) {
  fs.mkdirSync(snapshotDir, { recursive: true });
  const base = capture.meta.block + (capture.meta.group && capture.meta.group !== 'container'
    ? `.${capture.meta.group}` : '');

  const htmlPath = path.join(snapshotDir, `${base}.html`);
  const metaPath = path.join(snapshotDir, `${base}.meta.json`);

  fs.writeFileSync(htmlPath, wrapHtml(capture), 'utf8');
  fs.writeFileSync(metaPath, `${JSON.stringify(capture.meta, null, 2)}\n`, 'utf8');
  return { htmlPath, metaPath };
}

function wrapHtml(capture) {
  const m = capture.meta;
  return [
    '<!doctype html>',
    '<!--',
    `  block        : ${m.block}`,
    `  captured_at  : ${m.captured_at}`,
    `  page_url     : ${m.page_url}`,
    `  scope_kind   : ${m.scope_kind}`,
    `  frame_url    : ${m.frame_url ?? '-'}`,
    `  shadow_host  : ${m.shadow_host_path ?? '-'}`,
    `  matched      : ${m.matched_selector ?? '(khong selector nao trung)'}`,
    '',
    '  Noi dung shadow root duoc chen inline giua <!--shadow-root open--> va',
    '  <!--/shadow-root-->. Mo file nay bang trinh duyet hoac editor deu doc duoc.',
    '-->',
    '<meta charset="utf-8">',
    capture.html || '<!-- khong tim thay block -->',
    '',
  ].join('\n');
}

/**
 * Bao cao de xuat selector, xep theo do on dinh giam dan (dac ta §4.3).
 */
export function buildCandidatesReport(captures) {
  const lines = [
    '# Selector candidates',
    '',
    `Sinh tu dong luc ${new Date().toISOString()} bang \`--capture-dom\`.`,
    '',
    'Cach dung:',
    '',
    '1. Voi moi block, chep selector o dong dau bang (hang cao nhat, `duy nhat = co`)',
    '   vao **dau** danh sach tuong ung trong `config/selectors.yaml`.',
    '2. Tang `selector_version` va dat `last_verified` la ngay hom nay.',
    '3. Copy file `.html` tuong ung vao `tests/fixtures/` va them test.',
    '4. Chay lai: khong con `SELECTOR_DRIFT` cho block do.',
    '',
    '> Chi nhan selector co `duy nhat = co` lam hang 1. Selector khop nhieu node',
    '> se lam adapter lay nham phan tu.',
    '',
  ];

  for (const capture of captures) {
    const m = capture.meta;
    lines.push(`## ${m.block}${m.group && m.group !== 'container' ? ` (${m.group})` : ''}`);
    lines.push('');

    if (!m.found) {
      lines.push('**Khong tim thay block nay.**');
      lines.push('');
      lines.push(`- Da thu ${m.selectors_tried.length} selector: ${m.selectors_tried.map((s) => `\`${s}\``).join(', ') || '(khong co)'}`);
      lines.push(`- Probe text: \`${m.probe_text || '(chua khai bao)'}\``);
      lines.push('');
      lines.push('Kha nang: block khong xuat hien tren trang (extension chua bat / chua dang nhap),');
      lines.push('hoac nam trong closed shadow root (khong the doc duoc bang bat ky cach nao).');
      lines.push('');
      continue;
    }

    lines.push(`- Vi tri: **${scopeLabel(m)}**`);
    lines.push(`- Selector dang dung: ${m.matched_selector ? `\`${m.matched_selector}\` (uu tien #${m.matched_index + 1})` : '**khong selector nao trung** — dang dung probe text'}`);
    if (m.shadow_host_path) lines.push(`- Shadow host: \`${m.shadow_host_path}\``);
    if (m.frame_url) lines.push(`- Frame URL: ${m.frame_url}`);
    lines.push(`- Kich thuoc: ${m.stats.childCount ?? 0} node con, ${m.stats.textLength ?? 0} ky tu text`);
    if (m.html_truncated) lines.push('- **HTML bi cat** vi vuot `capture.max_html_bytes`');
    lines.push('');

    if (m.candidates.length) {
      lines.push('### De xuat cho container');
      lines.push('');
      lines.push('| # | Selector | Ly do | Hang | Khop | Duy nhat | Trong shadow |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- |');
      m.candidates.forEach((c, i) => {
        lines.push(
          `| ${i + 1} | \`${c.css}\` | ${c.why} | ${c.rank} | ${c.matchCount} | `
          + `${c.unique ? 'co' : 'khong'} | ${c.inShadow ? 'co' : 'khong'} |`,
        );
      });
      lines.push('');
    }

    if (m.probe_matches.length) {
      lines.push('### Node khop probe text');
      lines.push('');
      for (const probe of m.probe_matches) {
        lines.push(`**"${probe.text}"**${probe.inShadow ? ' _(trong shadow root)_' : ''}`);
        lines.push('');
        lines.push(`- Duong dan: \`${probe.path}\``);
        const best = (probe.candidates ?? []).filter((c) => c.unique).slice(0, 3);
        for (const c of best) {
          lines.push(`- De xuat: \`${c.css}\` (${c.why}, hang ${c.rank})`);
        }
        lines.push('');
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function scopeLabel(meta) {
  if (meta.scope_kind === 'frame') return `iframe — ${meta.frame_url}`;
  if (meta.scope_kind === 'shadow') return 'shadow root (open)';
  return 'main document';
}

/**
 * Bo thu thap dung trong mot run. Orchestrator goi `snapshot()` o cac diem
 * truoc khi trich xuat; cuoi run goi `finish()` de ghi bao cao.
 */
export function createCapture({ enabled, blocks, runDir, config, selectors, logger }) {
  const wanted = Array.isArray(blocks) && blocks.length ? new Set(blocks) : null;
  const snapshotDir = path.join(runDir, 'dom-snapshots');
  const captures = [];

  return {
    enabled: Boolean(enabled),
    snapshotDir,

    wants(block) {
      if (!enabled) return false;
      return wanted ? wanted.has(block) : true;
    },

    async snapshot(page, block, opts = {}) {
      if (!this.wants(block)) return null;
      try {
        const capture = await captureBlock({
          page, block, selectors, config, logger, ...opts,
        });
        writeSnapshot(snapshotDir, capture);
        captures.push(capture);
        return capture;
      } catch (err) {
        logger?.debug(`capture ${block} that bai: ${err.message}`);
        return null;
      }
    },

    finish() {
      if (!enabled || !captures.length) return null;
      fs.mkdirSync(snapshotDir, { recursive: true });
      const reportPath = path.join(snapshotDir, 'selector-candidates.md');
      fs.writeFileSync(reportPath, buildCandidatesReport(captures), 'utf8');
      logger?.info(`[capture] Bao cao selector: ${reportPath}`);
      return reportPath;
    },
  };
}

/** Bo thu thap rong - dung khi khong bat --capture-dom. */
export const NO_CAPTURE = {
  enabled: false,
  wants: () => false,
  snapshot: async () => null,
  finish: () => null,
};
