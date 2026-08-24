/**
 * Bom cac ham extractor thuan (src/extractors/*) vao trang.
 *
 * Ly do co file nay: page.evaluate() chi serialize duoc ham self-contained,
 * khong keo theo import. Ta ghep source cua ham thanh mot ham moi roi cho
 * Playwright danh gia trong page. Nho vay CUNG MOT ham duoc dung o ca hai noi:
 *   - trong Chrome that (page.evaluate)
 *   - trong test offline (linkedom, goi truc tiep)
 */

/**
 * @param {Function} fn ham extractor self-contained
 * @param {string} [call] bieu thuc goi ham, mac dinh '__f(arg)'
 * @returns {Function}
 */
export function composeExtractor(fn, call = '__f(arg)') {
  // eslint-disable-next-line no-new-func
  return new Function('arg', `const __f = ${fn.toString()};\nreturn ${call};`);
}

/**
 * @param {import('playwright-core').Page} page
 * @param {Function} fn
 * @param {object} arg
 * @param {string} [call]
 */
export async function runExtractor(page, fn, arg, call) {
  return page.evaluate(composeExtractor(fn, call), arg);
}

/**
 * Chay extractor tren mot element cu the (vi du block AI response).
 * @param {import('playwright-core').Locator} locator
 * @param {Function} fn
 * @param {object} options
 * @param {string} [call]
 */
export async function runExtractorOnLocator(locator, fn, options, call = '__f(arg.root, arg.options)') {
  const handle = await locator.elementHandle();
  if (!handle) return null;
  try {
    return await locator.page().evaluate(composeExtractor(fn, call), { root: handle, options });
  } finally {
    await handle.dispose().catch(() => {});
  }
}
