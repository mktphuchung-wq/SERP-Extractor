/**
 * Kha nang dung duoc cua extension (dac ta Fast Path v1 - P0 "Capability detection").
 *
 * VAN DE THAT (run 20260827-171404):
 *   Probe mo `chrome-extension://<id>/manifest.json` that bai -> ghi
 *   `installed:false` + `NOT_IN_RUNNING_BROWSER` cho ca ba extension. Ngay sau do
 *   widget Ahrefs VAN hien tren SERP va tool doc duoc 8 Keywords Ideas + 4 PAA
 *   qua clipboard cua chinh widget do. Nghia la ket luan "chua cai" la AM TINH GIA:
 *   probe chi chung minh "khong doc duoc trang cua extension", khong chung minh
 *   "extension chua cai".
 *
 * MO HINH MOI - ba trang thai, khong con boolean:
 *   installed / enabled : 'true' | 'false' | 'unknown'
 *   usable              : co bang chung dung duoc THAT trong run nay hay khong
 *   observed_by         : widget | management_api | popup_probe | native_fallback
 *   reason              : ly do cua ket luan
 *
 * Quy tac: chi `installed:'false'` moi duoc phep phat EXTENSION_MISSING.
 * `unknown` nghia la chua biet -> dung nguon thay the, khong keu ca.
 */

export const TRISTATE = Object.freeze({ TRUE: 'true', FALSE: 'false', UNKNOWN: 'unknown' });

export const OBSERVED_BY = Object.freeze({
  WIDGET: 'widget',
  MANAGEMENT_API: 'management_api',
  POPUP_PROBE: 'popup_probe',
  NATIVE_FALLBACK: 'native_fallback',
  PROFILE_DIR: 'profile_dir',
  BUNDLED: 'bundled',
});

/** Chuyen mot gia tri bat ky ve tristate. */
export function toTristate(value) {
  if (value === true || value === TRISTATE.TRUE) return TRISTATE.TRUE;
  if (value === false || value === TRISTATE.FALSE) return TRISTATE.FALSE;
  return TRISTATE.UNKNOWN;
}

/**
 * Chuan hoa mot ban ghi extension ve dung hinh dang capability.
 * Nhan ca ban ghi cu (installed: boolean tu discoverEffective/disk) lan ban moi.
 */
export function normalizeCapability(meta, extra = {}) {
  const source = meta ?? {};
  const installed = toTristate(source.installed);
  const enabled = source.enabled === undefined ? installed : toTristate(source.enabled);
  const observedBy = source.observed_by ?? source.observedBy ?? defaultObservedBy(source);
  const usable = source.usable === true
    || (installed === TRISTATE.TRUE && enabled !== TRISTATE.FALSE);

  return {
    ...source,
    configured: source.configured !== false,
    required: source.required === true,
    installed,
    enabled,
    usable,
    observed_by: observedBy,
    reason: source.reason ?? source.bundleReason ?? null,
    ...extra,
  };
}

function defaultObservedBy(meta) {
  if (meta.source === 'bundled') return OBSERVED_BY.BUNDLED;
  if (meta.profileDir) return OBSERVED_BY.PROFILE_DIR;
  if (meta.popupUrl) return OBSERVED_BY.POPUP_PROBE;
  return OBSERVED_BY.NATIVE_FALLBACK;
}

/** Co bang chung dung duoc that su khong? */
export function isUsable(meta) {
  if (!meta) return false;
  if (meta.usable === true) return true;
  return toTristate(meta.installed) === TRISTATE.TRUE && toTristate(meta.enabled) !== TRISTATE.FALSE;
}

/** CHAC CHAN chua cai/dang tat - chi truong hop nay moi duoc bao EXTENSION_MISSING. */
export function isDefinitelyMissing(meta) {
  if (!meta) return false;
  if (isUsable(meta)) return false;
  return toTristate(meta.installed) === TRISTATE.FALSE;
}

/** Chua du bang chung de ket luan gi. */
export function isUnknown(meta) {
  return !isUsable(meta) && !isDefinitelyMissing(meta);
}

/**
 * Ghi nhan bang chung truc tiep trong run: vi du widget Ahrefs da hien tren SERP.
 * Tra ve ban ghi MOI, khong sua tai cho.
 */
export function markObserved(meta, observedBy, reason) {
  return normalizeCapability({
    ...(meta ?? {}),
    installed: TRISTATE.TRUE,
    enabled: TRISTATE.TRUE,
    usable: true,
    observed_by: observedBy,
    reason: reason ?? meta?.reason ?? null,
  });
}

/** Ghi nhan "khong doc duoc trang extension" - KHONG duoc ket luan chua cai. */
export function markUnknown(meta, reason, observedBy = OBSERVED_BY.NATIVE_FALLBACK) {
  return normalizeCapability({
    ...(meta ?? {}),
    installed: TRISTATE.UNKNOWN,
    enabled: TRISTATE.UNKNOWN,
    usable: false,
    observed_by: observedBy,
    reason,
  });
}

/** Cau mo ta cho log/console. */
export function describeCapability(meta) {
  if (isUsable(meta)) return `dung duoc (${meta.observed_by ?? 'unknown'})`;
  if (isDefinitelyMissing(meta)) return `chua cai/dang tat (${meta.reason ?? 'khong ro ly do'})`;
  return `chua xac minh duoc (${meta.reason ?? 'khong doc duoc trang extension'})`;
}

/** Hinh dang ghi vao run-manifest.json. */
export function summariseCapability(meta) {
  return {
    id: meta?.id ?? null,
    configured: meta?.configured !== false,
    installed: toTristate(meta?.installed),
    enabled: meta?.enabled === undefined ? toTristate(meta?.installed) : toTristate(meta.enabled),
    usable: isUsable(meta),
    observed_by: meta?.observed_by ?? null,
    reason: meta?.reason ?? meta?.bundleReason ?? null,
    version: meta?.version ?? null,
    profile: meta?.profileDir ?? null,
  };
}
