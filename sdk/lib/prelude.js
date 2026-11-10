// 沙盒前置程式：在 QuickJS 內執行，建立全域 mekuri 與標準物件（plugin-api.d.ts「沙盒限制」）。
// 只透過 __host 的原生函式與 host 溝通；執行完會移除 __host。
(function () {
  'use strict';
  const H = globalThis.__host;
  delete globalThis.__host;

  function mkErr(code, message) {
    const e = new Error(message);
    e.name = code;
    e.code = code;
    return e;
  }
  // 同步原生呼叫：host 一律回傳 JSON 字串 { ok, v } 或 { ok:false, code, message }
  function call(name) {
    const args = Array.prototype.slice.call(arguments, 1);
    const r = JSON.parse(H[name].apply(null, args));
    if (!r.ok) throw r.code === 'TypeError' ? new TypeError(r.message) : mkErr(r.code, r.message);
    return r.v;
  }
  function define(obj, key, value) {
    Object.defineProperty(obj, key, { value, writable: false, enumerable: false, configurable: false });
  }

  // ───────── html ─────────
  function wrapNode(id) {
    if (id === null || id === undefined) return null;
    return new HtmlNode(id);
  }
  class HtmlNode {
    #id;
    constructor(id) {
      this.#id = id;
    }
    select(css) {
      return call('htmlSelect', this.#id, String(css)).map(wrapNode);
    }
    selectFirst(css) {
      return wrapNode(call('htmlSelectFirst', this.#id, String(css)));
    }
    text() {
      return call('htmlText', this.#id);
    }
    html() {
      return call('htmlHtml', this.#id);
    }
    attr(name) {
      return call('htmlAttr', this.#id, String(name));
    }
    absUrl(name) {
      return call('htmlAbsUrl', this.#id, String(name));
    }
  }
  class HtmlDocument {
    #id;
    constructor(id) {
      this.#id = id;
    }
    select(css) {
      return call('htmlSelect', this.#id, String(css)).map(wrapNode);
    }
    selectFirst(css) {
      return wrapNode(call('htmlSelectFirst', this.#id, String(css)));
    }
  }

  // ───────── http ─────────
  function request(req) {
    if (req === null || typeof req !== 'object' || typeof req.url !== 'string') {
      return Promise.reject(mkErr('INVALID_INPUT', 'mekuri.http.request 需要 { url }'));
    }
    const payload = JSON.stringify({
      url: req.url,
      method: req.method,
      headers: req.headers,
      body: req.body,
      responseType: req.responseType,
    });
    return H.request(payload).then((json) => {
      const r = JSON.parse(json);
      if (!r.ok) throw mkErr(r.code, r.message);
      return r.v;
    });
  }

  // ───────── storage ─────────
  const storage = {
    get(key) {
      return new Promise((resolve) => {
        const v = call('storageGet', String(key));
        resolve(v === null ? undefined : JSON.parse(v));
      });
    },
    set(key, value) {
      return new Promise((resolve) => {
        const json = JSON.stringify(value);
        if (json === undefined) throw mkErr('INVALID_INPUT', 'storage 的值必須可以 JSON 序列化');
        call('storageSet', String(key), json);
        resolve(undefined);
      });
    },
    remove(key) {
      return new Promise((resolve) => {
        call('storageRemove', String(key));
        resolve(undefined);
      });
    },
  };

  function fmt(a) {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.name + ': ' + a.message;
    try {
      const s = JSON.stringify(a);
      return s === undefined ? String(a) : s;
    } catch (_) {
      return String(a);
    }
  }
  function log() {
    H.log(Array.prototype.map.call(arguments, fmt).join(' '));
  }

  const env = Object.freeze(JSON.parse(call('env')));
  const mekuri = Object.freeze({
    http: Object.freeze({ request }),
    html: Object.freeze({
      parse(html, baseUrl) {
        return new HtmlDocument(call('htmlParse', String(html), baseUrl === undefined || baseUrl === null ? null : String(baseUrl)));
      },
    }),
    storage: Object.freeze(storage),
    settings: Object.freeze({
      get(key) {
        const v = call('settingsGet', String(key));
        return v === null ? undefined : JSON.parse(v);
      },
    }),
    log,
    env,
  });
  define(globalThis, 'mekuri', mekuri);

  // ───────── console ─────────
  define(globalThis, 'console', Object.freeze({ log, info: log, warn: log, error: log, debug: log }));

  // ───────── 計時器（最長 10 秒）─────────
  define(globalThis, 'setTimeout', function setTimeout(fn, ms) {
    if (typeof fn !== 'function') throw new TypeError('setTimeout 需要函式');
    const args = Array.prototype.slice.call(arguments, 2);
    return H.setTimeout(() => fn.apply(null, args), Number(ms) || 0);
  });
  define(globalThis, 'clearTimeout', function clearTimeout(id) {
    if (typeof id === 'number') H.clearTimeout(id);
  });

  // ───────── atob / btoa ─────────
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  define(globalThis, 'btoa', function btoa(input) {
    const s = String(input);
    let out = '';
    for (let i = 0; i < s.length; i += 3) {
      const a = s.charCodeAt(i);
      const b = s.charCodeAt(i + 1);
      const c = s.charCodeAt(i + 2);
      if (a > 255 || b > 255 || c > 255) throw mkErr('InvalidCharacterError', 'btoa 只接受 Latin1 字元');
      const n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < s.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < s.length ? B64[n & 63] : '=');
    }
    return out;
  });
  define(globalThis, 'atob', function atob(input) {
    const s = String(input).replace(/[\t\n\f\r ]/g, '').replace(/=+$/, '');
    if (s.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(s)) throw mkErr('InvalidCharacterError', 'atob 輸入不是合法的 base64');
    let out = '';
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < s.length; i++) {
      buf = (buf << 6) | B64.indexOf(s[i]);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out += String.fromCharCode((buf >> bits) & 255);
      }
    }
    return out;
  });

  // ───────── TextEncoder / TextDecoder（UTF-8）─────────
  class TextEncoder {
    get encoding() {
      return 'utf-8';
    }
    encode(input) {
      const s = input === undefined ? '' : String(input);
      const out = [];
      for (let i = 0; i < s.length; i++) {
        let cp = s.charCodeAt(i);
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
          const lo = s.charCodeAt(i + 1);
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
            i++;
          } else cp = 0xfffd;
        } else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
        if (cp < 0x80) out.push(cp);
        else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
        else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
      return new Uint8Array(out);
    }
  }
  class TextDecoder {
    constructor(label) {
      const l = label === undefined ? 'utf-8' : String(label).toLowerCase();
      if (l !== 'utf-8' && l !== 'utf8') throw new RangeError('TextDecoder 只支援 utf-8');
    }
    get encoding() {
      return 'utf-8';
    }
    decode(input) {
      if (input === undefined) return '';
      const b = input instanceof Uint8Array ? input : new Uint8Array(input.buffer || input);
      let out = '';
      for (let i = 0; i < b.length; ) {
        const c = b[i];
        let cp;
        let n;
        if (c < 0x80) [cp, n] = [c, 1];
        else if (c >= 0xc2 && c < 0xe0) [cp, n] = [c & 31, 2];
        else if (c >= 0xe0 && c < 0xf0) [cp, n] = [c & 15, 3];
        else if (c >= 0xf0 && c < 0xf5) [cp, n] = [c & 7, 4];
        else [cp, n] = [0xfffd, 1];
        let ok = n === 1 || i + n <= b.length;
        for (let k = 1; ok && k < n; k++) {
          if ((b[i + k] & 0xc0) !== 0x80) ok = false;
          else cp = (cp << 6) | (b[i + k] & 63);
        }
        if (!ok) {
          out += '�';
          i += 1;
          continue;
        }
        out += String.fromCodePoint(cp);
        i += n;
      }
      return out;
    }
  }
  define(globalThis, 'TextEncoder', TextEncoder);
  define(globalThis, 'TextDecoder', TextDecoder);

  // ───────── URLSearchParams / URL ─────────
  function formEncode(s) {
    return encodeURIComponent(s).replace(/[!'()~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+');
  }
  function formDecode(s) {
    try {
      return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch (_) {
      return s;
    }
  }
  const LINK = Symbol('link');
  const RESET = Symbol('reset');
  class URLSearchParams {
    #list = [];
    #onChange = null;
    constructor(init) {
      if (init === undefined || init === null) return;
      if (typeof init === 'string') this.#parse(init);
      else if (init instanceof URLSearchParams) this.#list = init.#list.map((p) => p.slice());
      else if (typeof init[Symbol.iterator] === 'function') {
        for (const p of init) this.#list.push([String(p[0]), String(p[1])]);
      } else if (typeof init === 'object') {
        for (const k of Object.keys(init)) this.#list.push([k, String(init[k])]);
      }
    }
    #parse(s) {
      this.#list = [];
      const q = s.startsWith('?') ? s.slice(1) : s;
      for (const part of q.split('&')) {
        if (!part) continue;
        const i = part.indexOf('=');
        this.#list.push(i < 0 ? [formDecode(part), ''] : [formDecode(part.slice(0, i)), formDecode(part.slice(i + 1))]);
      }
    }
    #changed() {
      if (this.#onChange) this.#onChange(this.toString());
    }
    static [LINK](params, search, onChange) {
      params.#parse(search);
      params.#onChange = onChange;
    }
    static [RESET](params, search) {
      params.#parse(search);
    }
    get size() {
      return this.#list.length;
    }
    append(k, v) {
      this.#list.push([String(k), String(v)]);
      this.#changed();
    }
    delete(k) {
      k = String(k);
      this.#list = this.#list.filter((p) => p[0] !== k);
      this.#changed();
    }
    get(k) {
      const p = this.#list.find((x) => x[0] === String(k));
      return p ? p[1] : null;
    }
    getAll(k) {
      return this.#list.filter((x) => x[0] === String(k)).map((x) => x[1]);
    }
    has(k) {
      return this.#list.some((x) => x[0] === String(k));
    }
    set(k, v) {
      k = String(k);
      const i = this.#list.findIndex((x) => x[0] === k);
      if (i < 0) this.#list.push([k, String(v)]);
      else {
        this.#list[i][1] = String(v);
        this.#list = this.#list.filter((x, j) => j <= i || x[0] !== k);
      }
      this.#changed();
    }
    sort() {
      this.#list.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      this.#changed();
    }
    forEach(cb, thisArg) {
      for (const [k, v] of this.#list) cb.call(thisArg, v, k, this);
    }
    keys() {
      return this.#list.map((p) => p[0])[Symbol.iterator]();
    }
    values() {
      return this.#list.map((p) => p[1])[Symbol.iterator]();
    }
    entries() {
      return this.#list.map((p) => [p[0], p[1]])[Symbol.iterator]();
    }
    [Symbol.iterator]() {
      return this.entries();
    }
    toString() {
      return this.#list.map((p) => formEncode(p[0]) + '=' + formEncode(p[1])).join('&');
    }
  }
  const URL_PROPS = ['href', 'origin', 'protocol', 'username', 'password', 'host', 'hostname', 'port', 'pathname', 'search', 'hash'];
  const urlState = new WeakMap(); // URL -> { parts, params }
  function stateOf(u) {
    const st = urlState.get(u);
    if (!st) throw new TypeError('不是 URL 物件');
    return st;
  }
  class URL {
    constructor(input, base) {
      urlState.set(this, { parts: call('urlParse', String(input), base === undefined ? null : String(base)), params: null });
    }
    static canParse(input, base) {
      try {
        new URL(input, base);
        return true;
      } catch (_) {
        return false;
      }
    }
    get searchParams() {
      const st = stateOf(this);
      if (!st.params) {
        st.params = new URLSearchParams();
        URLSearchParams[LINK](st.params, st.parts.search, (s) => {
          st.parts = call('urlSet', st.parts.href, 'search', s);
        });
      }
      return st.params;
    }
    toString() {
      return stateOf(this).parts.href;
    }
    toJSON() {
      return stateOf(this).parts.href;
    }
  }
  for (const p of URL_PROPS) {
    const desc = {
      get() {
        return stateOf(this).parts[p];
      },
      enumerable: true,
      configurable: true,
    };
    if (p !== 'origin') {
      desc.set = function (v) {
        const st = stateOf(this);
        st.parts = call('urlSet', st.parts.href, p, String(v));
        if (st.params) URLSearchParams[RESET](st.params, st.parts.search);
      };
    }
    Object.defineProperty(URL.prototype, p, desc);
  }
  define(globalThis, 'URL', URL);
  define(globalThis, 'URLSearchParams', URLSearchParams);
})();
