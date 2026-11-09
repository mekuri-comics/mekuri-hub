// 本機測試工具：以假 HTTP 回應執行插件，比對結果。
// 案例格式與 mekuri `shared/fixtures/plugin/example-source/cases.json` 相同：
// {
//   "responses": { "<url>": { "status": 200, "contentType": "text/html", "headers": {}, "body": "...", "delayMs": 0 } },
//   "settings": { "<key>": <value> },          // 選用：覆寫設定值
//   "storage": { "<key>": <value> },           // 選用：初始 storage
//   "cases": [
//     { "name": "...", "call": "search", "args": ["海", 1], "expect": { ... } },
//     { "name": "...", "eval": "await mekuri.http.request(...)", "expectError": "PLUGIN_DOMAIN_DENIED", "timeoutOverrideMs": 1000 }
//   ]
// }
// responses 的鍵是完整網址（也可以寫成 "POST https://..." 指定方法）；未列出的網址回 404。
import { createSandbox } from './sandbox.mjs';

/** 由 responses 建立假的 transport */
export function fakeTransport(responses = {}, onRequest) {
  return async (req) => {
    onRequest?.(req);
    const r = responses[`${req.method} ${req.url}`] ?? responses[req.url];
    if (!r) return { status: 404, headers: { 'content-type': 'text/plain' }, body: '' };
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    const headers = { ...(r.headers ?? {}) };
    if (r.contentType && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = r.contentType;
    const body = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { status: r.status ?? 200, headers, body };
  };
}

/** 把值轉成 JSON 再轉回來（去掉 undefined 欄位），用來比對 */
function normalize(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
}

export function caseName(c, i) {
  return c.name ?? (c.call ? `${c.call}(${(c.args ?? []).map((a) => JSON.stringify(a)).join(', ')})` : `案例 ${i + 1}`);
}

/**
 * 執行所有案例。每個案例使用新的沙盒（互不影響）。
 * @param {{ manifest: object, code: string, cases: object, log?: (line:string)=>void, platform?: string }} opts
 * @returns {Promise<{ passed: number, failed: number, results: Array<{ name: string, ok: boolean, message?: string, actual?: unknown, expected?: unknown, error?: string }> }>}
 */
export async function runCases({ manifest, code, cases, log, platform }) {
  if (!cases || !Array.isArray(cases.cases)) throw new Error('案例檔缺少 cases 陣列');
  const results = [];
  for (let i = 0; i < cases.cases.length; i++) {
    const c = cases.cases[i];
    const name = caseName(c, i);
    const requests = [];
    let sb;
    let actual;
    let error;
    try {
      sb = await createSandbox({
        manifest,
        code,
        transport: fakeTransport(cases.responses, (r) => requests.push(`${r.method} ${r.url}`)),
        settings: cases.settings,
        storage: cases.storage,
        platform,
        log: (line) => log?.(`[${name}] ${line}`),
      });
      const opts = { cpuMsPerCall: c.timeoutOverrideMs };
      if (typeof c.call === 'string') actual = await sb.call(c.call, c.args ?? [], opts);
      else if (typeof c.eval === 'string') actual = await sb.evalAsync(c.eval, opts);
      else throw new Error('案例必須有 call 或 eval');
    } catch (e) {
      error = e;
    } finally {
      sb?.dispose();
    }
    const r = { name, ok: false, requests };
    if (c.expectError !== undefined) {
      r.expected = { error: c.expectError };
      if (!error) r.message = `應丟出 ${c.expectError}，但成功回傳 ${JSON.stringify(normalize(actual))}`;
      else if (error.code !== c.expectError) r.message = `應丟出 ${c.expectError}，實際是 ${error.code ?? 'Error'}：${error.message}`;
      else r.ok = true;
      if (error) r.error = `${error.code ?? 'Error'}: ${error.message}`;
    } else if (error) {
      r.error = `${error.code ?? 'Error'}: ${error.message}`;
      r.message = `丟出錯誤 ${r.error}`;
    } else {
      r.actual = normalize(actual);
      if ('expect' in c) {
        r.expected = c.expect;
        r.ok = deepEqual(r.actual, c.expect);
        if (!r.ok) r.message = '回傳值與 expect 不同';
      } else r.ok = true;
    }
    results.push(r);
  }
  const passed = results.filter((r) => r.ok).length;
  return { passed, failed: results.length - passed, results };
}

/** 把結果格式化成文字報告 */
export function formatResults({ results, passed, failed }) {
  const lines = [];
  for (const r of results) {
    lines.push(`${r.ok ? '✓' : '✗'} ${r.name}`);
    if (!r.ok) {
      lines.push(`    ${r.message}`);
      if (r.expected !== undefined && r.actual !== undefined) {
        lines.push(`    預期：${JSON.stringify(r.expected)}`);
        lines.push(`    實際：${JSON.stringify(r.actual)}`);
      }
      if (r.requests?.length) lines.push(`    送出的請求：${r.requests.join('、')}`);
    }
  }
  lines.push('', `${passed} 通過，${failed} 失敗`);
  return lines.join('\n');
}
