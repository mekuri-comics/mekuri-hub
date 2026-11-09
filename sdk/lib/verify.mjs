// 插件包的完整檢查：格式、大小、內容與匯出函式。集散地 CI 與 `mekuri-plugin validate` 共用。
import { inspectPackage } from './package.mjs';
import { createSandbox, REQUIRED_EXPORTS, OPTIONAL_EXPORTS } from './sandbox.mjs';

/**
 * 在 QuickJS 中載入插件，確認匯出 search、getWork、getChapters、getPages（checkLogin 選用）。
 * 載入時沒有網路。
 * @returns {Promise<string[]>} 錯誤訊息
 */
export async function checkExports(manifest, code) {
  const errors = [];
  let sb;
  try {
    sb = await createSandbox({ manifest, code, cpuMsPerCall: 5_000, wallMsPerCall: 10_000 });
    const types = sb.exportTypes();
    for (const name of REQUIRED_EXPORTS) {
      if (types[name] !== 'function') errors.push(`插件沒有匯出必要函式 ${name}（目前是 ${types[name] ?? '未匯出'}）`);
    }
    for (const name of OPTIONAL_EXPORTS) {
      if (name in types && types[name] !== 'function') errors.push(`選用匯出 ${name} 必須是函式（目前是 ${types[name]}）`);
    }
  } catch (e) {
    errors.push(`無法在 QuickJS 中載入插件（必須是單一 ES module，不能 import 其他模組）：${e.code ?? ''} ${e.message}`.trim());
  } finally {
    sb?.dispose();
  }
  return errors;
}

/**
 * 檢查插件包。
 * @param {Uint8Array} bytes
 * @returns {Promise<{ errors: string[], warnings: string[], manifest?: object, sha256: string, files: Record<string, Uint8Array> }>}
 */
export async function verifyPackage(bytes, opts = {}) {
  const r = inspectPackage(bytes, opts);
  if (r.errors.length === 0 && r.code !== undefined) r.errors.push(...(await checkExports(r.manifest, r.code)));
  return r;
}
