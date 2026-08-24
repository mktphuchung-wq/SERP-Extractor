import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveNpm } from '../../scripts/bootstrap.mjs';

/**
 * Bay tung dinh that: bootstrap goi thang 'npm.cmd' va tin vao PATH. Tren may
 * DA cai Node thi chay ngon, tren may sach thi vo ngay o buoc dau tien:
 *
 *   'npm.cmd' is not recognized as an internal or external command
 *
 * Ban Node portable trong runtime\node khong tu them minh vao PATH, nen npm phai
 * duoc tim theo vi tri cua chinh file node.exe dang chay.
 */
function fakeFs(existing) {
  const set = new Set(existing.map((p) => path.resolve(p)));
  return { existsSync: (p) => set.has(path.resolve(p)) };
}

const NODE_EXE = path.join('C:', 'tool', 'runtime', 'node', 'node.exe');
const NODE_DIR = path.dirname(NODE_EXE);

test('resolveNpm: uu tien npm-cli.js di kem ban Node dang chay', () => {
  const cli = path.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npm = resolveNpm(NODE_EXE, fakeFs([cli, path.join(NODE_DIR, 'npm.cmd')]));

  assert.equal(npm.cmd, NODE_EXE, 'phai chay bang chinh node.exe dang dung');
  assert.deepEqual(npm.args, [cli]);
  assert.equal(npm.shell, false, 'khong duoc qua shell - tranh DEP0190 va loi quote');
});

test('resolveNpm: khong co npm-cli.js thi lay npm.cmd canh node.exe', () => {
  const localCmd = path.join(NODE_DIR, 'npm.cmd');
  const npm = resolveNpm(NODE_EXE, fakeFs([localCmd]));

  assert.equal(npm.cmd, localCmd);
  assert.deepEqual(npm.args, []);
  // Node 20+ chan spawn file .cmd khi shell=false, nen truong hop nay bat buoc co shell.
  assert.equal(npm.shell, process.platform === 'win32');
});

test('resolveNpm: het cach moi roi ve npm tren PATH he thong', () => {
  const npm = resolveNpm(NODE_EXE, fakeFs([]));
  assert.equal(npm.cmd, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  assert.match(npm.label, /PATH he thong/);
});

test('resolveNpm: voi Node that dang chay, tim duoc npm that', () => {
  const npm = resolveNpm();
  assert.ok(npm.cmd, 'phai tra ve mot lenh nao do');
  // Tren may co runtime\node thi phai la npm di kem, khong duoc roi ve PATH.
  if (process.execPath.includes(`${path.sep}runtime${path.sep}node${path.sep}`)) {
    assert.equal(npm.shell, false, 'ban portable phai dung npm-cli.js di kem');
  }
});
