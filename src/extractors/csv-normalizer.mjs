/**
 * Doc/ghi/so sanh CSV bang parser chuan (dac ta muc 14: cam split dau phay).
 */
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { CANONICAL_CSV_HEADER } from './native-serp.mjs';

export { CANONICAL_CSV_HEADER };

const BOM = String.fromCharCode(0xfeff);

export function stripBom(text) {
  return typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * @param {string} text
 * @returns {{header:string[], records:object[], rowCount:number}}
 */
export function parseCsv(text) {
  const clean = stripBom(String(text ?? ''));
  if (!clean.trim()) return { header: [], records: [], rowCount: 0 };
  const records = parse(clean, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: false,
  });
  const rawHeader = parse(clean, { to_line: 1, bom: true, relax_column_count: true })[0] || [];
  return { header: rawHeader.map((h) => String(h).trim()), records, rowCount: records.length };
}

/** Tim ten cot theo nhieu bien the (title/Title/URL/link/position/rank...). */
export function detectColumns(header) {
  const lower = header.map((h) => String(h).toLowerCase().trim());
  const find = (candidates) => {
    for (const cand of candidates) {
      const idx = lower.findIndex((h) => h === cand);
      if (idx >= 0) return header[idx];
    }
    for (const cand of candidates) {
      const idx = lower.findIndex((h) => h.includes(cand));
      if (idx >= 0) return header[idx];
    }
    return null;
  };
  return {
    position: find(['position', 'rank', 'pos', '#']),
    title: find(['title', 'name', 'heading']),
    url: find(['url', 'link', 'href', 'address']),
    description: find(['description', 'snippet', 'desc']),
  };
}

/**
 * Ghi rows canonical ra CSV (dung cho native fallback).
 * @param {object[]} rows
 * @param {{header?:string[], withBom?:boolean}} [opts]
 */
export function rowsToCsv(rows, opts = {}) {
  const header = opts.header ?? CANONICAL_CSV_HEADER;
  const body = stringify(rows ?? [], { header: true, columns: header });
  return opts.withBom ? BOM + body : body;
}

/**
 * Chuyen CSV cua extension sang schema canonical (chi khi normalize_serp_csv=true).
 * @param {string} text
 * @param {{sourcePage:number, capturedAt:string}} meta
 */
export function normalizeCsvText(text, meta) {
  const { header, records } = parseCsv(text);
  if (!records.length) return text;
  const cols = detectColumns(header);
  const rows = records.map((rec, index) => ({
    position: Number(cols.position ? rec[cols.position] : NaN) || index + 1,
    title: cols.title ? String(rec[cols.title] ?? '') : '',
    url: cols.url ? String(rec[cols.url] ?? '') : '',
    displayed_url: '',
    description: cols.description ? String(rec[cols.description] ?? '') : '',
    result_type: 'organic',
    source_page: meta.sourcePage,
    captured_at: meta.capturedAt,
  }));
  return rowsToCsv(rows);
}

/**
 * Danh so lai cot position (dung khi chay song song: luc trich xuat Page 2
 * chua biet Page 1 co bao nhieu dong).
 * Chi ap dung cho CSV schema canonical do tool tu sinh; CSV goc cua extension
 * duoc giu nguyen de khong lam sai du lieu cua ho.
 * @param {string} text
 * @param {number} startOffset
 */
export function renumberPositions(text, startOffset) {
  const { header, records } = parseCsv(text);
  if (!records.length) return text;
  if (!header.includes('position')) return text;

  const rows = records.map((rec, index) => ({ ...rec, position: startOffset + index + 1 }));
  return stringify(rows, { header: true, columns: header });
}

/** Tap URL da chuan hoa - dung de so sanh Page 1 va Page 2. */
export function urlFingerprint(text) {
  const { header, records } = parseCsv(text);
  const cols = detectColumns(header);
  if (!cols.url) {
    return records.map((r) => Object.values(r).join('|').toLowerCase().trim());
  }
  return records
    .map((r) => String(r[cols.url] ?? '').trim().toLowerCase().replace(/\/+$/, '').replace(/#.*$/, ''))
    .filter(Boolean);
}

/**
 * Page 1 va Page 2 trung 100% hay khong (dac ta Step 7 / muc 14).
 */
export function areCsvIdentical(textA, textB) {
  const a = urlFingerprint(textA);
  const b = urlFingerprint(textB);
  if (a.length === 0 || b.length === 0) return false;
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((url) => setB.has(url));
}
