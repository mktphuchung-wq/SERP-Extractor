/**
 * Phan tich input nhieu tu khoa.
 *
 * Nguoi dung co the nhap nhieu tu khoa ngan cach bang dau ";" de tao nhieu
 * thu muc output trong mot lan chay:
 *   RUN.bat "keyword 1; keyword 2; keyword 3"
 *
 * Cac tu khoa duoc chay TUAN TU (khong song song) vi Google Search va extension
 * phu thuoc trang thai tab/profile - chay song song de lay nham du lieu giua
 * cac tu khoa (dac ta muc 17).
 */
import { dedupeKey } from './text.mjs';

export const KEYWORD_SEPARATOR = ';';

/**
 * Tach chuoi input thanh danh sach tu khoa da lam sach.
 * @param {string} input
 * @returns {string[]}
 */
export function parseKeywordList(input) {
  const raw = String(input ?? '');
  if (!raw.trim()) return [];

  const seen = new Set();
  const out = [];
  for (const part of raw.split(KEYWORD_SEPARATOR)) {
    const keyword = part.replace(/\s+/g, ' ').trim();
    if (!keyword) continue;
    const key = dedupeKey(keyword);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

/**
 * Tach danh sach prompt. Cho phep:
 *  - de trong        -> dung template cho tat ca
 *  - mot prompt      -> dung chung cho tat ca tu khoa
 *  - nhieu prompt    -> ghep theo thu tu voi tu khoa
 * @param {string} input
 * @returns {string[]}
 */
export function parsePromptList(input) {
  const raw = String(input ?? '');
  if (!raw.trim()) return [];
  return raw
    .split(KEYWORD_SEPARATOR)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Ghep tu khoa voi prompt tuong ung.
 * @param {string[]} keywords
 * @param {string[]} prompts
 * @param {(keyword:string)=>string} fallback tao prompt tu template
 * @returns {Array<{keyword:string, prompt:string, promptSource:'explicit'|'shared'|'template'}>}
 */
export function pairKeywordsAndPrompts(keywords, prompts, fallback) {
  const list = keywords ?? [];
  const given = prompts ?? [];

  return list.map((keyword, index) => {
    if (given.length === 0) {
      return { keyword, prompt: fallback(keyword), promptSource: 'template' };
    }
    if (given.length === 1) {
      return { keyword, prompt: given[0], promptSource: 'shared' };
    }
    if (index < given.length) {
      return { keyword, prompt: given[index], promptSource: 'explicit' };
    }
    return { keyword, prompt: fallback(keyword), promptSource: 'template' };
  });
}
