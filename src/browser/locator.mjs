/**
 * Selector registry runtime (dac ta muc 7).
 * Dich mot spec trong selectors.yaml thanh Playwright Locator theo thu tu uu tien:
 *   role + accessible name -> text anchor -> attribute/css -> structural fingerprint.
 * Luon kiem tra visible truoc khi dung; khong dung toa do; khong nth() khi chua khoa container.
 */
import { toRegExp } from '../core/text.mjs';
import { NO_SELECTOR_MEMORY, specKey } from './selector-memory.mjs';

/**
 * @param {import('playwright-core').Page|import('playwright-core').Locator} scope
 * @param {{type:string, role?:string, name?:string, text?:string, css?:string, up?:number}} spec
 */
export function buildLocator(scope, spec) {
  if (!spec || !spec.type) return null;
  switch (spec.type) {
    case 'role': {
      const name = spec.name ? toRegExp(spec.name) : undefined;
      return scope.getByRole(spec.role, name ? { name } : undefined);
    }
    case 'text': {
      const re = toRegExp(spec.text);
      return re ? scope.getByText(re) : null;
    }
    case 'css':
      return spec.css ? scope.locator(spec.css) : null;
    case 'text_container': {
      const re = toRegExp(spec.text);
      if (!re) return null;
      const up = Math.max(1, spec.up ?? 3);
      const xpath = new Array(up).fill('..').join('/');
      return scope.getByText(re).first().locator(`xpath=${xpath}`);
    }
    default:
      return null;
  }
}

export function describeSpec(spec) {
  if (!spec) return 'none';
  if (spec.type === 'role') return `role=${spec.role}[name=${spec.name ?? ''}]`;
  if (spec.type === 'text') return `text=${spec.text}`;
  if (spec.type === 'css') return `css=${spec.css}`;
  if (spec.type === 'text_container') return `text_container=${spec.text}^${spec.up ?? 3}`;
  return JSON.stringify(spec);
}

/**
 * Tra ve locator dau tien nhin thay duoc trong danh sach spec.
 *
 * SEMANTICS (Fast Path v1 - P0): `timeout` la DEADLINE TONG cho ca danh sach.
 *
 *   deadline = start + timeout
 *   moi spec chi duoc dung min(perSpec, deadline - now)
 *   het deadline tong thi dung
 *
 * Truoc day `timeout` chi ap cho spec DAU TIEN roi moi fallback duoc them
 * `perSpec` nua, nen `ahrefs_timeout_ms: 15000` thuc te la 15s + 4s + 4s + ...
 * (run that 20260827-171404: 23,1 giay chi de tim container Ahrefs).
 *
 * Khong truyen `timeout` thi giu nguyen hanh vi cu (perSpec cho tung spec) de
 * cac cho goi bang `{ perSpec }` khong bi cat ngan.
 *
 * Neu co `opts.memory` + `opts.block`, spec da thang o lan truoc duoc dua len
 * dau danh sach va SELECTOR_DRIFT chi ghi mot lan cho moi block.
 *
 * @returns {Promise<{locator:import('playwright-core').Locator, spec:object, index:number}|null>}
 */
export async function firstVisible(scope, specs, opts = {}) {
  const original = Array.isArray(specs) ? specs : [];
  if (!original.length) return null;

  const memory = opts.memory ?? NO_SELECTOR_MEMORY;
  const block = opts.block ?? null;
  const list = block ? memory.order(block, original) : original;

  const perSpec = opts.perSpec ?? 2500;
  // Chi ap deadline tong khi cho goi noi ro `timeout`. Khong noi thi giu nguyen
  // hanh vi cu (perSpec cho tung spec): cat ngan bua o day co the lam mat mot
  // fallback dang chay duoc chi vi may dang ban.
  const total = Number.isFinite(opts.timeout) ? Math.max(1, opts.timeout) : null;
  const deadline = total === null ? Infinity : Date.now() + total;
  const primary = original[0];

  for (let i = 0; i < list.length; i += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      opts.logger?.debug(
        `Het deadline tong ${total}ms khi tim ${block ?? 'selector'}; da thu ${i}/${list.length} spec.`,
      );
      break;
    }
    const spec = list[i];
    let locator;
    try {
      locator = buildLocator(scope, spec);
    } catch {
      continue;
    }
    if (!locator) continue;
    const target = locator.first();
    try {
      // eslint-disable-next-line no-await-in-loop
      await target.waitFor({ state: 'visible', timeout: Math.min(perSpec, remaining) });
      if (block) memory.remember(block, spec, primary);
      if (specKey(spec) !== specKey(primary) && opts.logger && block && memory.shouldLogDrift(block)) {
        opts.logger.selectorDrift(block, describeSpec(primary), describeSpec(spec));
      }
      return { locator: target, spec, index: original.indexOf(spec) };
    } catch {
      /* thu spec ke tiep trong phan deadline con lai */
    }
  }
  // Selector da ghi nho khong con dung -> quen di de lan sau duyet lai tu dau.
  if (block) memory.forget(block);
  return null;
}

/** Click phan tu dau tien nhin thay duoc. Tra ve true neu da click. */
export async function clickFirstVisible(scope, specs, opts = {}) {
  const found = await firstVisible(scope, specs, opts);
  if (!found) return false;
  await found.locator.click({ timeout: opts.clickTimeout ?? 5000 });
  opts.logger?.debug(`Da click ${describeSpec(found.spec)}`);
  return true;
}

/** Doc textContent cua phan tu dau tien nhin thay duoc. */
export async function textOfFirstVisible(scope, specs, opts = {}) {
  const found = await firstVisible(scope, specs, opts);
  if (!found) return null;
  return (await found.locator.textContent())?.trim() ?? '';
}

/** Kiem tra su ton tai (khong bat buoc visible) - dung cho marker dang generating. */
export async function anyPresent(scope, specs) {
  for (const spec of Array.isArray(specs) ? specs : []) {
    try {
      const locator = buildLocator(scope, spec);
      if (!locator) continue;
      if ((await locator.count()) > 0) return true;
    } catch { /* bo qua */ }
  }
  return false;
}
