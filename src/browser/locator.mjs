/**
 * Selector registry runtime (dac ta muc 7).
 * Dich mot spec trong selectors.yaml thanh Playwright Locator theo thu tu uu tien:
 *   role + accessible name -> text anchor -> attribute/css -> structural fingerprint.
 * Luon kiem tra visible truoc khi dung; khong dung toa do; khong nth() khi chua khoa container.
 */
import { toRegExp } from '../core/text.mjs';

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
 * Neu phai dung spec thu 2 tro di -> ghi warning SELECTOR_DRIFT.
 * @returns {Promise<{locator:import('playwright-core').Locator, spec:object, index:number}|null>}
 */
export async function firstVisible(scope, specs, opts = {}) {
  const list = Array.isArray(specs) ? specs : [];
  const perSpec = opts.perSpec ?? 2500;
  const firstTimeout = opts.timeout ?? perSpec;

  for (let i = 0; i < list.length; i += 1) {
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
      await target.waitFor({ state: 'visible', timeout: i === 0 ? firstTimeout : perSpec });
      if (i > 0 && opts.logger && opts.block) {
        opts.logger.selectorDrift(opts.block, describeSpec(list[0]), describeSpec(spec));
      }
      return { locator: target, spec, index: i };
    } catch {
      /* thu spec ke tiep */
    }
  }
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
