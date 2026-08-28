/**
 * Bo nho selector trong MOT run (dac ta Fast Path v1 - P0 "Deadline selector tong").
 *
 * VAN DE THAT (run 20260827-171404):
 *   Selector CSS chinh cua ahrefs_widget.container da drift. Moi lan can widget,
 *   firstVisible() lai duyet lai tu dau:
 *     css=[id*='ahrefs']  -> het timeout
 *     css=[class*='ahrefs'] -> het timeout
 *     div[data-ahrefs-widget] -> het timeout
 *     text_container=^keywords ideas$ -> THANH CONG
 *   Keywords Ideas mat 23,1 giay; PAA lap lai y nguyen va mat them 23,2 giay.
 *
 * CACH SUA:
 *   Ghi lai spec da THANG cho tung block. Lan sau dua no len dau danh sach.
 *   Chi ghi khi da xac minh tren DOM that (firstVisible tra ve locator visible),
 *   khong doan tu config.
 *
 * Bo nho nay song theo run (tao trong orchestrator, truyen xuong adapter), khong
 * phai bien toan cuc: hai keyword chay noi tiep nhau van co bo nho rieng.
 */

/** Khoa dinh danh cua mot spec - du de so sanh, khong phu thuoc thu tu key. */
export function specKey(spec) {
  if (!spec || typeof spec !== 'object') return String(spec ?? '');
  const { type } = spec;
  if (type === 'role') return `role:${spec.role}:${spec.name ?? ''}`;
  if (type === 'text') return `text:${spec.text}`;
  if (type === 'css') return `css:${spec.css}`;
  if (type === 'text_container') return `text_container:${spec.text}:${spec.up ?? 3}`;
  return `json:${JSON.stringify(spec)}`;
}

export function createSelectorMemory() {
  /** @type {Map<string,{key:string, spec:object, primaryKey:string, hits:number}>} */
  const winners = new Map();
  const driftLogged = new Set();

  return {
    /** Dua spec da thang len dau, giu nguyen phan con lai lam du phong. */
    order(block, specs) {
      const list = Array.isArray(specs) ? specs : [];
      if (!block || list.length < 2) return list;
      const won = winners.get(block);
      if (!won) return list;
      const index = list.findIndex((spec) => specKey(spec) === won.key);
      if (index <= 0) return list;
      return [list[index], ...list.slice(0, index), ...list.slice(index + 1)];
    },

    /** Ghi nhan spec vua tim thay THAT tren DOM. */
    remember(block, spec, primarySpec) {
      if (!block || !spec) return;
      const key = specKey(spec);
      const current = winners.get(block);
      winners.set(block, {
        key,
        spec,
        primaryKey: specKey(primarySpec ?? spec),
        hits: current && current.key === key ? current.hits + 1 : 1,
      });
    },

    /** Selector cu doi UI giua run -> quen di de duyet lai tu dau. */
    forget(block) {
      winners.delete(block);
      driftLogged.delete(block);
    },

    /** Chi canh bao SELECTOR_DRIFT mot lan cho moi block trong ca run. */
    shouldLogDrift(block) {
      if (!block) return true;
      if (driftLogged.has(block)) return false;
      driftLogged.add(block);
      return true;
    },

    /** Da ghi nho gi cho block nay chua? */
    peek(block) {
      return winners.get(block) ?? null;
    },

    /** Danh sach fallback dang dung - ghi vao run-manifest.json. */
    fallbacks() {
      const out = [];
      for (const [block, won] of winners.entries()) {
        if (won.key === won.primaryKey) continue;
        out.push({ block, primary: won.primaryKey, used: won.key, hits: won.hits });
      }
      return out;
    },
  };
}

/** Bo nho rong - dung khi goi truc tiep locator ngoai workflow (test, tool). */
export const NO_SELECTOR_MEMORY = Object.freeze({
  order: (_block, specs) => (Array.isArray(specs) ? specs : []),
  remember() {},
  forget() {},
  shouldLogDrift: () => true,
  peek: () => null,
  fallbacks: () => [],
});
