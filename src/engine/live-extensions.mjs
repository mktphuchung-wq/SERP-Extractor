/**
 * Phat hien extension NGAY TRONG trinh duyet dang chay (chi cho engine bridge).
 *
 * TAI SAO PHAI CO FILE NAY:
 *   discoverAll()/discoverEffective() trong src/browser/ chi biet doc thu muc
 *   <user_data_dir>\<Profile>\Extensions\ tren dia. Duong do dung cho engine
 *   playwright vi chinh tool khoi dong Chrome bang profile do.
 *
 *   Engine bridge thi nguoc lai: no gan vao Chrome ma NGUOI DUNG dang mo, va
 *   khong he biet profile do nam o dau. Truoc day orchestrator xu ly bang cach
 *   dat state.extensions = {} - hau qua la moi adapter doc `extensions.x.installed`
 *   deu thay `undefined` va ket luan "chua cai", nen SEO SERP Extraction Tool
 *   khong bao gio duoc goi va CSV luon roi ve native extractor
 *   (run that 2026-08-27: "Chua cai \"SEO SERP Extraction Tool\"" du extension
 *   dang bat trong chinh trinh duyet do).
 *
 * CACH LAM:
 *   Mo mot tab nen roi dieu huong toi chrome-extension://<id>/manifest.json.
 *   Dieu huong do la browser-initiated (giong go vao thanh dia chi) nen khong
 *   bi rang buoc web_accessible_resources. Extension chua cai / dang tat thi
 *   trang khong tai duoc va ta bao "chua cai" - dung su that, khong doan.
 *
 * Tab nay mo o che do NEN (active: false). No chi doc text, khong can su kien
 * chuot/ban phim, nen han che cua tab nen (xem RemotePage._ensureVisible)
 * khong anh huong; doi lai no khong cuop man hinh cua nguoi dung.
 */
import { describeManifest } from '../browser/extension-discovery.mjs';

/** Ten file popup thuong gap, dung khi doc duoc manifest that bai. */
const POPUP_GUESSES = ['popup.html', 'popup/popup.html', 'index.html', 'html/popup.html'];

/**
 * Doc trang thai that cua tat ca extension khai bao trong config.
 *
 * @param {{context:object, config:object, logger?:object, timeoutMs?:number}} args
 * @returns {Promise<Record<string, object>>} cung hinh dang voi discoverEffective()
 */
export async function discoverLive(args) {
  const { context, config, logger } = args;
  const timeoutMs = args.timeoutMs ?? 8000;
  const entries = Object.entries(config.extensions ?? {});
  const out = {};
  if (!entries.length) return out;

  let probe = null;
  try {
    probe = await context.newPage({ active: false });
  } catch (err) {
    logger?.warn(
      `Khong mo duoc tab de kiem tra extension: ${err.message}. `
      + 'Se coi nhu khong dung duoc extension nao.',
      { code: 'EXTENSION_PROBE_FAILED' },
    );
    for (const [key, meta] of entries) {
      out[key] = notInstalled(key, meta, 'PROBE_TAB_FAILED');
    }
    return out;
  }

  try {
    for (const [key, meta] of entries) {
      // Tuan tu: chung mot tab nen khong the chay song song.
      // eslint-disable-next-line no-await-in-loop
      out[key] = await probeOne(probe, key, meta, timeoutMs);
      // Ly do that bai duoc noi ra ngay: neu khong, mot loi CDP se im lang
      // bien thanh "chua cai" va ta lai roi ve dung cai bug cu.
      if (!out[key].installed && out[key].detail) {
        logger?.debug(`Kiem tra "${meta.name}": ${out[key].detail}`);
      }
    }
  } finally {
    await probe.close().catch(() => {});
  }
  return out;
}

/** Ket qua "khong dung duoc", giu dung cac truong ma orchestrator dang log. */
function notInstalled(key, meta, reason) {
  return {
    installed: false,
    id: meta.id,
    configuredName: meta.name,
    webstore: meta.webstore,
    source: 'live',
    reason,
  };
}

/**
 * Kiem tra MOT extension.
 * @returns {Promise<object>}
 */
async function probeOne(page, key, meta, timeoutMs) {
  const { manifest, detail } = await readManifest(page, meta.id, timeoutMs);
  if (manifest) {
    return {
      ...describeManifest(manifest, meta.id),
      id: meta.id,
      configuredName: meta.name,
      webstore: meta.webstore,
      source: 'live',
      profileDir: null,
    };
  }

  // manifest.json khong doc duoc (Chrome co the tu choi hien no o top-level).
  // Thu tim thang trang popup: neu no tai duoc thi extension CHAC CHAN dang bat.
  const popupUrl = await findPopup(page, meta.id, timeoutMs);
  if (popupUrl) {
    return {
      installed: true,
      id: meta.id,
      name: meta.name,
      configuredName: meta.name,
      webstore: meta.webstore,
      version: null,
      popupUrl,
      optionsUrl: null,
      source: 'live',
      profileDir: null,
      reason: 'MANIFEST_UNREADABLE_POPUP_GUESSED',
    };
  }

  return { ...notInstalled(key, meta, 'NOT_IN_RUNNING_BROWSER'), detail };
}

/**
 * Mo chrome-extension://<id>/manifest.json va parse.
 * @returns {Promise<{manifest:object|null, detail:string}>}
 */
async function readManifest(page, extensionId, timeoutMs) {
  const url = `chrome-extension://${extensionId}/manifest.json`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  } catch (err) {
    return { manifest: null, detail: `dieu huong that bai: ${err.message}` };
  }
  // Chrome khong dieu huong sang URL bi chan; URL con nguyen o trang truoc do.
  const landed = await page.syncUrl().catch(() => '');
  if (!String(landed).startsWith(`chrome-extension://${extensionId}/`)) {
    return { manifest: null, detail: `khong vao duoc trang, dung lai o: ${landed || '?'}` };
  }

  let text = '';
  try {
    text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
  } catch (err) {
    return { manifest: null, detail: `khong doc duoc noi dung trang: ${err.message}` };
  }
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('{')) {
    return { manifest: null, detail: `trang khong phai JSON (bat dau bang "${trimmed.slice(0, 20)}")` };
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') return { manifest: parsed, detail: 'ok' };
    return { manifest: null, detail: 'JSON khong phai doi tuong' };
  } catch (err) {
    return { manifest: null, detail: `JSON hong: ${err.message}` };
  }
}

/**
 * Duong du phong: thu vai ten file popup pho bien.
 * @returns {Promise<string|null>}
 */
async function findPopup(page, extensionId, timeoutMs) {
  for (const name of POPUP_GUESSES) {
    const url = `chrome-extension://${extensionId}/${name}`;
    try {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const landed = await page.syncUrl().catch(() => '');
    if (landed !== url) continue;
    // eslint-disable-next-line no-await-in-loop
    const ok = await page
      .evaluate(() => Boolean(document.body && document.body.innerHTML.trim().length > 0))
      .catch(() => false);
    if (ok) return url;
  }
  return null;
}

export const _internals = { probeOne, readManifest, findPopup, POPUP_GUESSES };
