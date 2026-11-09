// manifest 驗證與網域比對。
// 規則以 mekuri `shared/fixtures/plugin/manifest-cases.json` 為準（副本見 test/fixtures/），
// 與 App 端 `inspectPackage`（logic-layer §7.1）一致。

/** 驗證失敗時的錯誤碼（shared/contracts/services.ts 的 ErrorCode） */
export const INVALID_INPUT = 'INVALID_INPUT';

export const SUPPORTED_API_VERSION = 1;

// semver 2.0.0 官方建議的正規表示式
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// 反向網域：至少兩段，每段小寫英數與連字號，不以連字號開頭或結尾
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const ID_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const READING_DIRECTIONS = ['rtl', 'ltr'];
const SETTING_TYPES = ['select', 'toggle', 'text'];

/** 套件內相對路徑：不可為絕對路徑、不可含 `..`、反斜線或空段 */
export function isSafeRelativePath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 200) return false;
  if (p.startsWith('/') || p.includes('\\') || /^[a-zA-Z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export function isSemver(v) {
  return typeof v === 'string' && SEMVER_RE.test(v);
}

/** 比較兩個 semver：a<b 回負數、相等回 0、a>b 回正數（依 semver §11 的優先序）。 */
export function compareSemver(a, b) {
  const pa = SEMVER_RE.exec(a);
  const pb = SEMVER_RE.exec(b);
  if (!pa || !pb) throw new Error(`不是 semver：${!pa ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  const ra = pa[4];
  const rb = pb[4];
  if (ra === undefined && rb === undefined) return 0;
  if (ra === undefined) return 1; // 正式版大於預覽版
  if (rb === undefined) return -1;
  const xa = ra.split('.');
  const xb = rb.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb) {
      const d = Number(xa[i]) - Number(xb[i]);
      if (d !== 0) return d;
    } else if (na !== nb) {
      return na ? -1 : 1;
    } else if (xa[i] !== xb[i]) {
      return xa[i] < xb[i] ? -1 : 1;
    }
  }
  return 0;
}

/**
 * domains 項目格式："example.com"（僅此主機）或 "*.example.com"（所有子網域，不含 example.com 本身）。
 * 不允許 "*"、IP、localhost、協定、路徑、連接埠、大寫。
 */
export function isValidDomainPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 253) return false;
  const host = pattern.startsWith('*.') ? pattern.slice(2) : pattern;
  if (!HOST_RE.test(host)) return false;
  if (IPV4_RE.test(host)) return false;
  const labels = host.split('.');
  if (labels.includes('localhost')) return false;
  // 最後一段（頂級網域）不可全為數字
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  return true;
}

/** 主機名稱是否符合網域樣式（logic-layer §7.2：完全相符，或為 `*.x` 的子網域）。 */
export function domainMatches(pattern, host) {
  if (typeof pattern !== 'string' || typeof host !== 'string') return false;
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".cdn.example.com"
    return h.length > suffix.length && h.endsWith(suffix);
  }
  return h === p;
}

/** 主機名稱是否被 domains 清單中任一項允許 */
export function hostAllowed(domains, host) {
  return Array.isArray(domains) && domains.some((d) => domainMatches(d, host));
}

/**
 * 依 URL 判斷能否連線：只允許 https，且主機在 domains 內。
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
export function checkUrlAllowed(domains, rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `網址格式錯誤：${rawUrl}` };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: `只允許 https：${rawUrl}` };
  if (u.username || u.password) return { ok: false, reason: `網址不可含帳號密碼：${u.host}` };
  if (!hostAllowed(domains, u.hostname)) return { ok: false, reason: `網域不在 manifest.domains 內：${u.hostname}` };
  return { ok: true, url: u };
}

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * 驗證 manifest。
 * @returns {{ valid: true } | { valid: false, error: 'INVALID_INPUT', field: string, message: string }}
 * field 是第一個錯誤欄位（檢查順序固定，與 fixtures 一致）。
 */
export function validateManifest(m) {
  const fail = (field, message) => ({ valid: false, error: INVALID_INPUT, field, message });
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return fail('manifest', 'manifest 必須是 JSON 物件');

  if (typeof m.id !== 'string' || m.id.length > 128 || !ID_RE.test(m.id))
    return fail('id', 'id 必須是全小寫的反向網域格式，例如 io.github.alice.example');
  if (!isNonEmptyString(m.name)) return fail('name', 'name 必須是非空字串');
  if (!isSemver(m.version)) return fail('version', 'version 必須是 semver，例如 1.0.0');
  if (m.apiVersion !== SUPPORTED_API_VERSION) return fail('apiVersion', `apiVersion 目前只支援 ${SUPPORTED_API_VERSION}`);
  if (!isNonEmptyString(m.author)) return fail('author', 'author 必須是非空字串');
  if (typeof m.description !== 'string') return fail('description', 'description 必須是字串');

  if (m.homepage !== undefined) {
    let ok = false;
    try {
      const u = new URL(m.homepage);
      ok = u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      ok = false;
    }
    if (!ok) return fail('homepage', 'homepage 必須是 http(s) 網址');
  }
  if (m.icon !== undefined && (!isSafeRelativePath(m.icon) || !/\.(png|svg)$/i.test(m.icon)))
    return fail('icon', 'icon 必須是套件內的相對路徑，副檔名 .png 或 .svg');
  if (m.main !== undefined && (!isSafeRelativePath(m.main) || !/\.m?js$/i.test(m.main)))
    return fail('main', 'main 必須是套件內的相對路徑，副檔名 .js');
  if (m.tags !== undefined && (!Array.isArray(m.tags) || !m.tags.every(isNonEmptyString)))
    return fail('tags', 'tags 必須是非空字串陣列');

  if (!Array.isArray(m.domains) || m.domains.length === 0) return fail('domains', 'domains 必須是非空陣列');
  for (const d of m.domains) {
    if (!isValidDomainPattern(d))
      return fail('domains', `domains 項目不合法：${JSON.stringify(d)}（只能是 example.com 或 *.example.com，不允許 *、IP、localhost、協定或路徑）`);
  }

  if (m.readingDirection !== undefined && !READING_DIRECTIONS.includes(m.readingDirection))
    return fail('readingDirection', 'readingDirection 只能是 rtl 或 ltr');

  if (m.login !== undefined) {
    if (m.login === null || typeof m.login !== 'object' || Array.isArray(m.login)) return fail('login', 'login 必須是物件');
    const r = typeof m.login.url === 'string' ? checkUrlAllowed(m.domains, m.login.url) : { ok: false };
    if (!r.ok) return fail('login.url', 'login.url 必須是 https 網址，且網域在 domains 內');
    if (m.login.cookieNames !== undefined && (!Array.isArray(m.login.cookieNames) || !m.login.cookieNames.every(isNonEmptyString)))
      return fail('login.cookieNames', 'login.cookieNames 必須是非空字串陣列');
  }

  if (m.settings !== undefined) {
    if (!Array.isArray(m.settings)) return fail('settings', 'settings 必須是陣列');
    const keys = new Set();
    for (let i = 0; i < m.settings.length; i++) {
      const s = m.settings[i];
      const f = `settings[${i}]`;
      if (s === null || typeof s !== 'object') return fail(f, `${f} 必須是物件`);
      if (!isNonEmptyString(s.key) || keys.has(s.key)) return fail(`${f}.key`, `${f}.key 必須是不重複的非空字串`);
      keys.add(s.key);
      if (!SETTING_TYPES.includes(s.type)) return fail(`${f}.type`, `${f}.type 只能是 select、toggle、text`);
      if (!isNonEmptyString(s.label)) return fail(`${f}.label`, `${f}.label 必須是非空字串`);
      if (s.type === 'select') {
        if (!Array.isArray(s.options) || s.options.length === 0 || !s.options.every((o) => o && typeof o.value === 'string' && isNonEmptyString(o.label)))
          return fail(`${f}.options`, `${f}.options 必須是 { value, label } 陣列`);
        if (!s.options.some((o) => o.value === s.default)) return fail(`${f}.default`, `${f}.default 必須是 options 之一`);
      } else if (s.type === 'toggle') {
        if (typeof s.default !== 'boolean') return fail(`${f}.default`, `${f}.default 必須是布林值`);
      } else if (typeof s.default !== 'string') {
        return fail(`${f}.default`, `${f}.default 必須是字串`);
      }
    }
  }
  return { valid: true };
}

/** manifest.main 的預設值 */
export function mainOf(manifest) {
  return manifest.main ?? 'index.js';
}
