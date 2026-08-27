/**
 * Thong tin ve extension cau noi do CHINH DU AN NAY viet (thu muc extension\).
 *
 * Khac han vendor\extensions\: ba extension o do la cua ben thu ba, tai tu Web
 * Store, va chi nap duoc bang --load-extension tren Chrome for Testing. Extension
 * o day la cua ta, duoc cai vao Chrome CA NHAN cua nguoi dung mot lan, va la
 * thu duy nhat cho phep tool cham vao phien lam viec that.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECT_ROOT } from '../core/config.mjs';
import { AppError } from '../core/errors.mjs';

export const BRIDGE_EXTENSION_DIR = path.join(PROJECT_ROOT, 'extension');

/**
 * Extension id duoc GHIM bang truong "key" trong manifest.json.
 *
 * Vi sao phai ghim: khi nap unpacked, Chrome sinh id tu duong dan cai dat neu
 * manifest khong co "key". Id doi theo tung may thi trang ghep noi - von goi
 * chrome.runtime.sendMessage toi mot id cu the - se khong bao gio tim thay
 * extension. Gia tri duoi day duoc suy ra tu "key" va da kiem chung tren
 * Chrome 152.
 */
export const BRIDGE_EXTENSION_ID = 'jcacglefgleiajjchmkgjmjkplekgloi';

/** Suy ra extension id tu truong "key" (cung thuat toan voi bundled-extensions). */
export function idFromKey(base64Key) {
  const der = Buffer.from(String(base64Key), 'base64');
  const digest = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return digest.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

/**
 * Kiem tra thu muc extension\ con nguyen ven va id van dung nhu da ghim.
 * @returns {{ok:boolean, id:string|null, version:string|null, problems:string[]}}
 */
export function verifyBridgeExtension(dir = BRIDGE_EXTENSION_DIR) {
  const problems = [];
  const manifestPath = path.join(dir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      id: null,
      version: null,
      problems: [`Khong tim thay ${manifestPath}. Ban cai dat bi thieu thu muc extension\\.`],
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { ok: false, id: null, version: null, problems: [`manifest.json khong doc duoc: ${err.message}`] };
  }

  for (const file of ['background.js', 'popup.html', 'popup.js']) {
    if (!fs.existsSync(path.join(dir, file))) problems.push(`Thieu file ${file}`);
  }

  let id = null;
  if (!manifest.key) {
    problems.push('manifest.json thieu truong "key" - extension id se doi theo tung may.');
  } else {
    id = idFromKey(manifest.key);
    if (id !== BRIDGE_EXTENSION_ID) {
      problems.push(
        `Extension id suy ra tu "key" la ${id}, khac voi id da ghim ${BRIDGE_EXTENSION_ID}. `
        + 'Trang ghep noi se khong tim thay extension.',
      );
    }
  }

  return { ok: problems.length === 0, id, version: manifest.version ?? null, problems };
}

/** Nem loi neu extension chua san sang de cai. */
export function assertBridgeExtension(dir = BRIDGE_EXTENSION_DIR) {
  const result = verifyBridgeExtension(dir);
  if (!result.ok) {
    throw new AppError(
      'BRIDGE_EXTENSION_INVALID',
      `Extension cau noi chua san sang:\n- ${result.problems.join('\n- ')}`,
    );
  }
  return result;
}

/** Huong dan cai dat, dung chung cho CLI va trang ghep noi. */
export function installInstructions(dir = BRIDGE_EXTENSION_DIR) {
  return [
    '  1. Mo Chrome, vao dia chi:  chrome://extensions',
    '  2. Bat "Developer mode" (goc tren ben phai)',
    '  3. Bam "Load unpacked" roi chon thu muc:',
    `       ${dir}`,
    '  4. Chay lai lenh nay.',
  ].join('\n');
}
