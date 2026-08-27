/**
 * Google Search Suggestions adapter - kien truc v2.0 (DOM-first).
 *
 * TAI SAO KHONG CON EXTENSION-FIRST:
 * Extension "Google Search Suggestion Extractor" chi doc duoc tab dang active
 * khi popup duoc Chrome mo tu icon tren thanh cong cu. Tool mo popupUrl nhu mot
 * tab thuong qua CDP, khi do chrome.tabs.query({active:true}) tra ve chinh tab
 * popup => extension doc nham tab. Run that 2026-08-22 tra ve dung 1 "goi y"
 * chinh la prompt AI o tab khac. Day la gioi han nguyen ly, khong sua bang selector.
 *
 * THU TU NGUON v2.0:
 *   1) DOM dropdown cua o tim kiem      <-- NGUON CHINH
 *   2) endpoint complete/search          <-- fallback, bat mac dinh
 *   3) manual_assist: nguoi dung tu bam icon extension roi Copy (tuy chon)
 *
 * Van khong bao gio gia lap click toa do vao icon extension (bat bien #3).
 */
import { firstVisible, clickFirstVisible } from '../browser/locator.mjs';
import { runExtractor } from '../browser/page-eval.mjs';
import { extractSuggestionDropdown, extractExtensionSuggestions } from '../extractors/suggestions-dom.mjs';
import { normalizeList } from '../core/text.mjs';
import { WARNING_CODES } from '../core/errors.mjs';
import { sleep } from '../core/retry.mjs';
import { NO_LOCK } from '../core/mutex.mjs';

/**
 * @returns {Promise<{items:string[], source:string, warnings:string[]}>}
 */
export async function collectSuggestions(args) {
  const { page, config, selectors, logger, keyword } = args;
  const mode = config.extractors.suggestion_source ?? 'extension_then_dom';
  const lock = args.lock ?? NO_LOCK;
  const warnings = [];

  // Ca hai nguon deu can dropdown dang mo -> giu khoa tab active suot qua trinh
  const result = await lock.run(async () => {
    const opened = await openSuggestionDropdown(args);
    if (!opened) {
      logger?.warn('Khong mo duoc dropdown goi y cua Google.', {
        code: WARNING_CODES.SUGGESTIONS_NOT_FOUND,
      });
      return { items: [], source: 'none', warnings: [WARNING_CODES.SUGGESTIONS_NOT_FOUND] };
    }

    // Chup DOM dropdown NGAY LUC NO DANG MO - day la thoi diem duy nhat
    // co the lay duoc bang chung ve cau truc that cua dropdown.
    if (args.capture?.wants('google_suggestions')) {
      await args.capture.snapshot(page, 'google_suggestions', {
        group: 'listbox',
        cssSelectors: cssSpecs(selectors.google_suggestions?.listbox),
        probeText: selectors.google_suggestions?.probe_text ?? '',
      });
    }

    // DOM la NGUON CHINH (v2.0). Extension popup KHONG con duoc goi tu dong:
    // mo popupUrl nhu mot tab thuong thi chrome.tabs.query({active:true}) tra ve
    // chinh tab popup, nen extension doc nham tab khac. Run that 2026-08-22 da
    // tra ve dung mot "goi y" chinh la prompt AI dang nam o tab AI Mode.
    return readOpenDropdown(args);
  });

  await closeDropdown(page);

  warnings.push(...(result.warnings ?? []));

  // Endpoint la nguon TRUNG LAP: no khong biet gi ve lich su cua tai khoan.
  // Vi vay dung no de (a) doi chieu cuu cac dong bi gan nham la "ca nhan",
  // (b) bo sung them goi y. Run that 2026-08-22 cho thay bo loc con bao nham:
  // "samoan traditional clothing female/puletasi" bi loai nhung endpoint van tra ve.
  let endpointItems = [];
  let endpointWarnings = [];
  if (config.extractors.allow_autocomplete_endpoint === true) {
    const viaEndpoint = await tryAutocompleteEndpoint(page, keyword, config, logger);
    endpointItems = viaEndpoint.items;
    endpointWarnings = viaEndpoint.warnings ?? [];
  }
  warnings.push(...endpointWarnings);

  const rescued = rescueFlagged(result.flagged ?? [], endpointItems, logger);
  const merged = normalizeList([...(result.items ?? []), ...rescued, ...endpointItems], { minLength: 2 });

  if (merged.length) {
    const source = pickSource(result.items?.length ?? 0, rescued.length, endpointItems.length);
    logger?.info(`Search Suggestions: ${merged.length} muc (nguon ${source}).`);
    return { items: merged, source, warnings };
  }

  logger?.warn('Khong lay duoc Google Search Suggestions.', { code: WARNING_CODES.SUGGESTIONS_NOT_FOUND });
  warnings.push(WARNING_CODES.SUGGESTIONS_NOT_FOUND);
  return { items: [], source: 'none', warnings };
}

/**
 * Dong bi gan nhan "lich su ca nhan" nhung endpoint trung lap CUNG tra ve
 * thi that ra la goi y that -> lay lai.
 */
export function rescueFlagged(flagged, endpointItems, logger) {
  if (!flagged.length || !endpointItems.length) return [];
  const neutral = new Set(endpointItems.map((s) => s.toLowerCase().trim()));
  const rescued = flagged.filter((text) => neutral.has(String(text).toLowerCase().trim()));
  if (rescued.length) {
    logger?.info(
      `Lay lai ${rescued.length} goi y bi gan nham la lich su ca nhan ` +
      '(endpoint trung lap cung tra ve chung).',
    );
  }
  return rescued;
}

/** Nhan nguon trung thuc theo phan dong gop that su. */
export function pickSource(domCount, rescuedCount, endpointCount) {
  if (domCount + rescuedCount > 0 && endpointCount > 0) return 'google_suggest_dom+endpoint';
  if (domCount + rescuedCount > 0) return 'google_suggest_dom';
  if (endpointCount > 0) return 'google_autocomplete_endpoint';
  return 'none';
}

/**
 * Buoc 1: dua con tro vao o tim kiem va lam dropdown goi y hien ra.
 * Go lai ky tu cuoi de Google phat sinh goi y moi. KHONG submit.
 * @returns {Promise<boolean>}
 */
export async function openSuggestionDropdown(args) {
  const { page, selectors, logger, keyword } = args;
  const sel = selectors.google_suggestions ?? {};

  const box = await firstVisible(page, sel.search_box, {
    timeout: 8000, perSpec: 2500, logger, block: 'google_suggestions.search_box',
  });
  if (!box) return false;

  const text = String(keyword ?? '');
  const head = text.slice(0, -1);
  const tail = text.slice(-1) || ' ';

  try {
    await page.bringToFront().catch(() => {});
    await box.locator.click({ timeout: 5000 });
    await box.locator.fill(head, { timeout: 5000 });
    await sleep(400);
    if (typeof box.locator.pressSequentially === 'function') {
      await box.locator.pressSequentially(tail, { delay: 120 });
    } else {
      await box.locator.type(tail, { delay: 120 });
    }
  } catch (err) {
    logger?.debug(`Khong go lai duoc keyword: ${err.message}`);
    return false;
  }

  // Cho dropdown xuat hien
  const listbox = await firstVisible(page, sel.listbox, {
    timeout: 5000, perSpec: 1500, logger, block: 'google_suggestions.listbox',
  });
  if (!listbox) {
    logger?.debug('Dropdown goi y khong xuat hien sau khi go lai keyword.');
    return false;
  }
  await settleDropdown(page, sel, logger);
  return true;
}

/**
 * Doi dropdown NGUNG THAY DOI truoc khi doc.
 *
 * Google ve dropdown hai nhip: nhip dau la lich su tim kiem cua tai khoan (co
 * san trong may), nhip sau moi la goi y that tra ve tu mang. Doc ngay sau nhip
 * dau thi chi thay may dong lich su - va neu bat
 * exclude_personalized_suggestions thi tat ca deu bi loai, ket qua ra 0 muc
 * (loi that, run 2026-08-27: 2 dong doc duoc, ca 2 deu la lich su).
 */
async function settleDropdown(page, sel, logger, opts = {}) {
  const deadline = Date.now() + (opts.timeoutMs ?? 3000);
  const pollMs = opts.pollMs ?? 300;
  const selectors = cssSpecs(sel.option_nodes);
  let last = -1;
  let stableSince = Date.now();

  while (Date.now() < deadline) {
    await sleep(pollMs);
    const count = await countOptions(page, cssSpecs(sel.listbox), selectors);
    if (count !== last) {
      last = count;
      stableSince = Date.now();
      continue;
    }
    // On dinh du lau va da co dong -> doc duoc roi.
    if (count > 0 && Date.now() - stableSince >= (opts.stableMs ?? 600)) return count;
  }
  logger?.debug(`Dropdown goi y chua on dinh sau khi doi; doc voi ${last} dong.`);
  return last;
}

/** Dem so dong dang co trong dropdown (khong co tac dung phu). */
async function countOptions(page, listboxSelectors, optionSelectors) {
  return page.evaluate((arg) => {
    let box = null;
    for (let i = 0; i < arg.listbox.length && !box; i += 1) {
      try { box = document.querySelector(arg.listbox[i]); } catch (e) { box = null; }
    }
    if (!box) return 0;
    for (let i = 0; i < arg.options.length; i += 1) {
      let found = [];
      try { found = box.querySelectorAll(arg.options[i]); } catch (e) { found = []; }
      if (found.length) return found.length;
    }
    return 0;
  }, { listbox: listboxSelectors, options: optionSelectors }).catch(() => 0);
}

/** Dong dropdown, khong submit goi y nao. */
async function closeDropdown(page) {
  await page.keyboard.press('Escape').catch(() => {});
}

/** Doc dropdown dang mo (khong co tac dung phu). */
async function readOpenDropdown(args) {
  const { page, config, selectors, logger } = args;
  const sel = selectors.google_suggestions ?? {};

  const result = await runExtractor(page, extractSuggestionDropdown, {
    options: {
      listboxSelectors: cssSpecs(sel.listbox),
      optionSelectors: cssSpecs(sel.option_nodes),
      entityMarkers: sel.entity_label_markers ?? [],
      controlSelectors: cssSpecs(sel.control_nodes),
      deleteSelectors: cssSpecs(sel.delete_nodes),
      controlWords: sel.control_words ?? [],
      excludePersonalized: config.extractors.exclude_personalized_suggestions !== false,
      stripEntityLabels: true,
      maxItems: 20,
    },
  });

  const warnings = [];
  const flagged = result?.personalized ?? [];
  if (flagged.length) {
    logger?.warn(
      `Da gan nhan ${flagged.length} dong dropdown la lich su tim kiem ca nhan.`,
      {
        code: WARNING_CODES.SUGGESTIONS_PERSONALIZED,
        // Ghi ca LY DO de chan doan duoc khi bo loc bao nham
        flagged: flagged.map((p) => (typeof p === 'string' ? { text: p, reason: '?' } : p)),
      },
    );
    warnings.push(WARNING_CODES.SUGGESTIONS_PERSONALIZED);
  }

  const items = normalizeList(result?.items ?? [], { minLength: 2 });
  // Ghi ca TONG SO DONG doc duoc: khong co no thi "0 muc" co the la
  // "dropdown rong" hay "loc vut het" deu duoc, khong chan doan noi.
  logger?.info(
    `Suggestions tu DOM dropdown: ${items.length}/${result?.totalRows ?? 0} dong `
    + `(${flagged.length} dong bi gan nhan ca nhan).`,
  );
  return {
    items,
    flagged: flagged.map((p) => (typeof p === 'string' ? p : p.text)),
    source: items.length ? 'google_suggest_dom' : 'none',
    warnings,
  };
}

/**
 * Buoc 2-3: mo popup extension (duong dan lay tu manifest) va doc danh sach.
 * Goi SAU khi dropdown da mo, dung nhu thao tac tay.
 */
async function tryExtension(args) {
  const { page, selectors, logger, extensions, config } = args;
  const meta = extensions?.suggestions;
  if (!meta?.installed || !meta.popupUrl) {
    logger?.warn('Chua cai "Google Search Suggestion Extractor" hoac extension khong co popup.', {
      code: WARNING_CODES.EXTENSION_MISSING, extension: meta?.id,
    });
    return { items: [], source: 'none', warnings: [WARNING_CODES.EXTENSION_MISSING] };
  }

  const context = page.context();
  const popup = await context.newPage();
  try {
    await popup.goto(meta.popupUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.extractors.extension_timeout_ms ?? 20000,
    });
    await sleep(1500);

    const sel = selectors.extension_suggestions ?? {};
    let result = await runExtractor(popup, extractExtensionSuggestions, {
      options: { rowSelectors: cssSpecs(sel.rows), noise: sel.ui_noise ?? [], maxItems: 50 },
    });

    // Neu popup khong render san danh sach thi bam Copy roi doc clipboard
    if (!result?.items?.length) {
      const clicked = await clickFirstVisible(popup, sel.copy_all, {
        logger, block: 'extension_suggestions.copy_all', perSpec: 2000,
      });
      if (clicked) {
        await sleep(600);
        const text = await popup.evaluate(async () => {
          if (!navigator.clipboard || !navigator.clipboard.readText) return '';
          return navigator.clipboard.readText();
        }).catch(() => '');
        const items = String(text || '').split(/\r?\n/);
        result = { found: items.length > 0, items };
      }
    }

    const items = normalizeList(result?.items ?? [], { noise: sel.ui_noise ?? [], minLength: 2 });
    if (!items.length) {
      logger?.warn(
        'Popup extension khong tra ve suggestion nao. ' +
        'Co the extension can tab Google la tab dang active - se dung DOM fallback.',
        { code: WARNING_CODES.EXTENSION_POPUP_UNUSABLE },
      );
      return { items: [], source: 'none', warnings: [WARNING_CODES.EXTENSION_POPUP_UNUSABLE] };
    }
    return { items, source: 'google_suggestion_extension', warnings: [] };
  } finally {
    await popup.close().catch(() => {});
    await page.bringToFront().catch(() => {});
  }
}

/**
 * Parse phan hoi cua endpoint complete/search.
 * Tach rieng de test duoc khi Google doi dinh dang.
 * @param {string} raw
 * @returns {{ok:boolean, items:string[]}}
 */
export function parseAutocompleteResponse(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, items: [] };
  try {
    const parsed = JSON.parse(text);
    // Dinh dang client=chrome: [query, [suggestions], ...]
    if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
      const items = parsed[1]
        .map((entry) => (typeof entry === 'string' ? entry : entry?.[0]))
        .filter((v) => typeof v === 'string');
      return { ok: true, items };
    }
    return { ok: false, items: [] };
  } catch {
    return { ok: false, items: [] };
  }
}

/**
 * Nguon du phong: endpoint goi y cong khai cua Google.
 * Dung page.request de dung chung cookie/geo cua context, khong fetch tu Node.
 *
 * Luu y: endpoint nay khong nam trong tai lieu chinh thuc cua Google va co the
 * doi bat cu luc nao - vi vay no la fallback, khong phai nguon chinh.
 */
async function tryAutocompleteEndpoint(page, keyword, config, logger) {
  const domain = config.search.domain || 'www.google.com';
  const url = `https://${domain}/complete/search?client=chrome`
    + `&hl=${config.search.language}&gl=${config.search.country}`
    + `&q=${encodeURIComponent(keyword)}`;
  try {
    const res = await page.request.get(url, { timeout: 10000 });
    const parsed = parseAutocompleteResponse(await res.text());
    if (!parsed.ok) {
      logger?.warn('Endpoint goi y tra ve dinh dang la, khong parse duoc.', {
        code: WARNING_CODES.SUGGESTIONS_ENDPOINT_PARSE_FAILED, url,
      });
      return { items: [], source: 'none', warnings: [WARNING_CODES.SUGGESTIONS_ENDPOINT_PARSE_FAILED] };
    }
    const items = normalizeList(parsed.items, { minLength: 2 });
    if (items.length) logger?.info(`Suggestions tu endpoint complete/search: ${items.length} muc.`);
    return { items, source: 'google_autocomplete_endpoint', warnings: [] };
  } catch (err) {
    // Truoc day dong nay o muc debug nen khi dropdown bi loc sach, run that
    // 2026-08-27 chi de lai "Khong lay duoc Google Search Suggestions" ma
    // khong he cho biet nguon du phong da hong vi cai gi.
    logger?.warn(`Khong goi duoc endpoint goi y cua Google: ${err.message}`, {
      code: WARNING_CODES.SUGGESTIONS_ENDPOINT_PARSE_FAILED, url,
    });
    return {
      items: [], source: 'none', warnings: [WARNING_CODES.SUGGESTIONS_ENDPOINT_PARSE_FAILED],
    };
  }
}

function cssSpecs(specs) {
  return (specs ?? []).filter((s) => s && s.type === 'css' && s.css).map((s) => s.css);
}

export const _internals = { readOpenDropdown, tryExtension };
