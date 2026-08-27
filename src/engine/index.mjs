/**
 * Chon engine trinh duyet cho mot lan chay.
 *
 * HAI ENGINE, CUNG MOT BE MAT API:
 *
 *  bridge (mac dinh, V2) - Mo tab NGAY TRONG cua so Chrome ma nguoi dung dang
 *      dung. Khong khoi dong tien trinh nao. Moi phien dang nhap (Google,
 *      Ahrefs) va moi extension san co deu dung duoc ngay. Dieu khien bang
 *      chrome.debugger thong qua extension cau noi trong extension\.
 *
 *  playwright (V1)       - Khoi dong mot Chrome for Testing rieng voi profile
 *      rieng. Duong nay khong dung duoc phien dang nhap cua nguoi dung nhung
 *      chay duoc khong can ai ngoi truoc may, nen van huu ich cho chay tu dong.
 *
 * Ca hai deu tra ve doi tuong co cung hinh dang {browser, context, page, ...}
 * nen orchestrator va toan bo src/adapters/ khong phai biet dang chay engine nao.
 */
import { AppError } from '../core/errors.mjs';
import { ensureChrome } from '../browser/chrome-launcher.mjs';
import {
  connectCdp, primaryContext, acquirePage, grantClipboard, disconnect, verifyAttachedProfile,
} from '../browser/cdp-connector.mjs';
import { searchOrigin } from '../adapters/google-search.mjs';

import { BridgeServer } from '../bridge/bridge-server.mjs';
import { servePairingPage, openPairingPage } from './pairing.mjs';
import { connectViaBridge } from './remote-browser.mjs';
import {
  BRIDGE_EXTENSION_ID, BRIDGE_EXTENSION_DIR, verifyBridgeExtension, installInstructions,
} from './bridge-extension.mjs';

export const ENGINES = { BRIDGE: 'bridge', PLAYWRIGHT: 'playwright' };

/**
 * Engine nao se duoc dung: co CLI -> config -> mac dinh 'bridge'.
 */
export function resolveEngine(config, options = {}) {
  const requested = options.engine ?? config?.browser?.engine ?? ENGINES.BRIDGE;
  if (!Object.values(ENGINES).includes(requested)) {
    throw new AppError(
      'INVALID_CONFIG',
      `Engine khong hop le: "${requested}". Chi nhan: ${Object.values(ENGINES).join(' | ')}.`,
    );
  }
  return requested;
}

/**
 * Khoi dong engine da chon.
 *
 * @returns {Promise<{
 *   engine:string, browser:object, context:object, page:object,
 *   chromeVersion:string|null, close:()=>Promise<void>
 * }>}
 */
export async function startEngine({ config, logger, options = {} }) {
  const engine = resolveEngine(config, options);
  return engine === ENGINES.BRIDGE
    ? startBridgeEngine({ config, logger, options })
    : startPlaywrightEngine({ config, logger, options });
}

/* ------------------------------------------------------------ engine bridge */

async function startBridgeEngine({ config, logger, options }) {
  const check = verifyBridgeExtension();
  if (!check.ok) {
    throw new AppError(
      'BRIDGE_EXTENSION_INVALID',
      `Extension cau noi chua san sang:\n- ${check.problems.join('\n- ')}\n\n${installInstructions()}`,
    );
  }

  const bridge = new BridgeServer({
    port: config.bridge?.port ?? 0,
    logger,
    timeout: config.bridge?.call_timeout_ms ?? 30000,
  });
  const { port, token } = await bridge.start();
  servePairingPage(bridge.server.server, { token, port, extensionId: BRIDGE_EXTENSION_ID });

  logger?.info('Dang mo tab ghep noi trong trinh duyet cua ban...');
  openPairingPage(port, token, logger);

  const waitMs = config.bridge?.pair_timeout_ms ?? 120000;
  let info;
  try {
    info = await bridge.waitForClient(waitMs);
  } catch (err) {
    await bridge.close();
    throw new AppError(
      'BRIDGE_NOT_CONNECTED',
      'Khong ket noi duoc voi trinh duyet.\n\n'
      + 'Thuong la do extension cau noi chua duoc cai. Cach cai:\n'
      + `${installInstructions()}\n\n`
      + `Neu da cai roi: mo lai trang http://127.0.0.1:${port}/pair?token=${token} trong Chrome.`,
      { cause: err },
    );
  }

  const browser = await connectViaBridge({ bridge, logger });
  const context = browser.contexts()[0];
  const page = await context.newPage();

  if (config.browser?.viewport) {
    await page.setViewportSize(config.browser.viewport).catch(() => {});
  }

  logger?.info(
    `Engine: bridge - lam viec ngay trong Chrome cua ban `
    + `(${info.chromeVersion ?? '?'}), khong khoi dong trinh duyet moi.`,
  );

  return {
    engine: ENGINES.BRIDGE,
    browser,
    context,
    page,
    bridge,
    chromeVersion: info.chromeVersion ? `Chrome/${info.chromeVersion}` : null,
    // Engine nay KHONG dong Chrome cua nguoi dung. No chi dong nhung tab do
    // chinh no mo va ngat cau noi.
    close: async () => {
      await browser.close().catch(() => {});
      await bridge.close().catch(() => {});
    },
  };
}

/* -------------------------------------------------------- engine playwright */

async function startPlaywrightEngine({ config, logger, options }) {
  const chrome = await ensureChrome(config, logger);
  const browser = await connectCdp({ port: chrome.port, logger });
  const context = primaryContext(browser);

  if (config.browser?.verify_profile !== false) {
    await verifyAttachedProfile(context, config.browser.user_data_dir, logger);
  }

  const page = await acquirePage(context, { viewport: config.browser.viewport });
  await grantClipboard(context, searchOrigin(config), logger);

  logger?.info('Engine: playwright - dang dung Chrome for Testing voi profile rieng.');

  return {
    engine: ENGINES.PLAYWRIGHT,
    browser,
    context,
    page,
    chromeVersion: chrome.version?.Browser ?? null,
    close: async () => { await disconnect(browser, logger); },
  };
}

export { BRIDGE_EXTENSION_ID, BRIDGE_EXTENSION_DIR };
