// 插件包（.mekuri-plugin = ZIP）的讀取、檢查與打包。
// 契約：manifest.json + main + icon（選用），總大小 ≤ 50 MB（plugin-api.d.ts 沙盒限制）。
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { validateManifest, mainOf, isSafeRelativePath } from './manifest.mjs';

export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
export const PACKAGE_EXT = '.mekuri-plugin';
// 固定時間戳，讓同樣內容打包出同樣的 sha256
const FIXED_MTIME = new Date('2000-01-01T00:00:00Z');

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 解開並檢查插件包。
 * @param {Uint8Array} bytes
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{ errors: string[], warnings: string[], manifest?: object, main?: string, code?: string, files: Record<string, Uint8Array>, sha256: string }}
 */
export function inspectPackage(bytes, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_PACKAGE_BYTES;
  const errors = [];
  const warnings = [];
  const result = { errors, warnings, files: {}, sha256: sha256(bytes) };
  if (bytes.length > maxBytes) {
    errors.push(`插件包大小 ${fmtBytes(bytes.length)} 超過上限 ${fmtBytes(maxBytes)}`);
    return result;
  }
  let total = 0;
  let files;
  try {
    // filter 在解壓前執行：先檢查宣告的原始大小，避免 zip bomb
    files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > maxBytes) throw new Error(`解壓後大小超過上限 ${fmtBytes(maxBytes)}`);
        return true;
      },
    });
  } catch (e) {
    errors.push(`無法解開插件包（必須是 ZIP）：${e.message}`);
    return result;
  }
  const realTotal = Object.values(files).reduce((n, f) => n + f.length, 0);
  if (realTotal > maxBytes) {
    errors.push(`解壓後大小 ${fmtBytes(realTotal)} 超過上限 ${fmtBytes(maxBytes)}`);
    return result;
  }
  for (const name of Object.keys(files)) {
    if (name.endsWith('/')) {
      delete files[name]; // 目錄項目
      continue;
    }
    if (!isSafeRelativePath(name)) errors.push(`插件包含有不安全的路徑：${name}`);
  }
  result.files = files;
  if (errors.length) return result;

  if (!files['manifest.json']) {
    errors.push('插件包根目錄缺少 manifest.json');
    return result;
  }
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']).replace(/^﻿/, ''));
  } catch (e) {
    errors.push(`manifest.json 不是合法的 JSON：${e.message}`);
    return result;
  }
  result.manifest = manifest;
  const v = validateManifest(manifest);
  if (!v.valid) {
    errors.push(`manifest 欄位 ${v.field} 不合法：${v.message}`);
    return result;
  }
  const main = mainOf(manifest);
  result.main = main;
  if (!files[main]) errors.push(`插件包缺少主程式 ${main}（manifest.main）`);
  else result.code = strFromU8(files[main]);
  if (manifest.icon !== undefined && !files[manifest.icon]) errors.push(`插件包缺少圖示 ${manifest.icon}（manifest.icon）`);
  const expected = new Set(['manifest.json', main, manifest.icon].filter(Boolean));
  const extra = Object.keys(files).filter((f) => !expected.has(f));
  if (extra.length) warnings.push(`插件包含有 manifest 未用到的檔案（App 不會使用）：${extra.join(', ')}`);
  return result;
}

/**
 * 打包插件。
 * @param {{ manifest: object, code: string | Uint8Array, icon?: Uint8Array }} input
 * @returns {Uint8Array}
 */
export function createPackage({ manifest, code, icon }) {
  const v = validateManifest(manifest);
  if (!v.valid) throw new Error(`manifest 欄位 ${v.field} 不合法：${v.message}`);
  const entries = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2) + '\n'),
    [mainOf(manifest)]: typeof code === 'string' ? strToU8(code) : code,
  };
  if (manifest.icon !== undefined) {
    if (!icon) throw new Error(`manifest.icon 指定了 ${manifest.icon}，但沒有提供圖示檔`);
    entries[manifest.icon] = icon;
  }
  const bytes = zipSync(entries, { level: 9, mtime: FIXED_MTIME });
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error(`插件包大小 ${fmtBytes(bytes.length)} 超過上限 50 MB`);
  return bytes;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
