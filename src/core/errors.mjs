/**
 * Error taxonomy (dac ta muc 13.1) va mapping sang exit code (muc 10.3).
 */

export const EXIT_CODES = {
  SUCCESS: 0,
  INVALID_INPUT: 1,
  BROWSER_SETUP: 2,
  CONSENT_LOGIN: 3,
  CAPTCHA: 4,
  AI_EXTRACTION: 5,
  SERP_EXTRACTION: 6,
  OUTPUT_VALIDATION: 7,
  UNKNOWN: 8,
};

/** code -> exit code */
export const ERROR_EXIT_MAP = {
  INVALID_INPUT: EXIT_CODES.INVALID_INPUT,
  INVALID_CONFIG: EXIT_CODES.INVALID_INPUT,
  OUTPUT_CONFLICT: EXIT_CODES.INVALID_INPUT,

  CHROME_NOT_FOUND: EXIT_CODES.BROWSER_SETUP,
  PROFILE_LOCKED: EXIT_CODES.BROWSER_SETUP,
  PROFILE_MISMATCH: EXIT_CODES.BROWSER_SETUP,
  EXTENSION_MISSING: EXIT_CODES.BROWSER_SETUP,
  CDP_CONNECT_FAILED: EXIT_CODES.BROWSER_SETUP,

  // Engine bridge (V2): loi khi noi vao trinh duyet cua nguoi dung.
  // Cung nhom exit code 2 vi ban chat giong nhau - khong dieu khien duoc trinh duyet.
  BRIDGE_NOT_CONNECTED: EXIT_CODES.BROWSER_SETUP,
  BRIDGE_EXTENSION_INVALID: EXIT_CODES.BROWSER_SETUP,
  BRIDGE_DISCONNECTED: EXIT_CODES.BROWSER_SETUP,
  BRIDGE_TIMEOUT: EXIT_CODES.BROWSER_SETUP,
  BRIDGE_CALL_FAILED: EXIT_CODES.BROWSER_SETUP,
  BRIDGE_TAB_NOT_OWNED: EXIT_CODES.BROWSER_SETUP,
  BRIDGE_UNKNOWN_METHOD: EXIT_CODES.BROWSER_SETUP,

  // Engine bridge: loi khi thao tac trong trang.
  PAGE_EVAL_FAILED: EXIT_CODES.UNKNOWN,
  PAGE_CLOSED: EXIT_CODES.UNKNOWN,
  LOCATOR_NOT_FOUND: EXIT_CODES.UNKNOWN,
  LOCATOR_TIMEOUT: EXIT_CODES.UNKNOWN,
  CDP_EVENT_TIMEOUT: EXIT_CODES.UNKNOWN,
  UNSUPPORTED_EVENT: EXIT_CODES.UNKNOWN,

  GOOGLE_CONSENT: EXIT_CODES.CONSENT_LOGIN,
  MANUAL_LOGIN_REQUIRED: EXIT_CODES.CONSENT_LOGIN,

  MANUAL_CAPTCHA_REQUIRED: EXIT_CODES.CAPTCHA,

  AI_OVERVIEW_NOT_FOUND: EXIT_CODES.AI_EXTRACTION,
  AI_RESPONSE_TIMEOUT: EXIT_CODES.AI_EXTRACTION,
  AI_MODE_UNAVAILABLE: EXIT_CODES.AI_EXTRACTION,

  DOWNLOAD_TIMEOUT: EXIT_CODES.SERP_EXTRACTION,
  SERP_EXTRACTION_FAILED: EXIT_CODES.SERP_EXTRACTION,
  SERP_PAGE_DUPLICATE: EXIT_CODES.SERP_EXTRACTION,
  SERP_NAVIGATION_FAILED: EXIT_CODES.SERP_EXTRACTION,

  OUTPUT_VALIDATION_FAILED: EXIT_CODES.OUTPUT_VALIDATION,
  OUTPUT_WRITE_FAILED: EXIT_CODES.OUTPUT_VALIDATION,
};

/** Cac warning code khong lam fail run, chi ghi vao manifest/markdown. */
export const WARNING_CODES = {
  AHREFS_REGION_NOT_VERIFIED: 'AHREFS_REGION_NOT_VERIFIED',
  AHREFS_WIDGET_NOT_FOUND: 'AHREFS_WIDGET_NOT_FOUND',
  AHREFS_KEYWORD_IDEAS_UNAVAILABLE: 'AHREFS_KEYWORD_IDEAS_UNAVAILABLE',
  AHREFS_PAA_UNAVAILABLE: 'AHREFS_PAA_UNAVAILABLE',
  PAA_NOT_FOUND: 'PAA_NOT_FOUND',
  SUGGESTIONS_NOT_FOUND: 'SUGGESTIONS_NOT_FOUND',
  SUGGESTIONS_PERSONALIZED: 'SUGGESTIONS_PERSONALIZED',
  SUGGESTIONS_PERSONALIZED_ONLY: 'SUGGESTIONS_PERSONALIZED_ONLY',
  SUGGESTIONS_ENDPOINT_PARSE_FAILED: 'SUGGESTIONS_ENDPOINT_PARSE_FAILED',
  EXTENSION_POPUP_UNUSABLE: 'EXTENSION_POPUP_UNUSABLE',
  EXTENSION_MISSING: 'EXTENSION_MISSING',
  AI_OVERVIEW_NOT_FOUND: 'AI_OVERVIEW_NOT_FOUND',
  AI_MODE_UNAVAILABLE: 'AI_MODE_UNAVAILABLE',
  AI_RESPONSE_TIMEOUT: 'AI_RESPONSE_TIMEOUT',
  AI_PROMPT_SUBMIT_FAILED: 'AI_PROMPT_SUBMIT_FAILED',
  AI_SUBMIT_NO_PROGRESS: 'AI_SUBMIT_NO_PROGRESS',
  AI_COPY_STALE_CLIPBOARD: 'AI_COPY_STALE_CLIPBOARD',
  SELECTOR_DRIFT: 'SELECTOR_DRIFT',
  SERP_FALLBACK_USED: 'SERP_FALLBACK_USED',
  SERP_EMPTY_PAGE: 'SERP_EMPTY_PAGE',
  SERP_MORE_RESULTS_THAN_EXPECTED: 'SERP_MORE_RESULTS_THAN_EXPECTED',
  SERP_PARAM_MISMATCH: 'SERP_PARAM_MISMATCH',
  PAGES_CLAMPED: 'PAGES_CLAMPED',
  OUTPUT_CONFLICT_RESOLVED: 'OUTPUT_CONFLICT_RESOLVED',
  PROFILE_NOT_VERIFIED: 'PROFILE_NOT_VERIFIED',
  STEP_RETRY: 'STEP_RETRY',
  SELECTOR_SPEC_IGNORED: 'SELECTOR_SPEC_IGNORED',
  SELECTOR_STALE: 'SELECTOR_STALE',
  AHREFS_NOT_LOGGED_IN: 'AHREFS_NOT_LOGGED_IN',
  AHREFS_SCOPE_SHADOW: 'AHREFS_SCOPE_SHADOW',
  AHREFS_SCOPE_FRAME: 'AHREFS_SCOPE_FRAME',
  SUGGESTIONS_EXPANSION_TRUNCATED: 'SUGGESTIONS_EXPANSION_TRUNCATED',
  SUGGESTIONS_MANUAL_TIMEOUT: 'SUGGESTIONS_MANUAL_TIMEOUT',
};

/**
 * Muc do cua canh bao (dac ta v2.0 §6).
 *
 * Van de o v1.0: MOI canh bao deu lam status = COMPLETED_WITH_WARNINGS, nen
 * nguoi dung nhin quen mat va khong con phan biet duoc "dung fallback nhung du
 * lieu van dung" voi "mat han mot section".
 *
 *   INFO  - dung fallback, du lieu van du       -> KHONG doi status
 *   WARN  - du lieu thieu hoac nghi ngo         -> COMPLETED_WITH_WARNINGS
 *   ERROR - mot section bat buoc bi rong        -> COMPLETED_WITH_WARNINGS + neu ro
 */
export const SEVERITY = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' };

export const WARNING_SEVERITY = {
  // INFO - co fallback gánh, du lieu van dung
  SELECTOR_DRIFT: SEVERITY.INFO,
  SELECTOR_SPEC_IGNORED: SEVERITY.INFO,
  SELECTOR_STALE: SEVERITY.INFO,
  SERP_MORE_RESULTS_THAN_EXPECTED: SEVERITY.INFO,
  OUTPUT_CONFLICT_RESOLVED: SEVERITY.INFO,
  STEP_RETRY: SEVERITY.INFO,
  SUGGESTIONS_PERSONALIZED: SEVERITY.INFO,
  SUGGESTIONS_EXPANSION_TRUNCATED: SEVERITY.INFO,
  AHREFS_SCOPE_SHADOW: SEVERITY.INFO,
  AHREFS_SCOPE_FRAME: SEVERITY.INFO,

  // WARN - du lieu con nhung dang nghi ngo
  AHREFS_REGION_NOT_VERIFIED: SEVERITY.WARN,
  SERP_FALLBACK_USED: SEVERITY.WARN,
  AI_RESPONSE_TIMEOUT: SEVERITY.WARN,
  PROFILE_NOT_VERIFIED: SEVERITY.WARN,
  PAGES_CLAMPED: SEVERITY.WARN,
  SERP_PARAM_MISMATCH: SEVERITY.WARN,
  EXTENSION_MISSING: SEVERITY.WARN,
  EXTENSION_POPUP_UNUSABLE: SEVERITY.WARN,
  SUGGESTIONS_ENDPOINT_PARSE_FAILED: SEVERITY.WARN,
  SUGGESTIONS_MANUAL_TIMEOUT: SEVERITY.WARN,
  AHREFS_PAA_UNAVAILABLE: SEVERITY.WARN,

  // ERROR - mat han mot section bat buoc
  AHREFS_KEYWORD_IDEAS_UNAVAILABLE: SEVERITY.ERROR,
  AHREFS_WIDGET_NOT_FOUND: SEVERITY.ERROR,
  AHREFS_NOT_LOGGED_IN: SEVERITY.ERROR,
  SUGGESTIONS_NOT_FOUND: SEVERITY.ERROR,
  SUGGESTIONS_PERSONALIZED_ONLY: SEVERITY.ERROR,
  PAA_NOT_FOUND: SEVERITY.ERROR,
  AI_OVERVIEW_NOT_FOUND: SEVERITY.ERROR,
  AI_MODE_UNAVAILABLE: SEVERITY.ERROR,
  // Da dan prompt nhung khong gui duoc - thuong la bam nham control cua UI khac
  // (run that 20260827-153106: bam trung nut Search cua Google -> SERP reload).
  AI_PROMPT_SUBMIT_FAILED: SEVERITY.ERROR,
  // O nhap bi xoa (giao dien nhan prompt) nhung KHONG co loading/response nao
  // sinh ra trong dung khoi AI. Truoc day tinh huong nay im lang cho het 120s
  // (run that 20260827-171404: 120,5 giay cho mot nut Copy khong bao gio toi).
  AI_SUBMIT_NO_PROGRESS: SEVERITY.ERROR,
  // Bam Copy nhung clipboard khong doi -> noi dung dang giu la cua buoc TRUOC do
  // (run that 20260827-152533: 4 cau PAA cua Ahrefs lot vao muc AI Mode).
  AI_COPY_STALE_CLIPBOARD: SEVERITY.ERROR,
  SERP_EMPTY_PAGE: SEVERITY.ERROR,
};

/**
 * Muc do cua mot ma canh bao.
 * @param {string} code
 * @param {{strictSelectors?:boolean}} [opts] strict_selectors nang SELECTOR_DRIFT len WARN
 */
export function severityOf(code, opts = {}) {
  if (opts.strictSelectors && code === 'SELECTOR_DRIFT') return SEVERITY.WARN;
  return WARNING_SEVERITY[code] ?? SEVERITY.WARN;
}

/** Canh bao nao lam ban status (WARN tro len). */
export function affectsStatus(code, opts = {}) {
  return severityOf(code, opts) !== SEVERITY.INFO;
}

/** Gom canh bao theo muc do. */
export function groupBySeverity(codes, opts = {}) {
  const out = { INFO: [], WARN: [], ERROR: [] };
  for (const code of codes ?? []) {
    if (!code) continue;
    out[severityOf(code, opts)].push(code);
  }
  return out;
}

export class AppError extends Error {
  /**
   * @param {string} code ma loi trong ERROR_EXIT_MAP
   * @param {string} message thong diep cho nguoi dung
   * @param {{cause?:Error, details?:object, retryable?:boolean, manual?:boolean}} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.details = opts.details || {};
    this.retryable = opts.retryable === true;
    this.manual = opts.manual === true;
  }

  get exitCode() {
    return ERROR_EXIT_MAP[this.code] ?? EXIT_CODES.UNKNOWN;
  }
}

/** Loi yeu cau nguoi dung thao tac tay (login / captcha). */
export class ManualActionRequired extends AppError {
  constructor(code, message, details = {}) {
    super(code, message, { details, manual: true });
    this.name = 'ManualActionRequired';
  }
}

export function toExitCode(error) {
  if (!error) return EXIT_CODES.SUCCESS;
  if (error instanceof AppError) return error.exitCode;
  return EXIT_CODES.UNKNOWN;
}

export function describeError(error) {
  if (!error) return '';
  const code = error instanceof AppError ? error.code : 'UNEXPECTED_ERROR';
  return `[${code}] ${error.message}`;
}
