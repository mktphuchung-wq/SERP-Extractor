/**
 * Ghi file qua staging + atomic move (dac ta Step 8, Step 9, muc 19.7).
 * Thu muc ket qua cuoi cung CHI duoc chua 3 file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../core/errors.mjs';

/** Ghi file atomic: ghi .tmp -> fsync -> rename. */
export function writeAtomic(targetPath, content, encoding = 'utf8') {
  const tmp = `${targetPath}.tmp`;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, content, { encoding });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, targetPath);
  return targetPath;
}

/** Kiem tra noi dung doc lai duoc bang UTF-8 va khop voi noi dung goc. */
export function verifyUtf8(filePath, expected) {
  const readBack = fs.readFileSync(filePath, 'utf8');
  if (readBack !== expected) {
    throw new AppError('OUTPUT_WRITE_FAILED', `File ghi ra khong khop noi dung goc: ${filePath}`);
  }
  return true;
}

/**
 * Chuan bi ba file trong staging.
 * @param {{stagingDir:string, base:string, markdown:string, csvPage1:string, csvPage2:string}} args
 * @returns {{md:string, csv1:string, csv2:string}}
 */
export function writeStagingArtifacts(args) {
  fs.mkdirSync(args.stagingDir, { recursive: true });
  const md = writeAtomic(path.join(args.stagingDir, `${args.base}.md`), args.markdown);
  verifyUtf8(md, args.markdown);
  const csv1 = writeAtomic(path.join(args.stagingDir, `${args.base} page 1.csv`), args.csvPage1);
  const csv2 = writeAtomic(path.join(args.stagingDir, `${args.base} page 2.csv`), args.csvPage2);
  return { md, csv1, csv2 };
}

/**
 * Chuyen ba file tu staging sang output folder.
 * @param {{files:string[], outputDir:string, overwrite?:boolean, backupDir?:string}} args
 * @returns {string[]} duong dan file cuoi cung
 */
export function moveToOutput(args) {
  fs.mkdirSync(args.outputDir, { recursive: true });

  if (args.overwrite && args.backupDir) backupExisting(args.outputDir, args.backupDir);

  const finalPaths = [];
  for (const file of args.files) {
    const target = path.join(args.outputDir, path.basename(file));
    if (fs.existsSync(target)) {
      if (!args.overwrite) {
        throw new AppError('OUTPUT_WRITE_FAILED', `File dich da ton tai: ${target}`);
      }
      fs.rmSync(target, { force: true });
    }
    try {
      fs.renameSync(file, target);
    } catch {
      // rename giua hai o dia khac nhau -> copy roi xoa
      fs.copyFileSync(file, target);
      fs.rmSync(file, { force: true });
    }
    finalPaths.push(target);
  }
  return finalPaths;
}

/** Sao luu thu muc cu truoc khi ghi de - khong bao gio xoa mu. */
export function backupExisting(outputDir, backupDir) {
  if (!fs.existsSync(outputDir)) return null;
  const entries = fs.readdirSync(outputDir, { withFileTypes: true }).filter((e) => e.isFile());
  if (!entries.length) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  for (const entry of entries) {
    fs.copyFileSync(path.join(outputDir, entry.name), path.join(backupDir, entry.name));
  }
  return backupDir;
}

/** Don staging sau khi hoan tat. */
export function cleanStaging(stagingDir, keep = false) {
  if (keep) return stagingDir;
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch { /* giu lai de debug */ }
  return null;
}
