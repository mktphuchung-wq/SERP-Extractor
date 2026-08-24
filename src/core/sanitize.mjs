/**
 * Sanitize ten file/folder theo quy tac Windows (dac ta muc 8).
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './errors.mjs';

const ILLEGAL_CHARS = /[<>:"/\\|?*]/g;
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g');
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/**
 * Chuyen keyword thanh base filename an toan tren Windows.
 * Giu nguyen dau tieng Viet va chu hoa/thuong.
 * @param {string} input
 * @param {{maxLength?:number, replacement?:string}} [opts]
 * @returns {string}
 */
export function sanitizeFileBase(input, opts = {}) {
  const maxLength = opts.maxLength ?? 120;
  const replacement = opts.replacement ?? ' ';

  let s = String(input ?? '');
  s = s.replace(CONTROL_CHARS, ' ');
  s = s.replace(ILLEGAL_CHARS, replacement);
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[.\s]+$/g, '');

  if (s.length > maxLength) {
    s = s.slice(0, maxLength).replace(/[.\s]+$/g, '').trim();
  }

  if (!s) s = 'untitled';

  const upper = s.toUpperCase();
  const stem = upper.split('.')[0];
  if (RESERVED_NAMES.has(upper) || RESERVED_NAMES.has(stem)) {
    s = `${s}_`;
  }

  return s;
}

/** Timestamp dang 20260821-111530 dung cho run id va suffix conflict. */
export function timestampStamp(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/** Slug ascii-ish dung cho ten thu muc log. */
export function slugify(input, maxLength = 40) {
  const s = String(input ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[Đđ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'run').slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * Tao run id: <timestamp>-<slug keyword>
 */
export function buildRunId(keyword, date = new Date()) {
  return `${timestampStamp(date)}-${slugify(keyword)}`;
}

/**
 * Quyet dinh duong dan output folder theo conflict policy (muc 8.2).
 * @param {{root:string, base:string, policy?:'timestamp'|'fail'|'overwrite', stamp:string, allowOverwrite?:boolean, exists?:(p:string)=>boolean}} args
 * @returns {{dir:string, base:string, conflict:boolean, action:'create'|'suffix'|'overwrite'}}
 */
export function resolveOutputDir(args) {
  const { root, base, policy = 'timestamp', stamp } = args;
  const exists = args.exists ?? ((p) => fs.existsSync(p));
  const direct = path.join(root, base);

  if (!exists(direct)) {
    return { dir: direct, base, conflict: false, action: 'create' };
  }

  if (policy === 'fail') {
    throw new AppError(
      'OUTPUT_CONFLICT',
      `Thu muc ket qua da ton tai: ${direct}. Dung --overwrite hoac doi on_conflict.`,
      { details: { dir: direct } },
    );
  }

  if (policy === 'overwrite') {
    if (!args.allowOverwrite) {
      throw new AppError(
        'OUTPUT_CONFLICT',
        'on_conflict=overwrite chi duoc phep khi chay voi tham so --overwrite.',
        { details: { dir: direct } },
      );
    }
    return { dir: direct, base, conflict: true, action: 'overwrite' };
  }

  // timestamp (mac dinh)
  const suffixed = `${base}__${stamp}`;
  return {
    dir: path.join(root, suffixed),
    base: suffixed,
    conflict: true,
    action: 'suffix',
  };
}

export const _internals = { RESERVED_NAMES, ILLEGAL_CHARS, CONTROL_CHARS };
