/**
 * Load va merge cau hinh: config/default.yaml -> file nguoi dung -> override CLI.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { AppError } from './errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..', '..');

/** Thay %VAR% bang bien moi truong Windows. */
export function expandEnv(value, env = process.env) {
  if (typeof value !== 'string') return value;
  return value.replace(/%([^%]+)%/g, (whole, name) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? env[key] : whole;
  });
}

function deepExpand(node, env) {
  if (Array.isArray(node)) return node.map((n) => deepExpand(n, env));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = deepExpand(v, env);
    return out;
  }
  return expandEnv(node, env);
}

export function deepMerge(base, override) {
  if (override === undefined) return base;
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(override)) {
      out[k] = k in base ? deepMerge(base[k], v) : v;
    }
    return out;
  }
  return override ?? base;
}

export function readYaml(file) {
  if (!fs.existsSync(file)) {
    throw new AppError('INVALID_CONFIG', `Khong tim thay file cau hinh: ${file}`);
  }
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch (err) {
    throw new AppError('INVALID_CONFIG', `File cau hinh khong hop le: ${file} (${err.message})`, {
      cause: err,
    });
  }
}

/**
 * @param {{configPath?:string, overrides?:object, env?:NodeJS.ProcessEnv}} [opts]
 */
export function loadConfig(opts = {}) {
  const env = opts.env ?? process.env;
  const defaultPath = path.join(PROJECT_ROOT, 'config', 'default.yaml');
  let config = readYaml(defaultPath);

  const userPath = opts.configPath
    ? path.resolve(opts.configPath)
    : path.join(PROJECT_ROOT, 'config', 'local.yaml');
  if (fs.existsSync(userPath) && userPath !== defaultPath) {
    config = deepMerge(config, readYaml(userPath));
  }

  if (opts.overrides) config = deepMerge(config, opts.overrides);

  config = deepExpand(config, env);
  config = resolvePaths(config);
  validateConfig(config);
  return config;
}

export function loadSelectors(file) {
  const target = file ?? path.join(PROJECT_ROOT, 'config', 'selectors.yaml');
  return readYaml(target);
}

function resolvePaths(config) {
  const out = structuredClone(config);
  out.output.root = path.resolve(PROJECT_ROOT, out.output.root);
  out.output.logs_root = path.resolve(PROJECT_ROOT, out.output.logs_root);
  out.browser.user_data_dir = path.resolve(out.browser.user_data_dir);
  out.paths = {
    project_root: PROJECT_ROOT,
    staging_root: path.join(os.tmpdir(), 'AutoSerpTool'),
  };
  return out;
}

function validateConfig(config) {
  const problems = [];
  const port = config?.browser?.remote_debugging_port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    problems.push('browser.remote_debugging_port phai la so nguyen 1024-65535');
  }
  if (!['timestamp', 'fail', 'overwrite'].includes(config?.output?.on_conflict)) {
    problems.push('output.on_conflict phai la timestamp | fail | overwrite');
  }
  if (!['questions_only', 'questions_and_answers'].includes(config?.extractors?.paa_capture_mode)) {
    problems.push('extractors.paa_capture_mode phai la questions_only | questions_and_answers');
  }
  const pages = config?.search?.pages;
  if (!Number.isInteger(pages) || pages < 1 || pages > 10) {
    problems.push('search.pages phai la so nguyen 1-10');
  }
  if (problems.length) {
    throw new AppError('INVALID_CONFIG', `Cau hinh khong hop le:\n- ${problems.join('\n- ')}`);
  }
}
