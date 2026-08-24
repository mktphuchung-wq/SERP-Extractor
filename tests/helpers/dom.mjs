/**
 * Ho tro test: nap fixture HTML bang linkedom de goi cac ham extractor thuan
 * ma khong can mo trinh duyet.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.resolve(HERE, '..', 'fixtures');
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');

export function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

export function loadFixtureHtml(name) {
  return fs.readFileSync(fixturePath(name), 'utf8');
}

/** @returns {Document} */
export function loadFixtureDocument(name) {
  const { document } = parseHTML(loadFixtureHtml(name));
  return document;
}

/** @returns {Document} */
export function parseHtml(html) {
  const { document } = parseHTML(html);
  return document;
}

/** Thu muc tam rieng cho tung test, tu don khi goi cleanup(). */
export function makeTempDir(prefix = 'auto-serp-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup() {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* bo qua */ }
    },
  };
}

/** Lay danh sach css selector tu spec trong selectors.yaml (giong adapter lam). */
export function cssSpecs(specs) {
  return (specs ?? []).filter((s) => s && s.type === 'css' && s.css).map((s) => s.css);
}
