import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Mọi file nguồn/cấu hình mà một bản cài trên máy khác bắt buộc phải có. */
function shippedFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) shippedFiles(full, out);
    else out.push(full);
  }
  return out;
}

const SHIPPED_DIRS = ['src', 'scripts', 'tools', 'config', 'vendor'];

test('moi import tuong doi trong src\\ deu tro toi file that', () => {
  const broken = [];
  for (const file of shippedFiles(path.join(ROOT, 'src')).filter((f) => f.endsWith('.mjs'))) {
    const source = fs.readFileSync(file, 'utf8');
    const specifiers = [
      ...source.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    for (const specifier of new Set(specifiers)) {
      if (!fs.existsSync(path.resolve(path.dirname(file), specifier))) {
        broken.push(`${path.relative(ROOT, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(broken, [], `Import tro toi file khong ton tai:\n  ${broken.join('\n  ')}`);
});

/**
 * Bay tung dinh that: `.gitignore` ghi "output/" khong neo goc nen git coi MOI
 * thu muc ten "output" o MOI cap la bi ignore - src\output\ bien mat khoi repo,
 * may khac clone ve thieu 5 file va chi vo ra luc chay bang ERR_MODULE_NOT_FOUND.
 *
 * Test nay hoi thang git xem co file nao dang duoc ship ma lai bi ignore khong.
 */
test('khong co file nao can ship ma lai bi .gitignore nuot', () => {
  const git = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  });
  if (git.status !== 0) {
    // Ban cai tren may nguoi dung khong phai repo git - khong co gi de kiem tra.
    return;
  }

  const files = SHIPPED_DIRS
    .filter((d) => fs.existsSync(path.join(ROOT, d)))
    .flatMap((d) => shippedFiles(path.join(ROOT, d)))
    .map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));

  assert.ok(files.length > 50, 'khong tim thay file nguon nao - duong dan sai?');

  // --no-index la bat buoc: mac dinh git check-ignore bo qua file da nam trong
  // index, nen mot pattern sai van "sach" chi vi file da lo duoc track tu truoc.
  // Ta muon kiem tra CHINH LUAT trong .gitignore, khong phu thuoc trang thai index.
  const res = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: ROOT, input: files.join('\n'), encoding: 'utf8', windowsHide: true,
  });
  const ignored = (res.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

  assert.deepEqual(
    ignored, [],
    'Nhung file nay se KHONG duoc commit nen may khac cai ve se thieu:\n  '
    + `${ignored.join('\n  ')}\n`
    + 'Kiem tra .gitignore - nho neo pattern bang dau "/" o dau (vi du "/output/").',
  );
});

test('cac file bat buoc cho mot ban cai moi deu ton tai', () => {
  const required = [
    'install.ps1', 'INSTALL.bat', 'RUN.bat', 'OPEN_CHROME.bat', '_env.bat',
    'package.json', 'config/default.yaml', 'config/selectors.yaml', 'config/runtime.json',
    'scripts/bootstrap.mjs', 'scripts/open-chrome.mjs',
    'src/cli.mjs', 'src/orchestrator.mjs', 'src/setup.mjs',
    'src/output/markdown-builder.mjs', 'src/output/artifact-writer.mjs',
    'src/output/validator.mjs', 'src/output/manifest.mjs', 'src/output/notifier.mjs',
    'vendor/extensions.lock.json',
  ];
  const missing = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, [], `Thieu file:\n  ${missing.join('\n  ')}`);
});
