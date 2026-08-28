/**
 * Run manifest ky thuat (dac ta muc 12).
 * Luu trong logs\<run_id>\run-manifest.json, KHONG luu vao thu muc ket qua.
 * Khong ghi cookie/header/password/noi dung profile.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sha256(text) {
  return crypto.createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

/**
 * @param {object} data
 * @returns {object}
 */
export function buildManifest(data) {
  return {
    run_id: data.runId,
    keyword: data.keyword,
    prompt_sha256: sha256(data.prompt),
    market: {
      country: data.config.search.country,
      language: data.config.search.language,
      domain: data.config.search.domain,
    },
    started_at: data.startedAt,
    completed_at: data.completedAt,
    status: data.status,
    sources: data.sources,
    counts: data.counts,
    selector_versions: data.selectorVersions,
    files: data.files,
    output_dir: data.outputDir,
    folder_base: data.folderBase ?? null,
    warnings: data.warnings ?? [],
    severity: data.severity ?? null,
    errors: data.errors ?? [],
    // --- Quan sat hieu nang (dac ta Fast Path v1 - P1) -----------------------
    // Ba khoa duoi day tra loi ba cau hoi da khong tra loi duoc sau run
    // 20260827-171404: thoi gian di dau, selector nao dang phai fallback, va AI
    // that bai o dung buoc nao.
    stage_timings_ms: data.stageTimings ?? {},
    fallbacks: data.fallbacks ?? [],
    ai_submission: data.aiSubmission ?? {
      attempts: 0,
      tried: [],
      confirmed_by: null,
      last_progress_at: null,
      terminal_reason: null,
    },
    tool: {
      name: 'auto-serp-research',
      node: process.version,
      chrome: data.chromeVersion ?? null,
      // 'bridge'  = chay trong trinh duyet cua nguoi dung
      // 'playwright' = chay tren Chrome for Testing voi profile rieng
      // Ghi lai vi hai duong nay cho ket qua khac nhau: engine bridge dung
      // phien dang nhap that nen co du lieu Ahrefs, engine playwright thi khong.
      engine: data.engine ?? null,
      extensions: data.extensions ?? {},
    },
  };
}

export function writeManifest(runDir, manifest) {
  fs.mkdirSync(runDir, { recursive: true });
  const target = path.join(runDir, 'run-manifest.json');
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return target;
}

/** Lay selector_version cua tung block de theo doi UI drift. */
export function collectSelectorVersions(selectors) {
  const out = {};
  for (const [block, value] of Object.entries(selectors ?? {})) {
    if (value && typeof value === 'object' && value.selector_version) {
      out[block] = value.selector_version;
    }
  }
  return out;
}
