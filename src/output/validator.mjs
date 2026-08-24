/**
 * Quality gates truoc khi bao thanh cong (dac ta muc 14).
 * Khong bao gio thong bao SUCCESS neu bat ky gate nao fail.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, detectColumns, areCsvIdentical } from '../extractors/csv-normalizer.mjs';
import { REQUIRED_HEADINGS } from './markdown-builder.mjs';

/** Placeholder noi bo khong duoc phep xuat hien trong file ket qua. */
const FORBIDDEN_SUBSTRINGS = ['[object Object]', 'chrome-extension://', 'querySelector', 'data-hveid'];
const FORBIDDEN_WORDS = ['undefined'];

/**
 * @param {string} text noi dung Markdown
 * @param {{prompt?:string}} [opts]
 * @returns {{ok:boolean, problems:string[]}}
 */
export function validateMarkdown(text, opts = {}) {
  const problems = [];
  const content = String(text ?? '');

  if (!content.trim()) problems.push('File Markdown rong.');

  const headings = content.split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.trim());
  if (headings.length !== REQUIRED_HEADINGS.length) {
    problems.push(`Phai co dung ${REQUIRED_HEADINGS.length} heading H2, dang co ${headings.length}.`);
  }
  REQUIRED_HEADINGS.forEach((expected, index) => {
    if (headings[index] !== expected) {
      problems.push(`Heading thu ${index + 1} phai la "${expected}", dang la "${headings[index] ?? '(thieu)'}".`);
    }
  });

  for (const token of FORBIDDEN_SUBSTRINGS) {
    if (content.includes(token)) problems.push(`Markdown chua gia tri khong hop le: "${token}".`);
  }
  for (const word of FORBIDDEN_WORDS) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(content)) {
      problems.push(`Markdown chua gia tri khong hop le: "${word}".`);
    }
  }
  if (/\bN\/A\b/.test(content)) {
    problems.push('Markdown khong duoc dung placeholder "N/A"; phai ghi canh bao ro rang.');
  }

  if (opts.prompt) {
    const aiSection = extractSection(content, '## AI Mode');
    const normalizedPrompt = opts.prompt.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedAi = aiSection.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalizedAi && normalizedAi === normalizedPrompt) {
      problems.push('Noi dung AI Mode trung nguyen van prompt da gui.');
    }
  }

  return { ok: problems.length === 0, problems };
}

export function extractSection(markdown, heading) {
  const lines = String(markdown ?? '').split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

/**
 * @param {string} text noi dung CSV
 * @param {{label:string, allowEmpty?:boolean}} opts
 */
export function validateCsv(text, opts) {
  const problems = [];
  const label = opts.label;
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (err) {
    return { ok: false, problems: [`${label}: khong parse duoc bang CSV parser chuan (${err.message}).`], rowCount: 0 };
  }

  if (!parsed.header.length) problems.push(`${label}: thieu dong header.`);
  if (parsed.rowCount === 0 && !opts.allowEmpty) {
    problems.push(`${label}: khong co dong du lieu nao.`);
  }

  const cols = detectColumns(parsed.header);
  if (cols.url) {
    parsed.records.forEach((row, index) => {
      const url = String(row[cols.url] ?? '').trim();
      if (!url) {
        problems.push(`${label}: dong ${index + 1} thieu URL.`);
      } else if (!/^https?:\/\//i.test(url)) {
        problems.push(`${label}: dong ${index + 1} co URL khong hop le "${url.slice(0, 60)}".`);
      }
      if (/^chrome-extension:\/\//i.test(url)) {
        problems.push(`${label}: dong ${index + 1} chua URL chrome-extension://.`);
      }
    });
  }
  if (cols.position) {
    parsed.records.forEach((row, index) => {
      const value = Number(String(row[cols.position] ?? '').trim());
      if (!Number.isFinite(value) || value <= 0) {
        problems.push(`${label}: dong ${index + 1} co position khong phai so duong.`);
      }
    });
  }

  return { ok: problems.length === 0, problems: problems.slice(0, 20), rowCount: parsed.rowCount };
}

/**
 * Kiem tra thu muc output chi co dung ba file, ten chinh xac.
 * @param {{dir:string, base:string}} args
 */
export function validateOutputFolder(args) {
  const problems = [];
  const expected = [
    `${args.base}.md`,
    `${args.base} page 1.csv`,
    `${args.base} page 2.csv`,
  ];

  if (!fs.existsSync(args.dir)) {
    return { ok: false, problems: [`Khong tim thay thu muc ket qua: ${args.dir}`], expected };
  }

  const entries = fs.readdirSync(args.dir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (files.length !== 3) {
    problems.push(`Thu muc ket qua phai co dung 3 file, dang co ${files.length}: ${files.join(', ')}`);
  }
  if (dirs.length) problems.push(`Thu muc ket qua khong duoc chua thu muc con: ${dirs.join(', ')}`);

  for (const name of expected) {
    if (!files.includes(name)) problems.push(`Thieu file "${name}".`);
  }
  for (const name of files) {
    if (/\.(tmp|crdownload|part)$/i.test(name)) problems.push(`Con file tam: ${name}`);
    if (!expected.includes(name)) problems.push(`File la trong thu muc ket qua: ${name}`);
  }

  return { ok: problems.length === 0, problems, expected };
}

/**
 * Gate tong hop truoc khi bao SUCCESS.
 * @param {{dir:string, base:string, prompt?:string}} args
 */
export function validateRun(args) {
  const problems = [];
  const folder = validateOutputFolder(args);
  problems.push(...folder.problems);
  if (!folder.ok) return { ok: false, problems, counts: {} };

  const mdPath = path.join(args.dir, `${args.base}.md`);
  const csv1Path = path.join(args.dir, `${args.base} page 1.csv`);
  const csv2Path = path.join(args.dir, `${args.base} page 2.csv`);

  const mdText = fs.readFileSync(mdPath, 'utf8');
  const md = validateMarkdown(mdText, { prompt: args.prompt });
  problems.push(...md.problems);

  const csv1Text = fs.readFileSync(csv1Path, 'utf8');
  const csv2Text = fs.readFileSync(csv2Path, 'utf8');
  const csv1 = validateCsv(csv1Text, { label: 'Page 1 CSV', allowEmpty: args.allowEmptyCsv });
  const csv2 = validateCsv(csv2Text, { label: 'Page 2 CSV', allowEmpty: args.allowEmptyCsv });
  problems.push(...csv1.problems, ...csv2.problems);

  if (csv1.rowCount > 0 && csv2.rowCount > 0 && areCsvIdentical(csv1Text, csv2Text)) {
    problems.push('Page 1 va Page 2 trung nhau hoan toan.');
  }

  return {
    ok: problems.length === 0,
    problems,
    counts: { page1Rows: csv1.rowCount, page2Rows: csv2.rowCount, mdChars: mdText.length },
  };
}
