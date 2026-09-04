/**
 * Logger cho tung run: ghi run.log (human) + run.jsonl (may doc) + screenshot loi.
 * Log nam trong logs\<run_id>\, KHONG bao gio nam trong output folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import { severityOf } from './errors.mjs';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACT_KEYS = /(cookie|authorization|password|token|secret|api[-_]?key|session)/i;

/** Bo cac gia tri nhay cam truoc khi ghi log. */
export function redact(value, enabled = true, depth = 0) {
  if (!enabled || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, enabled, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_KEYS.test(k) ? '[redacted]' : redact(v, enabled, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value
      .replace(/(SID|HSID|SSID|APISID|SAPISID|__Secure-[\w-]+)=[^;\s]+/gi, '$1=[redacted]')
      .replace(/(authorization:\s*)\S+/gi, '$1[redacted]')
      .replace(/([?&](?:token|access_token|api[-_]?key|session)=)[^&#\s)]+/gi, '$1[redacted]');
  }
  return value;
}

export class RunLogger {
  /**
   * @param {{runDir:string, console?:boolean, level?:keyof LEVELS, redact?:boolean}} opts
   */
  constructor(opts) {
    this.runDir = opts.runDir;
    this.screenshotDir = path.join(this.runDir, 'screenshots');
    this.consoleEnabled = opts.console !== false;
    this.level = LEVELS[opts.level ?? 'info'];
    this.redactEnabled = opts.redact !== false;
    this.strictSelectors = opts.strictSelectors === true;
    this.warnings = [];
    this.steps = [];

    fs.mkdirSync(this.screenshotDir, { recursive: true });
    this.textPath = path.join(this.runDir, 'run.log');
    this.jsonPath = path.join(this.runDir, 'run.jsonl');
    this.textStream = fs.createWriteStream(this.textPath, { flags: 'a', encoding: 'utf8' });
    this.jsonStream = fs.createWriteStream(this.jsonPath, { flags: 'a', encoding: 'utf8' });
  }

  #write(level, message, data) {
    if (LEVELS[level] < this.level) return;
    const ts = new Date().toISOString();
    const safe = data === undefined ? undefined : redact(data, this.redactEnabled);
    const line = `${ts} [${level.toUpperCase().padEnd(5)}] ${message}` +
      (safe === undefined ? '' : ` ${safeJson(safe)}`);
    this.textStream.write(`${line}\n`);
    this.jsonStream.write(`${safeJson({ ts, level, message, data: safe })}\n`);
    if (this.consoleEnabled && LEVELS[level] >= LEVELS.info) {
      const prefix = level === 'error' ? '  [ERROR] ' : level === 'warn' ? '  [WARN]  ' : '  ';
      process.stdout.write(`${prefix}${message}\n`);
    }
  }

  debug(message, data) { this.#write('debug', message, data); }
  info(message, data) { this.#write('info', message, data); }
  error(message, data) { this.#write('error', message, data); }

  /** Warning co ma - duoc gom vao manifest va (neu can) vao Markdown. */
  warn(message, data) {
    this.#write('warn', message, data);
    const code = (data && typeof data === 'object' ? data.code : undefined) ?? 'WARNING';
    this.warnings.push({
      code,
      severity: severityOf(code, { strictSelectors: this.strictSelectors }),
      message,
      at: new Date().toISOString(),
    });
  }

  /** Ghi tien trinh dang [n/total] cho nguoi dung khong chuyen ky thuat. */
  step(index, total, message) {
    const line = `[${index}/${total}] ${message}`;
    this.steps.push({ index, total, message, at: new Date().toISOString() });
    this.#write('info', line);
  }

  /** Ghi lai viec phai dung fallback -> tin hieu UI da doi. */
  selectorDrift(block, primary, used) {
    this.warn(`Selector chinh cua "${block}" khong dung duoc, da dung fallback: ${used}`, {
      code: 'SELECTOR_DRIFT', block, primary, used,
    });
  }

  async screenshot(page, name) {
    if (!page) return null;
    const file = path.join(this.screenshotDir, `${Date.now()}-${name}.png`);
    try {
      await page.screenshot({ path: file, fullPage: false });
      this.info(`Da luu screenshot: ${file}`);
      return file;
    } catch (err) {
      this.debug(`Khong luu duoc screenshot: ${err.message}`);
      return null;
    }
  }

  /** Luu HTML snippet da redact de debug selector. */
  saveHtmlSnippet(name, html) {
    try {
      const file = path.join(this.runDir, `${name}.html`);
      const safe = redact(String(html ?? '').slice(0, 200_000), this.redactEnabled);
      fs.writeFileSync(file, safe, 'utf8');
      return file;
    } catch {
      return null;
    }
  }

  async close() {
    await Promise.all([
      new Promise((r) => this.textStream.end(r)),
      new Promise((r) => this.jsonStream.end(r)),
    ]);
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

/** Logger rong dung trong unit test. */
export function nullLogger() {
  const noop = () => {};
  return {
    warnings: [], steps: [],
    debug: noop, info: noop, warn: noop, error: noop, step: noop,
    selectorDrift: noop, saveHtmlSnippet: () => null,
    screenshot: async () => null, close: async () => {},
  };
}
