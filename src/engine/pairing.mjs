/**
 * Ghep noi tool voi extension trong Chrome ca nhan.
 *
 * VAN DE CAN GIAI: extension phai biet cong va token cua lan chay nay. Bat
 * nguoi dung go tay mot chuoi hex 48 ky tu la khong chap nhan duoc.
 *
 * CACH GIAI: tool phuc vu mot trang HTML nho ngay tren chinh cong bridge
 * (http://127.0.0.1:<port>/pair?token=...). Trang do goi chrome.runtime.sendMessage
 * de trao token cho extension. Extension chi nhan ghep noi tu 127.0.0.1
 * (kiem tra trong background.js), nen mot trang web bat ky khong the tu ghep noi.
 *
 * Nguoi dung chi phai lam MOT viec: de yen cho tab tu mo roi tu dong.
 */
import { spawn } from 'node:child_process';
import { AppError } from '../core/errors.mjs';

/**
 * HTML cua trang ghep noi. Tu dong thu ghep, bao ket qua, roi tu dong.
 * @param {string} token
 * @param {number} port
 * @param {string} extensionId
 */
export function pairingPage(token, port, extensionId) {
  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>SERP Extractor - ghep noi</title>
<style>
 body{font:14px/1.6 system-ui,Segoe UI,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#202124}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#5f6368;margin:0 0 24px}
 .box{border:1px solid #dadce0;border-radius:8px;padding:16px 18px}
 .ok{border-color:#137333;background:#e6f4ea;color:#137333}
 .err{border-color:#c5221f;background:#fce8e6;color:#c5221f}
 ol{padding-left:20px} code{background:#f1f3f4;padding:1px 5px;border-radius:3px}
</style></head><body>
<h1>SERP Extractor</h1>
<p class="sub">Dang ket noi tool voi trinh duyet cua ban...</p>
<div id="s" class="box">Dang thu ghep noi...</div>
<script>
const EXT = ${JSON.stringify(extensionId)};
const box = document.getElementById('s');
function fail(msg, showHelp){
  box.className = 'box err';
  box.innerHTML = msg + (showHelp ? \`<ol>
    <li>Mo <code>chrome://extensions</code></li>
    <li>Bat <b>Developer mode</b> o goc tren ben phai</li>
    <li>Bam <b>Load unpacked</b> va chon thu muc <code>extension</code> trong thu muc tool</li>
    <li>Chay lai <code>RUN.bat</code></li></ol>\` : '');
}

// Service worker cua extension MV3 co the CHUA CHAY khi trang nay mo, nhat la
// khi Chrome vua khoi dong va mo thang vao day. Luc do sendMessage that bai voi
// "Receiving end does not exist" du extension da duoc cai dung.
// Vi vay phai thu lai: moi lan gui la mot lan Chrome co co hoi danh thuc worker.
const DEADLINE = Date.now() + 30000;
let attempt = 0;

function tryPair(){
  attempt += 1;
  chrome.runtime.sendMessage(EXT, { type:'pair', port:${port}, token:${JSON.stringify(token)} }, (res) => {
    const err = chrome.runtime.lastError;
    if (!err && res && res.ok) {
      box.className = 'box ok';
      box.textContent = 'Da ket noi. Tab nay se tu dong dong sau 2 giay.';
      setTimeout(() => window.close(), 2000);
      return;
    }
    if (!err && res && !res.ok) { fail('Ghep noi that bai: ' + res.error, false); return; }

    if (Date.now() < DEADLINE) {
      box.textContent = 'Dang danh thuc extension... (lan ' + attempt + ')';
      setTimeout(tryPair, 500);
      return;
    }
    fail('<b>Chua tim thay extension SERP Extractor Bridge.</b>', true);
  });
}

if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
  fail('Trang nay phai duoc mo bang Google Chrome.', false);
} else {
  tryPair();
}
</script></body></html>`;
}

/**
 * Gan handler phuc vu trang ghep noi vao HTTP server cua bridge.
 * @param {import('node:http').Server} server
 * @param {{token:string, port:number, extensionId:string}} opts
 */
export function servePairingPage(server, opts) {
  // Server cua ws-server.mjs da co san mot handler tra 426. Ta chen truoc no
  // de /pair duoc phuc vu, con moi duong dan khac giu nguyen hanh vi cu.
  const existing = server.listeners('request').slice();
  server.removeAllListeners('request');

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/pair') {
      if (url.searchParams.get('token') !== opts.token) {
        res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Token khong dung.\n');
        return;
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(pairingPage(opts.token, opts.port, opts.extensionId));
      return;
    }
    for (const handler of existing) handler(req, res);
  });
}

/**
 * Mo trang ghep noi bang trinh duyet MAC DINH cua nguoi dung.
 *
 * Dung `cmd /c start` chu khong tro thang toi chrome.exe: nho vay trang mo
 * trong dung cua so Chrome dang chay (dung phien lam viec hien tai), thay vi
 * khoi dong mot tien trinh moi - dung nhu muc tieu cua V2.
 */
export function openPairingPage(port, token, logger) {
  const url = `http://127.0.0.1:${port}/pair?token=${encodeURIComponent(token)}`;
  logger?.info(`Mo trang ghep noi: ${url}`);
  try {
    const child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch (err) {
    throw new AppError(
      'BRIDGE_NOT_CONNECTED',
      `Khong mo duoc trang ghep noi. Hay mo tay trong Chrome: ${url} (${err.message})`,
    );
  }
  return url;
}
