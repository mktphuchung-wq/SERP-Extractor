/**
 * Integration test: duong di cua artifact tu staging -> output folder -> quality gate.
 * Bao dam thu muc ket qua CHI co 3 file va log nam ngoai.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeTempDir, loadFixtureDocument } from '../helpers/dom.mjs';
import { loadSelectors } from '../../src/core/config.mjs';
import { buildMarkdown } from '../../src/output/markdown-builder.mjs';
import { writeStagingArtifacts, moveToOutput, backupExisting, cleanStaging } from '../../src/output/artifact-writer.mjs';
import { validateRun } from '../../src/output/validator.mjs';
import { resolveOutputDir, sanitizeFileBase } from '../../src/core/sanitize.mjs';
import { extractOrganicResults } from '../../src/extractors/native-serp.mjs';
import { rowsToCsv } from '../../src/extractors/csv-normalizer.mjs';
import { buildManifest, writeManifest, collectSelectorVersions } from '../../src/output/manifest.mjs';

const selectors = loadSelectors();

function serpCsv(fixture, sourcePage, startOffset) {
  const rows = extractOrganicResults({
    document: loadFixtureDocument(fixture),
    options: {
      resultContainers: selectors.native_serp.result_containers,
      excludeContainers: selectors.native_serp.exclude_containers,
      excludeTextAnchors: selectors.native_serp.exclude_text_anchors,
      excludeUrlPatterns: selectors.native_serp.exclude_url_patterns,
      featuredSnippetContainers: selectors.native_serp.featured_snippet_containers,
      capturedAt: '2026-08-21T04:15:30.000Z',
      sourcePage, startOffset,
    },
  });
  return rowsToCsv(rows);
}

function buildRunArtifacts(tmpDir, keyword = 'Filipino vs Samoan') {
  const base = sanitizeFileBase(keyword);
  const stagingDir = path.join(tmpDir, 'staging', 'run-1');
  const markdown = buildMarkdown({
    ai: { markdown: 'AI answer paragraph.\n\n- point one\n- point two' },
    keywordIdeas: ['filipino vs samoan', 'samoan food'],
    paa: [{ question: 'Are Filipinos and Samoans related?' }],
    suggestions: ['filipino vs samoan culture'],
  });
  const staged = writeStagingArtifacts({
    stagingDir, base, markdown,
    csvPage1: serpCsv('serp-mixed.html', 1, 0),
    csvPage2: serpCsv('serp-page2.html', 2, 10),
  });
  return { base, stagingDir, staged, markdown };
}

test('output: staging -> output tao dung 3 file dung ten va qua quality gate', () => {
  const tmp = makeTempDir();
  try {
    const { base, staged, stagingDir } = buildRunArtifacts(tmp.dir);
    const outputDir = path.join(tmp.dir, 'output', base);

    const files = moveToOutput({ files: [staged.md, staged.csv1, staged.csv2], outputDir });
    assert.equal(files.length, 3);

    const names = fs.readdirSync(outputDir).sort();
    assert.deepEqual(names, [
      'Filipino vs Samoan page 1.csv',
      'Filipino vs Samoan page 2.csv',
      'Filipino vs Samoan.md',
    ]);

    const validation = validateRun({ dir: outputDir, base });
    assert.deepEqual(validation.problems, []);
    assert.equal(validation.counts.page1Rows, 3);
    assert.equal(validation.counts.page2Rows, 2);

    cleanStaging(stagingDir);
    assert.equal(fs.existsSync(stagingDir), false);
  } finally {
    tmp.cleanup();
  }
});

test('output: file .md la UTF-8 va doc lai dung noi dung', () => {
  const tmp = makeTempDir();
  try {
    const keyword = 'so sánh người Philippines và Samoa';
    const { base, staged, markdown } = buildRunArtifacts(tmp.dir, keyword);
    const readBack = fs.readFileSync(staged.md, 'utf8');
    assert.equal(readBack, markdown);
    assert.ok(base.includes('sánh'));
    assert.ok(path.basename(staged.md).endsWith('.md'));
  } finally {
    tmp.cleanup();
  }
});

test('output: staging khong con file .tmp sau khi ghi atomic', () => {
  const tmp = makeTempDir();
  try {
    const { stagingDir } = buildRunArtifacts(tmp.dir);
    const leftovers = fs.readdirSync(stagingDir).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally {
    tmp.cleanup();
  }
});

test('output: thu muc da ton tai thi tao ban timestamp, khong ghi de', () => {
  const tmp = makeTempDir();
  try {
    const root = path.join(tmp.dir, 'output');
    const base = 'Filipino vs Samoan';
    fs.mkdirSync(path.join(root, base), { recursive: true });
    fs.writeFileSync(path.join(root, base, 'old.md'), 'du lieu cu');

    const resolved = resolveOutputDir({ root, base, policy: 'timestamp', stamp: '20260821-111530' });
    assert.equal(resolved.action, 'suffix');

    const { staged } = buildRunArtifacts(tmp.dir);
    moveToOutput({ files: [staged.md, staged.csv1, staged.csv2], outputDir: resolved.dir });

    assert.equal(fs.readFileSync(path.join(root, base, 'old.md'), 'utf8'), 'du lieu cu');
    assert.equal(fs.readdirSync(resolved.dir).length, 3);
  } finally {
    tmp.cleanup();
  }
});

test('output: overwrite phai backup truoc, khong xoa mu', () => {
  const tmp = makeTempDir();
  try {
    const outputDir = path.join(tmp.dir, 'output', 'kw');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'kw.md'), 'ban cu');
    const backupDir = path.join(tmp.dir, 'logs', 'run-1', 'output-backup');

    backupExisting(outputDir, backupDir);
    assert.equal(fs.readFileSync(path.join(backupDir, 'kw.md'), 'utf8'), 'ban cu');
  } finally {
    tmp.cleanup();
  }
});

test('output: manifest ky thuat nam trong logs, khong nam trong output folder', () => {
  const tmp = makeTempDir();
  try {
    const { base, staged } = buildRunArtifacts(tmp.dir);
    const outputDir = path.join(tmp.dir, 'output', base);
    const files = moveToOutput({ files: [staged.md, staged.csv1, staged.csv2], outputDir });

    const runDir = path.join(tmp.dir, 'logs', '20260821-111530-filipino-vs-samoan');
    const manifestPath = writeManifest(runDir, buildManifest({
      runId: '20260821-111530-filipino-vs-samoan',
      keyword: 'Filipino vs Samoan',
      prompt: 'What are the differences?',
      config: { search: { country: 'us', language: 'en', domain: 'www.google.com' } },
      startedAt: '2026-08-21T04:15:30.000Z',
      completedAt: '2026-08-21T04:18:20.000Z',
      status: 'SUCCESS',
      sources: { ai: 'google_ai_mode', serp_page_1: 'native_serp_dom' },
      counts: { ai_chars: 120, serp_page_1_rows: 3 },
      selectorVersions: collectSelectorVersions(selectors),
      files: files.map((f) => path.basename(f)),
      outputDir,
      warnings: [],
    }));

    assert.ok(fs.existsSync(manifestPath));
    assert.equal(fs.readdirSync(outputDir).length, 3);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.status, 'SUCCESS');
    assert.equal(manifest.prompt_sha256.length, 64);
    assert.ok(!JSON.stringify(manifest).includes('What are the differences?'), 'prompt phai duoc hash');
    assert.equal(manifest.selector_versions.native_serp, selectors.native_serp.selector_version);
  } finally {
    tmp.cleanup();
  }
});

test('output: quality gate bat truong hop thieu file page 2', () => {
  const tmp = makeTempDir();
  try {
    const { base, staged } = buildRunArtifacts(tmp.dir);
    const outputDir = path.join(tmp.dir, 'output', base);
    moveToOutput({ files: [staged.md, staged.csv1], outputDir });
    const validation = validateRun({ dir: outputDir, base });
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.includes('page 2.csv')));
  } finally {
    tmp.cleanup();
  }
});

test('output: thu muc mang hau to chong trung nhung TEN FILE luon sach', () => {
  const tmp = makeTempDir();
  try {
    const root = path.join(tmp.dir, 'output');
    const base = 'Filipino vs Samoan';

    // Lan chay truoc da chiem cho
    fs.mkdirSync(path.join(root, base), { recursive: true });
    fs.writeFileSync(path.join(root, base, `${base}.md`), 'ban cu');

    const resolved = resolveOutputDir({ root, base, policy: 'timestamp', stamp: '20260822-120000' });
    assert.equal(path.basename(resolved.dir), 'Filipino vs Samoan__20260822-120000',
      'THU MUC phai mang hau to chong trung');

    // Nhung file van dung ten keyword sach
    const { staged } = buildRunArtifacts(tmp.dir);
    const files = moveToOutput({ files: [staged.md, staged.csv1, staged.csv2], outputDir: resolved.dir });

    assert.deepEqual(fs.readdirSync(resolved.dir).sort(), [
      'Filipino vs Samoan page 1.csv',
      'Filipino vs Samoan page 2.csv',
      'Filipino vs Samoan.md',
    ], 'TEN FILE khong duoc mang hau to timestamp');

    for (const f of files) {
      assert.ok(!path.basename(f).includes('__'), `"${path.basename(f)}" khong duoc chua hau to`);
    }

    // Quality gate dung ten file sach de kiem tra
    assert.deepEqual(validateRun({ dir: resolved.dir, base }).problems, []);

    // Ban cu khong bi dung toi
    assert.equal(fs.readFileSync(path.join(root, base, `${base}.md`), 'utf8'), 'ban cu');
  } finally {
    tmp.cleanup();
  }
});

test('output: hai lan chay cung keyword cho hai thu muc, cung ten file', () => {
  const tmp = makeTempDir();
  try {
    const root = path.join(tmp.dir, 'output');
    const base = 'kw chung';

    for (const stamp of ['20260822-100000', '20260822-110000']) {
      const dir = path.join(root, `${base}__${stamp}`);
      const { staged } = buildRunArtifacts(path.join(tmp.dir, stamp), base);
      moveToOutput({ files: [staged.md, staged.csv1, staged.csv2], outputDir: dir });
      assert.ok(fs.existsSync(path.join(dir, `${base}.md`)), 'moi thu muc deu co file ten sach');
    }

    const dirs = fs.readdirSync(root).sort();
    assert.equal(dirs.length, 2);
    assert.ok(dirs.every((d) => d.startsWith('kw chung__')));
  } finally {
    tmp.cleanup();
  }
});
