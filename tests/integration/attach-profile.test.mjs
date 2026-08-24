/**
 * Kiem chung luong "bam vao cua so Chrome dang mo san" (OPEN_CHROME.bat):
 *  1. Neu cong CDP da mo, ensureChrome ATTACH chu khong spawn Chrome moi.
 *  2. Doc duoc duong dan profile that cua Chrome dang attach.
 *  3. Neu cong do thuoc ve MOT PROFILE KHAC (vi du profile ca nhan),
 *     tool phai DUNG LAI voi ma PROFILE_MISMATCH, khong am tham dung nham.
 *
 * Moi test dung mot cong rieng va tu kill tien trinh Chrome da spawn.
 * Tu dong SKIP neu may khong co Chrome.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { makeTempDir } from '../helpers/dom.mjs';
import { findChrome, ensureChrome, probeDebugger } from '../../src/browser/chrome-launcher.mjs';
import {
  connectCdp, primaryContext, readAttachedProfilePath, verifyAttachedProfile,
} from '../../src/browser/cdp-connector.mjs';
import { nullLogger } from '../../src/core/logger.mjs';
import { AppError } from '../../src/core/errors.mjs';
import { sleep } from '../../src/core/retry.mjs';

let chromePath = null;
try { chromePath = findChrome('auto'); } catch { chromePath = null; }
const skip = chromePath ? false : 'Khong tim thay Google Chrome tren may nay';

const logger = nullLogger();

/** Mo san mot Chrome headless voi profile + cong debug cho truoc. */
async function openChrome(profileDir, port) {
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--headless=new',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 60; i += 1) {
    const version = await probeDebugger(port);
    if (version) return child.pid;
    await sleep(500);
  }
  throw new Error(`Chrome khong mo duoc cong ${port}`);
}

function killChrome(pid) {
  if (!pid) return;
  try { process.kill(pid); } catch { /* da thoat */ }
}

test('attach: bam vao cua so Chrome co san, khong spawn Chrome moi', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-attach1-');
  const profileDir = path.join(tmp.dir, 'chrome-profile');
  const port = 9351;
  let pid = null;
  try {
    pid = await openChrome(profileDir, port);

    const result = await ensureChrome({
      browser: {
        remote_debugging_port: port,
        user_data_dir: profileDir,
        chrome_path: chromePath,
        launch_timeout_ms: 20000,
        viewport: { width: 1200, height: 800 },
      },
    }, logger);

    assert.equal(result.launched, false, 'phai attach vao cua so co san, khong duoc mo Chrome moi');
    assert.equal(result.port, port);
    assert.ok(result.version.Browser.startsWith('Chrome/'));
  } finally {
    killChrome(pid);
    tmp.cleanup();
  }
});

test('attach: doc va xac minh dung duong dan profile automation', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-attach2-');
  const profileDir = path.join(tmp.dir, 'chrome-profile');
  const port = 9352;
  let pid = null;
  let browser = null;
  try {
    pid = await openChrome(profileDir, port);
    browser = await connectCdp({ port, logger });
    const context = primaryContext(browser);

    const actual = await readAttachedProfilePath(context, logger);
    assert.ok(actual, 'phai doc duoc Profile Path tu chrome://version');
    assert.ok(
      actual.toLowerCase().startsWith(profileDir.toLowerCase()),
      `profile path "${actual}" phai nam trong "${profileDir}"`,
    );

    const verified = await verifyAttachedProfile(context, profileDir, logger);
    assert.equal(verified.verified, true);
    assert.equal(path.resolve(verified.expected).toLowerCase(), profileDir.toLowerCase());
  } finally {
    if (browser) await browser.close().catch(() => {});
    killChrome(pid);
    tmp.cleanup();
  }
});

test('attach: TU CHOI lam viec khi cong debug thuoc ve profile khac', { skip }, async () => {
  const tmp = makeTempDir('auto-serp-attach3-');
  const toolProfile = path.join(tmp.dir, 'chrome-profile');
  const otherProfile = path.join(tmp.dir, 'profile-ca-nhan');
  const port = 9353;
  let pid = null;
  let browser = null;
  try {
    // Chrome dang mo lai la profile KHAC voi cau hinh cua tool
    pid = await openChrome(otherProfile, port);
    browser = await connectCdp({ port, logger });
    const context = primaryContext(browser);

    await assert.rejects(
      () => verifyAttachedProfile(context, toolProfile, logger),
      (err) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'PROFILE_MISMATCH');
        assert.equal(err.exitCode, 2, 'PROFILE_MISMATCH phai tra exit code 2');
        assert.match(err.message, /KHONG phai profile automation/);
        return true;
      },
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    killChrome(pid);
    tmp.cleanup();
  }
});
