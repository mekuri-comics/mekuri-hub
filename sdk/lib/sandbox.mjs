// 以 quickjs-emscripten 執行插件的沙盒，實作 plugin-api.d.ts 的 Host API 與沙盒限制。
// 集散地 CI（確認匯出函式）與本機測試工具（假 HTTP 回應）共用。
import { readFileSync } from 'node:fs';
import { getQuickJS } from 'quickjs-emscripten';
import { parse as parseHtml } from 'node-html-parser';
import { checkUrlAllowed } from './manifest.mjs';

const PRELUDE = readFileSync(new URL('./prelude.js', import.meta.url), 'utf8');

export const REQUIRED_EXPORTS = ['search', 'getWork', 'getChapters', 'getPages'];
export const OPTIONAL_EXPORTS = ['checkLogin'];

export const LIMITS = Object.freeze({
  memoryBytes: 64 * 1024 * 1024,
  cpuMsPerCall: 20_000,
  httpTimeoutMs: 30_000,
  httpMaxBodyBytes: 10 * 1024 * 1024,
  storageBytes: 1024 * 1024,
  maxTimeoutMs: 10_000,
  maxRedirects: 5,
});

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD'];
const REDIRECTS = [301, 302, 303, 307, 308];

/** 插件執行錯誤；code 為 shared/contracts/services.ts 的 ErrorCode */
export class PluginError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
  }
}

/**
 * 建立沙盒並載入插件。
 * @param {object} opts
 * @param {object} opts.manifest   已驗證的 manifest
 * @param {string} opts.code       插件主程式（單一 ES module）
 * @param {(req: {url:string, method:string, headers:Record<string,string>, body?:string}) => Promise<{status:number, headers?:Record<string,string>, body?:string}>} [opts.transport]
 *        實際送出請求的函式（本機測試工具傳入假回應）；未提供時所有請求都失敗（NETWORK）。
 * @param {Record<string, unknown>} [opts.settings]  覆寫設定值（預設取 manifest.settings 的 default）
 * @param {Record<string, unknown>} [opts.storage]   初始 storage 內容
 * @param {(line: string) => void} [opts.log]
 * @param {'windows'|'android'} [opts.platform]
 * @param {string} [opts.appVersion]
 * @param {number} [opts.cpuMsPerCall]
 * @param {number} [opts.wallMsPerCall]  單次呼叫的總時限（含等待 HTTP），預設 120 秒
 */
export async function createSandbox(opts) {
  const sb = new Sandbox(opts, await getQuickJS());
  try {
    await sb.load();
  } catch (e) {
    sb.dispose();
    throw e;
  }
  return sb;
}

class Sandbox {
  constructor(opts, QuickJS) {
    this.opts = opts;
    this.manifest = opts.manifest;
    this.domains = opts.manifest.domains;
    this.log = opts.log ?? (() => {});
    this.cpuLimit = opts.cpuMsPerCall ?? LIMITS.cpuMsPerCall;
    this.wallLimit = opts.wallMsPerCall ?? 120_000;
    this.storage = new Map(Object.entries(opts.storage ?? {}).map(([k, v]) => [k, JSON.stringify(v)]));
    this.settings = {};
    for (const s of opts.manifest.settings ?? []) this.settings[s.key] = s.default;
    Object.assign(this.settings, opts.settings ?? {});
    this.nodes = new Map();
    this.nextNode = 1;
    this.timers = new Map();
    this.nextTimer = 1;
    this.cpuUsed = 0;
    this.sliceStart = null;
    this.interrupted = false;
    this.abort = null; // 目前進行中的呼叫的中止函式
    this.disposed = false;

    this.runtime = QuickJS.newRuntime();
    this.runtime.setMemoryLimit(LIMITS.memoryBytes);
    this.runtime.setMaxStackSize(1024 * 1024);
    this.runtime.setInterruptHandler(() => {
      if (this.sliceStart !== null && this.cpuUsed + (Date.now() - this.sliceStart) > this.cpuLimit) {
        this.interrupted = true;
        return true;
      }
      return false;
    });
    this.vm = this.runtime.newContext();
  }

  // 在 VM 內執行時計入 CPU 時間
  inVm(fn) {
    const outer = this.sliceStart === null;
    if (outer) this.sliceStart = Date.now();
    try {
      return fn();
    } finally {
      if (outer) {
        this.cpuUsed += Date.now() - this.sliceStart;
        this.sliceStart = null;
      }
    }
  }

  pump() {
    if (this.disposed) return;
    this.inVm(() => {
      const r = this.runtime.executePendingJobs();
      if (r.error) r.error.dispose();
    });
    if (this.interrupted && this.abort) this.abort(new PluginError('PLUGIN_TIMEOUT', `插件執行超過 ${this.cpuLimit} ms`));
  }

  async load() {
    this.installHost();
    const vm = this.vm;
    const pre = this.inVm(() => vm.evalCode(PRELUDE, 'mekuri-prelude.js', { type: 'global', strict: true }));
    if (pre.error) throw this.toError(pre.error, 'prelude');
    pre.value.dispose();

    this.cpuUsed = 0;
    const res = this.inVm(() => vm.evalCode(this.opts.code, this.manifest.main ?? 'index.js', { type: 'module', strict: true }));
    if (res.error) throw this.toError(res.error, '載入插件');
    let ns = res.value;
    // 模組有頂層 await 時，evalCode 回傳的是匯出物件的 promise
    const st = vm.getPromiseState(ns);
    if (!(st.type === 'fulfilled' && st.notAPromise)) {
      if (st.type === 'fulfilled') st.value.dispose();
      else if (st.type === 'rejected') st.error.dispose();
      ns = await this.settle(ns);
    }
    vm.setProp(vm.global, '__plugin', ns);
    ns.dispose();
    this.pump();
  }

  /** 等待 VM 內的 promise，回傳結果 handle；逾時或被中斷時丟出 PluginError */
  settle(promiseHandle) {
    const vm = this.vm;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearTimeout(wall);
        this.abort = null;
        fn(v);
      };
      const wall = setTimeout(() => finish(reject, new PluginError('PLUGIN_TIMEOUT', `插件呼叫超過 ${this.wallLimit} ms 未完成`)), this.wallLimit);
      this.abort = (err) => finish(reject, err);
      vm.resolvePromise(promiseHandle).then(
        (r) => {
          if (r.error) {
            const err = this.toError(r.error);
            finish(reject, err);
          } else if (done) r.value.dispose();
          else finish(resolve, r.value);
        },
        (e) => finish(reject, e),
      );
      promiseHandle.dispose();
      this.pump();
    });
  }

  /** 把 VM 內的錯誤 handle 轉成 PluginError（並釋放 handle） */
  toError(errHandle, context) {
    const vm = this.vm;
    if (this.interrupted) {
      errHandle.dispose();
      return new PluginError('PLUGIN_TIMEOUT', `插件執行超過 ${this.cpuLimit} ms`);
    }
    let code;
    let name;
    let message;
    try {
      if (vm.typeof(errHandle) === 'object') {
        code = vm.getProp(errHandle, 'code').consume((h) => vm.dump(h));
        name = vm.getProp(errHandle, 'name').consume((h) => vm.dump(h));
        message = vm.getProp(errHandle, 'message').consume((h) => vm.dump(h));
      } else {
        message = String(vm.dump(errHandle));
      }
    } finally {
      errHandle.dispose();
    }
    const known = typeof code === 'string' && /^[A-Z_]+$/.test(code);
    const prefix = context ? `${context}：` : '';
    if (known) return new PluginError(code, `${prefix}${message}`);
    return new PluginError('PLUGIN_ERROR', `${prefix}${name ? name + ': ' : ''}${message}`);
  }

  // ───────── host 端原生函式 ─────────
  installHost() {
    const vm = this.vm;
    const host = vm.newObject();
    const sync = (name, fn) => {
      vm.newFunction(name, (...args) => {
        let out;
        try {
          out = { ok: true, v: fn(...args.map((a) => vm.dump(a))) ?? null };
        } catch (e) {
          out = { ok: false, code: e.code ?? (e instanceof TypeError ? 'TypeError' : 'PLUGIN_ERROR'), message: e.message };
        }
        return vm.newString(JSON.stringify(out));
      }).consume((f) => vm.setProp(host, name, f));
    };

    // http.request（非同步）
    vm.newFunction('request', (payloadHandle) => {
      const payload = vm.dump(payloadHandle);
      const deferred = vm.newPromise();
      this.httpRequest(JSON.parse(payload)).then(
        (v) => ({ ok: true, v }),
        (e) => ({ ok: false, code: e.code ?? 'NETWORK', message: e.message }),
      ).then((out) => {
        if (this.disposed) return;
        vm.newString(JSON.stringify(out)).consume((s) => deferred.resolve(s));
        deferred.dispose();
        this.pump();
      });
      return deferred.handle;
    }).consume((f) => vm.setProp(host, 'request', f));

    sync('env', () => JSON.stringify({ appVersion: this.opts.appVersion ?? '0.0.0-sdk', platform: this.opts.platform ?? 'windows', apiVersion: 1 }));
    sync('log', (line) => {
      this.log(String(line));
    });

    // html
    sync('htmlParse', (html, base) => {
      const root = parseHtml(String(html), { comment: false, blockTextElements: { script: true, noscript: true, style: true, pre: true } });
      return this.addNode(root, base ?? null);
    });
    sync('htmlSelect', (id, css) => {
      const n = this.getNode(id);
      return n.el.querySelectorAll(css).map((el) => this.addNode(el, n.base));
    });
    sync('htmlSelectFirst', (id, css) => {
      const n = this.getNode(id);
      const el = n.el.querySelector(css);
      return el ? this.addNode(el, n.base) : null;
    });
    sync('htmlText', (id) => this.getNode(id).el.text);
    sync('htmlHtml', (id) => this.getNode(id).el.innerHTML);
    sync('htmlAttr', (id, name) => this.getNode(id).el.getAttribute?.(name) ?? null);
    sync('htmlAbsUrl', (id, name) => {
      const n = this.getNode(id);
      const v = n.el.getAttribute?.(name);
      if (v === undefined || v === null) return null;
      try {
        return n.base ? new URL(v.trim(), n.base).href : new URL(v.trim()).href;
      } catch {
        return null;
      }
    });

    // storage（每個插件獨立，上限 1 MB）
    sync('storageGet', (key) => this.storage.get(key) ?? null);
    sync('storageSet', (key, json) => {
      const next = new Map(this.storage);
      next.set(key, json);
      let size = 0;
      for (const [k, v] of next) size += Buffer.byteLength(k) + Buffer.byteLength(v);
      if (size > LIMITS.storageBytes) throw new PluginError('PLUGIN_ERROR', 'storage 超過 1 MB 上限');
      this.storage = next;
    });
    sync('storageRemove', (key) => {
      this.storage.delete(key);
    });
    sync('settingsGet', (key) => (Object.hasOwn(this.settings, key) ? JSON.stringify(this.settings[key]) : null));

    // URL
    sync('urlParse', (input, base) => {
      let u;
      try {
        u = base === null ? new URL(input) : new URL(input, base);
      } catch {
        throw Object.assign(new TypeError(`Invalid URL: ${input}`), { code: 'TypeError' });
      }
      return urlParts(u);
    });
    sync('urlSet', (href, prop, value) => {
      const u = new URL(href);
      u[prop] = value;
      return urlParts(u);
    });

    // 計時器
    vm.newFunction('setTimeout', (fnHandle, msHandle) => {
      const fn = fnHandle.dup();
      const ms = Math.min(Math.max(0, Number(vm.dump(msHandle)) || 0), LIMITS.maxTimeoutMs);
      const id = this.nextTimer++;
      const t = setTimeout(() => {
        this.timers.delete(id);
        if (this.disposed) return;
        this.inVm(() => {
          const r = vm.callFunction(fn, vm.undefined);
          if (r.error) r.error.dispose();
          else r.value.dispose();
        });
        fn.dispose();
        this.pump();
      }, ms);
      this.timers.set(id, { t, fn });
      return vm.newNumber(id);
    }).consume((f) => vm.setProp(host, 'setTimeout', f));
    vm.newFunction('clearTimeout', (idHandle) => {
      const id = vm.dump(idHandle);
      const timer = this.timers.get(id);
      if (timer) {
        clearTimeout(timer.t);
        timer.fn.dispose();
        this.timers.delete(id);
      }
    }).consume((f) => vm.setProp(host, 'clearTimeout', f));

    vm.setProp(vm.global, '__host', host);
    host.dispose();
  }

  addNode(el, base) {
    const id = this.nextNode++;
    this.nodes.set(id, { el, base });
    return id;
  }

  getNode(id) {
    const n = this.nodes.get(id);
    if (!n) throw new PluginError('PLUGIN_ERROR', 'HTML 節點已失效');
    return n;
  }

  async httpRequest(req) {
    const method = (req.method ?? 'GET').toUpperCase();
    if (!METHODS.includes(method)) throw new PluginError('INVALID_INPUT', `不支援的 HTTP 方法：${req.method}`);
    if (req.headers !== undefined && (typeof req.headers !== 'object' || req.headers === null))
      throw new PluginError('INVALID_INPUT', 'headers 必須是物件');
    const headers = {};
    for (const [k, v] of Object.entries(req.headers ?? {})) {
      // Cookie 由 host 依網域自動附加，插件不可自行指定
      if (k.toLowerCase() === 'cookie') continue;
      headers[k] = String(v);
    }
    let url = req.url;
    let curMethod = method;
    let body = req.body === undefined || req.body === null ? undefined : String(req.body);
    for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
      const chk = checkUrlAllowed(this.domains, url);
      if (!chk.ok) throw new PluginError('PLUGIN_DOMAIN_DENIED', chk.reason);
      if (!this.opts.transport) throw new PluginError('NETWORK', '此沙盒沒有網路（未提供 transport）');
      const res = await withTimeout(
        Promise.resolve(this.opts.transport({ url: chk.url.href, method: curMethod, headers, body })),
        LIMITS.httpTimeoutMs,
        () => new PluginError('NETWORK', `HTTP 請求逾時（${LIMITS.httpTimeoutMs / 1000} 秒）：${chk.url.href}`),
      );
      const resHeaders = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) resHeaders[k.toLowerCase()] = String(v);
      if (REDIRECTS.includes(res.status) && resHeaders.location) {
        url = new URL(resHeaders.location, chk.url).href;
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && curMethod === 'POST')) {
          curMethod = 'GET';
          body = undefined;
        }
        continue;
      }
      const text = curMethod === 'HEAD' ? '' : (res.body ?? '');
      if (Buffer.byteLength(text) > LIMITS.httpMaxBodyBytes) throw new PluginError('NETWORK', '回應本文超過 10 MB 上限');
      let outBody = text;
      if (req.responseType === 'json') {
        try {
          outBody = text === '' ? null : JSON.parse(text);
        } catch {
          throw new PluginError('PLUGIN_ERROR', `回應不是合法的 JSON：${chk.url.href}`);
        }
      }
      return { status: res.status, headers: resHeaders, url: chk.url.href, body: outBody };
    }
    throw new PluginError('NETWORK', `重新導向超過 ${LIMITS.maxRedirects} 次`);
  }

  // ───────── 對外 ─────────

  /** 列出插件匯出的名稱與型別，例如 { search: 'function' } */
  exportTypes() {
    const r = this.inVm(() =>
      this.vm.evalCode('JSON.stringify(Object.fromEntries(Object.keys(__plugin).map((k) => [k, typeof __plugin[k]])))', 'exports.js', { type: 'global' }),
    );
    if (r.error) throw this.toError(r.error);
    return JSON.parse(r.value.consume((h) => this.vm.dump(h)));
  }

  /** 呼叫插件匯出的函式；參數與回傳值都必須可以 JSON 序列化 */
  async call(name, args = [], { cpuMsPerCall } = {}) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new PluginError('INVALID_INPUT', `函式名稱不合法：${name}`);
    const src = `(async () => {
      const fn = __plugin[${JSON.stringify(name)}];
      if (typeof fn !== 'function') { const e = new Error('插件沒有匯出函式 ${name}'); e.code = 'PLUGIN_ERROR'; throw e; }
      const v = await fn(...${JSON.stringify(args)});
      return JSON.stringify({ v });
    })()`;
    return this.runAsync(src, `call:${name}`, cpuMsPerCall);
  }

  /** 以 async 函式本體執行任意程式碼（測試案例的 eval） */
  async evalAsync(body, { cpuMsPerCall } = {}) {
    const src = `(async () => {\n${body}\n})().then((v) => JSON.stringify({ v }))`;
    return this.runAsync(src, 'eval', cpuMsPerCall);
  }

  async runAsync(src, filename, cpuMsPerCall) {
    if (this.disposed) throw new PluginError('PLUGIN_ERROR', '沙盒已釋放');
    this.cpuUsed = 0;
    this.interrupted = false;
    this.cpuLimit = cpuMsPerCall ?? this.opts.cpuMsPerCall ?? LIMITS.cpuMsPerCall;
    const r = this.inVm(() => this.vm.evalCode(src, filename, { type: 'global', strict: true }));
    if (r.error) throw this.toError(r.error);
    const h = await this.settle(r.value);
    const json = h.consume((x) => this.vm.dump(x));
    return typeof json === 'string' ? JSON.parse(json).v : undefined;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { t, fn } of this.timers.values()) {
      clearTimeout(t);
      fn.dispose();
    }
    this.timers.clear();
    try {
      this.vm.dispose();
      this.runtime.dispose();
    } catch {
      // 中斷或未完成的 promise 可能留下 handle；釋放失敗不影響結果
    }
  }
}

function urlParts(u) {
  return {
    href: u.href,
    origin: u.origin,
    protocol: u.protocol,
    username: u.username,
    password: u.password,
    host: u.host,
    hostname: u.hostname,
    port: u.port,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
  };
}

function withTimeout(p, ms, mkErr) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(mkErr()), ms)))]).finally(() => clearTimeout(t));
}
