// 沙盒 Host API 與限制（plugin-api.d.ts）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox } from '../sdk/lib/sandbox.mjs';
import { fakeTransport } from '../sdk/lib/runner.mjs';
import { checkExports } from '../sdk/lib/verify.mjs';

const manifest = {
  id: 'io.github.test.sandbox',
  name: 'Sandbox',
  version: '1.0.0',
  apiVersion: 1,
  author: 't',
  description: '',
  domains: ['example.test', '*.img.example.test'],
  settings: [
    { key: 'lang', type: 'select', label: '語言', options: [{ value: 'zh', label: '中文' }, { value: 'ja', label: '日文' }], default: 'zh' },
    { key: 'hd', type: 'toggle', label: '高畫質', default: false },
  ],
};
const PLUGIN = `
export async function search() { return { items: [], hasMore: false }; }
export async function getWork(k) { return { workKey: k, title: 't' }; }
export async function getChapters() { return []; }
export async function getPages() { return []; }
`;

async function withSb(opts, fn) {
  const sb = await createSandbox({ manifest, code: PLUGIN, ...opts });
  try {
    return await fn(sb);
  } finally {
    sb.dispose();
  }
}

test('html.parse：select／selectFirst／text／html／attr／absUrl', async () => {
  const v = await withSb({}, (sb) =>
    sb.evalAsync(`
      const doc = mekuri.html.parse('<ul><li class="a" data-x="1"><a href="/p?q=1">一 &amp; 二</a></li><li class="a"><a href="https://a.img.example.test/x.jpg">b</a></li><li><a>c</a></li></ul>', 'https://example.test/dir/page');
      const lis = doc.select('li.a');
      return {
        n: lis.length,
        text: lis[0].text(),
        html: lis[0].html(),
        attr: lis[0].attr('data-x'),
        missing: lis[0].attr('nope'),
        abs: lis.map((li) => li.selectFirst('a').absUrl('href')),
        none: doc.selectFirst('li:last-child a').absUrl('href'),
        nested: doc.selectFirst('ul').select('a').length,
        nothing: doc.selectFirst('.nothing'),
      };
    `),
  );
  assert.deepEqual(v, {
    n: 2,
    text: '一 & 二',
    html: '<a href="/p?q=1">一 &amp; 二</a>',
    attr: '1',
    missing: null,
    abs: ['https://example.test/p?q=1', 'https://a.img.example.test/x.jpg'],
    none: null,
    nested: 3,
    nothing: null,
  });
});

test('http.request：網域、https、重新導向、json、方法', async () => {
  const transport = fakeTransport({
    'https://example.test/r': { status: 302, headers: { Location: 'https://evil.test/' } },
    'https://example.test/r2': { status: 301, headers: { Location: '/j' } },
    'https://example.test/j': { status: 200, contentType: 'application/json', body: '{"a":1}' },
    'POST https://example.test/p': { status: 201, body: 'posted' },
  });
  await withSb({ transport }, async (sb) => {
    await assert.rejects(sb.evalAsync(`await mekuri.http.request({ url: 'https://example.test/r' })`), { code: 'PLUGIN_DOMAIN_DENIED' });
    await assert.rejects(sb.evalAsync(`await mekuri.http.request({ url: 'https://img.example.test/' })`), { code: 'PLUGIN_DOMAIN_DENIED' });
    await assert.rejects(sb.evalAsync(`await mekuri.http.request({ url: 'ftp://example.test/' })`), { code: 'PLUGIN_DOMAIN_DENIED' });
    const r = await sb.evalAsync(`return await mekuri.http.request({ url: 'https://example.test/r2', responseType: 'json' })`);
    assert.deepEqual(r, { status: 200, headers: { 'content-type': 'application/json' }, url: 'https://example.test/j', body: { a: 1 } });
    const p = await sb.evalAsync(`const r = await mekuri.http.request({ url: 'https://example.test/p', method: 'POST', body: 'x' }); return [r.status, r.body]`);
    assert.deepEqual(p, [201, 'posted']);
    const nf = await sb.evalAsync(`return (await mekuri.http.request({ url: 'https://a.img.example.test/none' })).status`);
    assert.equal(nf, 404);
    await assert.rejects(sb.evalAsync(`await mekuri.http.request({ url: 'https://example.test/', method: 'PATCH' })`), { code: 'INVALID_INPUT' });
  });
});

test('沒有 transport 時請求失敗（NETWORK）', async () => {
  await withSb({}, async (sb) => {
    await assert.rejects(sb.evalAsync(`await mekuri.http.request({ url: 'https://example.test/' })`), { code: 'NETWORK' });
  });
});

test('storage、settings、env、log', async () => {
  const logs = [];
  const v = await withSb({ settings: { hd: true }, storage: { seed: [1] }, log: (l) => logs.push(l), platform: 'android' }, (sb) =>
    sb.evalAsync(`
      await mekuri.storage.set('k', { a: 1 });
      const a = await mekuri.storage.get('k');
      await mekuri.storage.remove('k');
      const b = await mekuri.storage.get('k');
      mekuri.log('hello', { x: 1 });
      console.log('via console');
      let big = null;
      try { await mekuri.storage.set('big', 'x'.repeat(1100000)); } catch (e) { big = e.code; }
      return { a, b, seed: await mekuri.storage.get('seed'), lang: mekuri.settings.get('lang'), hd: mekuri.settings.get('hd'), none: mekuri.settings.get('none'), env: mekuri.env, big };
    `),
  );
  assert.deepEqual(v, { a: { a: 1 }, seed: [1], lang: 'zh', hd: true, env: { appVersion: '0.0.0-sdk', platform: 'android', apiVersion: 1 }, big: 'PLUGIN_ERROR' });
  assert.deepEqual(logs, ['hello {"x":1}', 'via console']);
});

test('標準物件：URL、URLSearchParams、TextEncoder／Decoder、atob／btoa、setTimeout', async () => {
  const v = await withSb({}, (sb) =>
    sb.evalAsync(`
      const u = new URL('../b?x=1&y=a+b#h', 'https://example.test/a/c');
      u.searchParams.set('x', '海 2');
      const p = new URLSearchParams({ q: "a&b !'" });
      let bad = null;
      try { new URL('nope'); } catch (e) { bad = e instanceof TypeError; }
      const t0 = Date.now();
      const order = [];
      await new Promise((r) => { setTimeout(() => { order.push('t'); r(); }, 30); order.push('s'); });
      const cancelled = setTimeout(() => order.push('never'), 1);
      clearTimeout(cancelled);
      await new Promise((r) => setTimeout(r, 10));
      return {
        href: u.href, host: u.hostname, y: u.searchParams.get('y'), p: p.toString(),
        bad, canParse: URL.canParse('https://x.test'),
        enc: Array.from(new TextEncoder().encode('海a')), dec: new TextDecoder().decode(new TextEncoder().encode('漫畫😀')),
        b64: btoa('mekuri'), unb64: atob('bWVrdXJp'), order, waited: Date.now() - t0 >= 25,
        noHost: typeof __host, noRequire: typeof require, noFetch: typeof fetch, noProcess: typeof process,
      };
    `),
  );
  assert.deepEqual(v, {
    href: 'https://example.test/b?x=%E6%B5%B7+2&y=a+b#h',
    host: 'example.test',
    y: 'a b',
    p: 'q=a%26b+%21%27',
    bad: true,
    canParse: true,
    enc: [230, 181, 183, 97],
    dec: '漫畫😀',
    b64: 'bWVrdXJp',
    unb64: 'mekuri',
    order: ['s', 't'],
    waited: true,
    noHost: 'undefined',
    noRequire: 'undefined',
    noFetch: 'undefined',
    noProcess: 'undefined',
  });
});

test('逾時：無窮迴圈與永不完成的 promise', async () => {
  await withSb({}, async (sb) => {
    await assert.rejects(sb.evalAsync('while (true) {}', { cpuMsPerCall: 300 }), { code: 'PLUGIN_TIMEOUT' });
  });
  await withSb({ wallMsPerCall: 300 }, async (sb) => {
    await assert.rejects(sb.evalAsync('await new Promise(() => {})'), { code: 'PLUGIN_TIMEOUT' });
  });
  await withSb({}, async (sb) => {
    // 非同步回呼中的無窮迴圈也會被中斷
    await assert.rejects(sb.evalAsync('await new Promise((r) => setTimeout(r, 5)); while (true) {}', { cpuMsPerCall: 300 }), { code: 'PLUGIN_TIMEOUT' });
  });
});

test('插件丟出的錯誤轉成 PLUGIN_ERROR', async () => {
  await withSb({}, async (sb) => {
    await assert.rejects(sb.evalAsync(`throw new Error('壞掉了')`), (e) => e.code === 'PLUGIN_ERROR' && e.message.includes('壞掉了'));
    await assert.rejects(sb.call('nope'), { code: 'PLUGIN_ERROR' });
    assert.deepEqual(await sb.call('getWork', ['42']), { workKey: '42', title: 't' });
  });
});

test('checkExports：缺少函式、import、語法錯誤、頂層無窮迴圈', async () => {
  assert.deepEqual(await checkExports(manifest, PLUGIN), []);
  const missing = await checkExports(manifest, 'export async function search() {}\nexport const getWork = 1;');
  assert.equal(missing.length, 3);
  assert.match(missing.join('\n'), /getWork/);
  assert.match(missing.join('\n'), /getChapters/);
  assert.match((await checkExports(manifest, `import x from 'fs';\n${PLUGIN}`))[0], /無法在 QuickJS 中載入/);
  assert.match((await checkExports(manifest, 'export function ('))[0], /無法在 QuickJS 中載入/);
  assert.match((await checkExports(manifest, `while (true) {}\n${PLUGIN}`))[0], /PLUGIN_TIMEOUT/);
  assert.match((await checkExports(manifest, `${PLUGIN}\nexport const checkLogin = true;`))[0], /checkLogin/);
  // 頂層 await 也可以
  assert.deepEqual(await checkExports(manifest, `await Promise.resolve();\n${PLUGIN}`), []);
});
