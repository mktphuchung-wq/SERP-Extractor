/**
 * Service worker cua "SERP Extractor Bridge".
 *
 * Vai tro: dich cac loi goi tu tien trinh Node (qua WebSocket) thanh lenh CDP
 * gui bang chrome.debugger toi dung tab ma chinh extension nay tao ra.
 *
 * TAI SAO CAN chrome.debugger THAY VI chrome.scripting:
 *  - chrome.scripting chi chay duoc JavaScript. No khong tao duoc su kien ban phim
 *    hay chuot THAT (isTrusted=true). O tim kiem cua Google chi bung dropdown goi y
 *    khi nhan su kien that, nen chrome.scripting khong lam duoc buoc do.
 *  - Tu Chrome 152, AI Mode khong con nam trong tab ma bi nhet vao mot <webview>
 *    ben trong chrome://contextual-tasks/. Chi Target.getTargets qua CDP moi nhin
 *    thay va doc duoc noi dung do.
 *
 * DANH DOI: Chrome hien thanh vang "Extension ... dang go loi trinh duyet nay"
 * tren tab bi attach. Day la co che bao ve cua Chrome, khong tat duoc, va cung
 * la dieu tot: nguoi dung luon nhin thay khi nao tool dang dieu khien tab nao.
 */

const CDP_VERSION = '1.3';
const PING_INTERVAL_MS = 20000;
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 5000];

/** @type {WebSocket|null} */
let socket = null;
/** Cac debuggee dang attach: key la chuoi, value la doi tuong Debuggee. */
const attached = new Map();
/** Tab do chinh extension nay mo ra - chi nhung tab nay moi duoc phep dieu khien. */
const ownedTabs = new Set();
/** Download dang theo doi: id -> ban ghi. */
const downloads = new Map();
let pingTimer = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let intentionalShutdown = false;

/* ------------------------------------------------------------------ Ghep noi */

/**
 * Trang ghep noi do chinh tool phuc vu tren 127.0.0.1 se gui token sang day.
 * Nho vay nguoi dung khong phai go tay so cong hay token bao gio.
 */
function handleRuntimeMessage(msg, sender, sendResponse, { external }) {
  if (msg?.type === 'pair') {
    // Chi nhan token tu chinh trang ghep noi tren loopback.
    const url = sender?.url ?? '';
    if (external && !/^http:\/\/127\.0\.0\.1(:\d+)?\//.test(url)) {
      sendResponse({ ok: false, error: 'Chi nhan ghep noi tu 127.0.0.1.' });
      return true;
    }
    intentionalShutdown = false;
    connect(msg.port, msg.token)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === 'status') {
    sendResponse({
      connected: socket?.readyState === WebSocket.OPEN,
      tabs: [...ownedTabs],
    });
    return true;
  }
  return false;
}

// Tin tu popup cua chinh extension.
chrome.runtime.onMessage.addListener(
  (msg, sender, sendResponse) => handleRuntimeMessage(msg, sender, sendResponse, { external: false }),
);

// Tin tu TRANG WEB (trang ghep noi tren 127.0.0.1). Day la kenh khac han
// onMessage: tin nhan tu trang web KHONG BAO GIO den onMessage, nen phai
// dang ky rieng o day - va pham vi cua no bi gioi han boi khoa
// externally_connectable trong manifest.json.
chrome.runtime.onMessageExternal.addListener(
  (msg, sender, sendResponse) => handleRuntimeMessage(msg, sender, sendResponse, { external: true }),
);

async function connect(port, token, { persist = true } = {}) {
  clearReconnectTimer();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.close(1000, 'ghep noi lai');
  }
  if (persist) await chrome.storage.session.set({ port, token });
  await restoreOwnedTabs();

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`);
    const failTimer = setTimeout(() => {
      try { ws.close(); } catch { /* socket chua mo */ }
      reject(new Error('Het thoi gian ket noi toi tool.'));
    }, 10000);
    let opened = false;

    ws.addEventListener('open', async () => {
      clearTimeout(failTimer);
      opened = true;
      socket = ws;
      reconnectAttempt = 0;
      clearReconnectTimer();
      startPing();
      const info = await chrome.runtime.getManifest();
      send({
        event: 'hello',
        params: {
          name: info.name,
          version: info.version,
          chromeVersion: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] ?? null,
        },
      });
      resolve();
    });

    ws.addEventListener('message', (ev) => handleMessage(ev.data));

    ws.addEventListener('error', () => {
      clearTimeout(failTimer);
      reject(new Error(`Khong ket noi duoc toi tool tren cong ${port}.`));
    });

    ws.addEventListener('close', () => {
      clearTimeout(failTimer);
      // Mot ket noi moi co the da thay ws nay. Close event cua socket CU khong
      // duoc phep tat heartbeat hay detach debugger cua socket MOI.
      if (socket !== ws) return;
      socket = null;
      stopPing();
      detachAll();
      if (opened && !intentionalShutdown) scheduleReconnect();
    });
  });
}

function clearReconnectTimer() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

/**
 * Tu noi lai sau mot disconnect giua run.
 * Token/port nam trong storage.session nen van con sau khi service worker ngu
 * va hoi sinh, nhung se bi xoa khi tool shutdown binh thuong.
 */
function scheduleReconnect() {
  if (intentionalShutdown || reconnectTimer || socket?.readyState === WebSocket.OPEN) return;
  const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    const { port, token } = await chrome.storage.session.get(['port', 'token']);
    if (!port || !token || intentionalShutdown) return;
    try {
      await connect(port, token, { persist: false });
    } catch {
      scheduleReconnect();
    }
  }, delay);
}

function startPing() {
  stopPing();
  // Tu Chrome 116, luu luong WebSocket lam moi bo dem 30s cua service worker.
  // Khong co nhip nay, SW bi ngu giua chung mot run dai va tab mat dieu khien.
  pingTimer = setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) send({ event: 'ping', params: {} });
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

function send(payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function persistOwnedTabs() {
  await chrome.storage.session.set({ ownedTabs: [...ownedTabs] });
}

/** Khoi phuc quyen so huu tab sau khi service worker MV3 bi Chrome khoi dong lai. */
async function restoreOwnedTabs() {
  const stored = await chrome.storage.session.get('ownedTabs');
  const ids = Array.isArray(stored.ownedTabs) ? stored.ownedTabs : [];
  let changed = false;
  for (const tabId of ids) {
    if (!Number.isInteger(tabId)) {
      changed = true;
      continue;
    }
    try {
      await chrome.tabs.get(tabId);
      ownedTabs.add(tabId);
    } catch {
      changed = true;
    }
  }
  if (changed) await persistOwnedTabs();
}

/* --------------------------------------------------------------- Dieu phoi RPC */

async function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.event === 'pong' || !msg.method) return;

  try {
    const result = await dispatch(msg.method, msg.params ?? {});
    send({ id: msg.id, ok: true, result: result ?? null });
  } catch (err) {
    send({
      id: msg.id,
      ok: false,
      error: { message: err?.message ?? String(err), code: err?.code ?? 'BRIDGE_CALL_FAILED' },
    });
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'newTab': return newTab(params);
    case 'closeTab': return closeTab(params);
    case 'activateTab': return activateTab(params);
    case 'listTabs': return listTabs();
    case 'cdp': return cdp(params);
    case 'getTargets': return getTargets(params);
    case 'attachTarget': return attachTarget(params);
    case 'detachTarget': return detachTarget(params);
    case 'browserInfo': return browserInfo();
    case 'takeDownload': return takeDownload(params);
    case 'shutdown': return shutdown();
    default:
      throw Object.assign(new Error(`Method khong ho tro: ${method}`), { code: 'BRIDGE_UNKNOWN_METHOD' });
  }
}

/* ----------------------------------------------------------------- Quan ly tab */

/**
 * Mo tab moi trong cua so hien tai cua nguoi dung.
 *
 * MAC DINH active:true, va day KHONG phai lua chon tham my.
 * Do thuc te ngay 2026-08-26 tren Chrome 152: tab do extension tao voi
 * active:false co document.visibilityState = 'hidden' VINH VIEN - goi
 * chrome.tabs.update({active:true}) sau do cung KHONG doi duoc. Ma tab hidden
 * thi khong nhan duoc su kien tu Input.dispatchMouseEvent/dispatchKeyEvent,
 * nghia la khong click, khong go phim, khong bung duoc dropdown goi y.
 *
 * Vi vay tab lam viec phai duoc tao o trang thai hien thi ngay tu dau.
 */
async function newTab({ url = 'about:blank', active = true, windowId } = {}) {
  const tab = await chrome.tabs.create({ url, active, ...(windowId ? { windowId } : {}) });
  ownedTabs.add(tab.id);
  await persistOwnedTabs();
  await attachDebugger({ tabId: tab.id });
  return { tabId: tab.id, windowId: tab.windowId, url: tab.url ?? url, active };
}

function assertOwned(tabId) {
  if (!ownedTabs.has(tabId)) {
    // Rao chan quan trong: extension nay KHONG BAO GIO dieu khien tab ma nguoi
    // dung tu mo. No chi lam viec tren tab do chinh no tao ra cho lan chay nay.
    throw Object.assign(
      new Error(`Tab ${tabId} khong phai do tool mo ra, tu choi dieu khien.`),
      { code: 'BRIDGE_TAB_NOT_OWNED' },
    );
  }
}

async function closeTab({ tabId }) {
  assertOwned(tabId);
  await detach({ tabId });
  ownedTabs.delete(tabId);
  await persistOwnedTabs();
  try { await chrome.tabs.remove(tabId); } catch { /* tab da dong */ }
  return { closed: true };
}

async function activateTab({ tabId }) {
  assertOwned(tabId);
  const tab = await chrome.tabs.get(tabId);

  // Cua so co the dang thu nho. Khi do tab van "active" va document.hasFocus()
  // van true, NHUNG document.visibilityState = 'hidden' va Chrome KHONG chuyen
  // su kien chuot/ban phim vao trang. Vi vay phai khoi phuc cua so truoc.
  const win = await chrome.windows.get(tab.windowId);
  if (win.state === 'minimized') {
    await chrome.windows.update(tab.windowId, { state: 'normal' });
  }
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });

  // Cho Chrome ve xong tab: truoc khi tab duoc render lan dau,
  // getBoundingClientRect tra ve toa do khong dung.
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  return { active: true, windowState: win.state };
}

async function listTabs() {
  const out = [];
  for (const tabId of ownedTabs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      out.push({ tabId, url: tab.url, title: tab.title });
    } catch { ownedTabs.delete(tabId); }
  }
  return { tabs: out };
}

async function browserInfo() {
  const win = await chrome.windows.getCurrent().catch(() => null);
  return {
    chromeVersion: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] ?? null,
    userAgent: navigator.userAgent,
    windowId: win?.id ?? null,
  };
}

/* -------------------------------------------------------------------- CDP */

function debuggeeKey(d) {
  return d.targetId ? `target:${d.targetId}` : `tab:${d.tabId}`;
}

async function attachDebugger(debuggee) {
  const key = debuggeeKey(debuggee);
  if (attached.has(key)) return;
  await chrome.debugger.attach(debuggee, CDP_VERSION);
  attached.set(key, debuggee);
}

async function detach(debuggee) {
  const key = debuggeeKey(debuggee);
  if (!attached.has(key)) return;
  attached.delete(key);
  try { await chrome.debugger.detach(debuggee); } catch { /* da detach */ }
}

function detachAll() {
  for (const debuggee of [...attached.values()]) {
    chrome.debugger.detach(debuggee).catch(() => {});
  }
  attached.clear();
}

/**
 * Gui mot lenh CDP. Debuggee xac dinh bang tabId (tab do tool mo)
 * hoac targetId (vi du webview cua AI Mode nam trong tab do).
 */
async function cdp({ tabId, targetId, method, params }) {
  const debuggee = targetId ? { targetId } : { tabId };
  if (!targetId) assertOwned(tabId);
  await attachDebugger(debuggee);
  return chrome.debugger.sendCommand(debuggee, method, params ?? {});
}

/**
 * Liet ke target trong trinh duyet. Day la duong DUY NHAT nhin thay noi dung
 * cua <webview> ma Chrome 152 dung de hien AI Mode.
 */
async function getTargets({ tabId } = {}) {
  const targets = await chrome.debugger.getTargets();
  const filtered = tabId == null ? targets : targets.filter((t) => t.tabId === tabId);
  return { targets: filtered };
}

async function attachTarget({ targetId }) {
  await attachDebugger({ targetId });
  return { attached: true };
}

async function detachTarget({ targetId, tabId }) {
  await detach(targetId ? { targetId } : { tabId });
  return { detached: true };
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  send({ event: 'cdp', params: { tabId: source.tabId ?? null, targetId: source.targetId ?? null, method, params } });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  attached.delete(debuggeeKey(source));
  send({ event: 'detached', params: { tabId: source.tabId ?? null, reason } });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!ownedTabs.has(tabId)) return;
  ownedTabs.delete(tabId);
  persistOwnedTabs().catch(() => {});
  attached.delete(`tab:${tabId}`);
  send({ event: 'tab-removed', params: { tabId } });
});

/* --------------------------------------------------------------- Download */

chrome.downloads.onCreated.addListener((item) => {
  downloads.set(item.id, { id: item.id, filename: item.filename, state: item.state, startTime: item.startTime });
  send({ event: 'download', params: { id: item.id, state: 'created', filename: item.filename } });
});

chrome.downloads.onChanged.addListener((delta) => {
  const rec = downloads.get(delta.id) ?? { id: delta.id };
  if (delta.filename?.current) rec.filename = delta.filename.current;
  if (delta.state?.current) rec.state = delta.state.current;
  downloads.set(delta.id, rec);
  if (delta.state?.current === 'complete' || delta.state?.current === 'interrupted') {
    send({ event: 'download', params: { id: delta.id, state: delta.state.current, filename: rec.filename } });
  }
});

/**
 * Tra ve duong dan tuyet doi cua file da tai xong.
 * Node se TU COPY file do; extension khong xoa file goc cua nguoi dung.
 */
async function takeDownload({ id }) {
  const [item] = await chrome.downloads.search({ id });
  if (!item) throw new Error(`Khong tim thay download ${id}.`);
  return { id, filename: item.filename, state: item.state, bytes: item.bytesReceived, mime: item.mime };
}

/* -------------------------------------------------------------------- Ket thuc */

async function shutdown() {
  intentionalShutdown = true;
  clearReconnectTimer();
  for (const tabId of [...ownedTabs]) {
    try { await closeTab({ tabId }); } catch { /* bo qua */ }
  }
  detachAll();
  ownedTabs.clear();
  await chrome.storage.session.remove(['port', 'token', 'ownedTabs']);
  return { done: true };
}

// Sau khi service worker hoi sinh, tu noi lai bang thong tin da luu trong phien.
chrome.runtime.onStartup.addListener(() => { restore(); });
restore();

async function restore() {
  if (socket?.readyState === WebSocket.OPEN) return;
  const { port, token } = await chrome.storage.session.get(['port', 'token']);
  if (port && token) {
    intentionalShutdown = false;
    connect(port, token, { persist: false }).catch(() => scheduleReconnect());
  }
}
