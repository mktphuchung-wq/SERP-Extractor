/**
 * Chuan hoa van ban va danh sach (dac ta muc 3.3, 4.1 Normalizer).
 */

const WS = new RegExp('[\\u00a0\\u2007\\u202f\\s]+', 'g');
const ZERO_WIDTH = new RegExp('[\\u200b-\\u200d\\ufeff]', 'g');

/** Trim + collapse whitespace + bo zero-width char. */
export function normalizeText(input) {
  if (input == null) return '';
  return String(input).replace(ZERO_WIDTH, '').replace(WS, ' ').trim();
}

/** Key so sanh de deduplicate: khong phan biet hoa/thuong va khoang trang. */
export function dedupeKey(input) {
  return normalizeText(input).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Bien mot mang chuoi tho thanh list sach:
 * trim, bo rong, bo UI noise, deduplicate case-insensitive, giu thu tu xuat hien.
 * @param {Array<string|{text:string}>} items
 * @param {{noise?:string[], minLength?:number, maxLength?:number}} [opts]
 * @returns {string[]}
 */
export function normalizeList(items, opts = {}) {
  const minLength = opts.minLength ?? 1;
  const maxLength = opts.maxLength ?? 300;
  const noise = compileNoise(opts.noise);
  const seen = new Set();
  const out = [];

  for (const raw of items || []) {
    const value = typeof raw === 'string' ? raw : raw?.text;
    const text = normalizeText(value);
    if (!text) continue;
    if (text.length < minLength || text.length > maxLength) continue;
    if (noise.some((re) => re.test(text))) continue;
    const key = dedupeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** Compile mang pattern dang '(?i)abc' hoac regex string thanh RegExp[]. */
export function compileNoise(patterns) {
  return (patterns || []).map(toRegExp).filter(Boolean);
}

/**
 * Ho tro cu phap '(?i)...' trong YAML (JS khong ho tro inline flag).
 * @param {string|RegExp} pattern
 * @returns {RegExp|null}
 */
export function toRegExp(pattern) {
  if (!pattern) return null;
  if (pattern instanceof RegExp) return pattern;
  const str = String(pattern);
  const m = /^\(\?([a-z]+)\)(.*)$/s.exec(str);
  if (m) {
    const flags = m[1].replace(/[^imsu]/g, '');
    try {
      return new RegExp(m[2], flags);
    } catch {
      return null;
    }
  }
  try {
    return new RegExp(str);
  } catch {
    return null;
  }
}

/** Kiem tra chuoi co khop bat ky pattern nao khong. */
export function matchesAny(text, patterns) {
  const res = compileNoise(patterns);
  return res.some((re) => re.test(text));
}

/**
 * Cat bot xuong dong thua nhung giu cau truc doan (dac ta: "giu xuong dong hop ly").
 */
export function normalizeMarkdownBlock(input) {
  if (!input) return '';
  return String(input)
    .replace(/\r\n?/g, '\n')
    .replace(ZERO_WIDTH, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Escape ky tu dac biet cho Markdown link text. */
export function escapeMarkdown(text) {
  return String(text ?? '').replace(/([\\`*_[\]])/g, '\\$1');
}
