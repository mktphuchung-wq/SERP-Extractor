/**
 * Thong bao hoan thanh (dac ta Step 10): console + am thanh + Windows toast.
 * CHI duoc goi sau khi quality gates da pass.
 */
import { spawn } from 'node:child_process';

/**
 * @param {{status:string, keyword:string, outputDir:string, counts:object, durationMs:number, warnings:Array}} summary
 */
export function renderConsoleSummary(summary) {
  const lines = [];
  const seconds = (summary.durationMs / 1000).toFixed(1);
  lines.push('');
  lines.push(summary.status === 'SUCCESS' ? 'SUCCESS' : summary.status);
  lines.push(`Keyword: ${summary.keyword}`);
  lines.push(`Folder:  ${summary.outputDir}`);
  lines.push(
    `Items:   AI ${summary.counts.ai_chars ?? 0} ky tu | ` +
    `Keywords Ideas ${summary.counts.keyword_ideas ?? 0} | ` +
    `PAA ${summary.counts.paa ?? 0} | ` +
    `Suggestions ${summary.counts.suggestions ?? 0} | ` +
    `Page 1 ${summary.counts.serp_page_1_rows ?? 0} dong | ` +
    `Page 2 ${summary.counts.serp_page_2_rows ?? 0} dong`,
  );
  lines.push(`Thoi gian: ${seconds}s`);
  // v2.0: tach theo muc do de nguoi dung biet cai nao that su dang lo
  const sev = summary.severity ?? {};
  const info = sev.INFO ?? [];
  const warn = sev.WARN ?? [];
  const error = sev.ERROR ?? [];
  if (info.length || warn.length || error.length) {
    lines.push(
      `Canh bao: ${error.length} ERROR | ${warn.length} WARN | ${info.length} INFO (fallback)`,
    );
    for (const code of error) lines.push(`  [ERROR] ${code}`);
    for (const code of warn) lines.push(`  [WARN ] ${code}`);
    if (info.length) lines.push(`  [INFO ] ${info.join(', ')}`);
  } else if (summary.warnings?.length) {
    lines.push(`Canh bao (${summary.warnings.length}): ${summary.warnings.join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Am thanh he thong Windows. */
export function beep(enabled) {
  if (!enabled) return;
  try {
    process.stdout.write(String.fromCharCode(7));
  } catch { /* bo qua */ }
}

/** Windows toast qua PowerShell (khong chan tien trinh chinh). */
export function windowsToast(enabled, title, message, logger) {
  if (!enabled || process.platform !== 'win32') return;
  const safeTitle = String(title).replace(/["`$]/g, ' ');
  const safeMessage = String(message).replace(/["`$]/g, ' ').slice(0, 300);
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;',
    '$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);',
    '$texts = $template.GetElementsByTagName("text");',
    `$texts.Item(0).AppendChild($template.CreateTextNode("${safeTitle}")) > $null;`,
    `$texts.Item(1).AppendChild($template.CreateTextNode("${safeMessage}")) > $null;`,
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($template);',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Auto SERP Research").Show($toast);',
  ].join(' ');

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: 'ignore', windowsHide: true, detached: true },
    );
    child.unref();
  } catch (err) {
    logger?.debug(`Khong gui duoc Windows toast: ${err.message}`);
  }
}

/**
 * @param {object} config
 * @param {{status:string, keyword:string, outputDir:string, counts:object, durationMs:number, warnings:Array}} summary
 */
export function notify(config, summary, logger) {
  const n = config.notifications ?? {};
  if (n.console !== false) process.stdout.write(renderConsoleSummary(summary));
  beep(n.sound !== false);
  windowsToast(
    n.windows_toast !== false,
    summary.status === 'SUCCESS' ? 'Auto SERP: Hoan thanh' : `Auto SERP: ${summary.status}`,
    `${summary.keyword} -> ${summary.outputDir}`,
    logger,
  );
}

/**
 * Mo file ket qua bang Notepad (hoac trinh soan thao trong config) ngay khi chay xong,
 * de nguoi dung khong phai tu di tim file.
 * Khong chan tien trinh chinh; loi mo file khong lam hong run.
 * @param {string} filePath
 */
export function openInEditor(filePath, config, logger) {
  if (!filePath) return false;
  if (config?.notifications?.open_result === false) return false;
  if (process.platform !== 'win32') return false;

  const editor = config?.notifications?.open_result_with || 'notepad.exe';
  try {
    const child = spawn(editor, [filePath], { stdio: 'ignore', detached: true, windowsHide: false });
    child.unref();
    logger?.info(`Da mo ket qua bang ${editor}: ${filePath}`);
    return true;
  } catch (err) {
    logger?.debug(`Khong mo duoc ${editor}: ${err.message}`);
    return false;
  }
}

/**
 * Mo mot thu muc bang Explorer de nguoi dung khong phai tu di tim.
 * Dung cho --capture-dom: sau khi chup xong thi mo thang thu muc snapshot.
 */
export function openFolder(dir, logger) {
  if (!dir || process.platform !== 'win32') return false;
  try {
    const child = spawn('explorer.exe', [dir], { stdio: 'ignore', detached: true, windowsHide: false });
    child.unref();
    return true;
  } catch (err) {
    logger?.debug(`Khong mo duoc thu muc ${dir}: ${err.message}`);
    return false;
  }
}

/** Thong bao that bai - khong bao gio dung chu SUCCESS. */
export function notifyFailure(config, { keyword, code, message, logDir }, logger) {
  const n = config.notifications ?? {};
  if (n.console !== false) {
    process.stdout.write(
      `\nFAILED\nKeyword: ${keyword}\nLoi: [${code}] ${message}\nLog: ${logDir}\n\n`,
    );
  }
  beep(n.sound !== false);
  windowsToast(n.windows_toast !== false, 'Auto SERP: Loi', `${code} - ${keyword}`, logger);
}
