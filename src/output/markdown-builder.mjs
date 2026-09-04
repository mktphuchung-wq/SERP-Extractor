/**
 * Dung noi dung file Markdown theo dung dac ta muc 3.3.
 * Bon H2 bat buoc, dung thu tu, khong them heading nao khac o che do mac dinh.
 * Khong ghi placeholder "N/A" - thay bang canh bao blockquote ro rang.
 */
import { normalizeList, normalizeAiMarkdown } from '../core/text.mjs';

export const REQUIRED_HEADINGS = [
  '## AI Mode',
  '## Keywords Ideas',
  '## People Also Asked',
  '## Search Suggestion',
];

export const NOTES = {
  ai: '> Khong tim thay AI Overview/AI Mode cho truy van nay.',
  keywordIdeas: '> Khong lay duoc Keywords Ideas tu Ahrefs SEO Toolbar cho truy van nay.',
  paa: '> Khong tim thay People Also Asked cho truy van nay.',
  suggestions: '> Khong lay duoc Google Search Suggestions cho truy van nay.',
};

/**
 * @param {{ai:{markdown:string}, keywordIdeas:string[], paa:Array<{question:string,answer:string}>, suggestions:string[], paaMode?:string}} data
 * @returns {string}
 */
export function buildMarkdown(data) {
  const sections = [];

  sections.push(section('## AI Mode', normalizeAiMarkdown(data.ai?.markdown) || NOTES.ai));

  const ideas = normalizeList(data.keywordIdeas ?? []);
  sections.push(section('## Keywords Ideas', ideas.length ? bulletList(ideas) : NOTES.keywordIdeas));

  const paaBlock = renderPaa(data.paa ?? [], data.paaMode ?? 'questions_only');
  sections.push(section('## People Also Asked', paaBlock || NOTES.paa));

  const suggestions = normalizeList(data.suggestions ?? []);
  sections.push(section('## Search Suggestion', suggestions.length ? bulletList(suggestions) : NOTES.suggestions));

  return `${sections.join('\n\n')}\n`;
}

function section(heading, body) {
  return `${heading}\n\n${body.trim()}`;
}

function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

function renderPaa(items, mode) {
  const clean = [];
  const seen = new Set();
  for (const item of items) {
    const question = typeof item === 'string' ? item : item?.question;
    const answer = typeof item === 'string' ? '' : (item?.answer ?? '');
    const text = String(question ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ question: text, answer: String(answer ?? '').replace(/\s+/g, ' ').trim() });
  }
  if (!clean.length) return '';

  if (mode === 'questions_and_answers' && clean.some((i) => i.answer)) {
    return clean
      .map((i) => (i.answer ? `- **${i.question}**\n  ${i.answer}` : `- **${i.question}**`))
      .join('\n');
  }
  return clean.map((i) => `- ${i.question}`).join('\n');
}

export const _internals = { renderPaa, bulletList };
