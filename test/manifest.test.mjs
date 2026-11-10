// manifest 驗證規則必須與 mekuri `shared/fixtures/plugin/manifest-cases.json` 一致（副本：test/fixtures/，來源見 SOURCE.md）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest, domainMatches, compareSemver, checkUrlAllowed, isValidDomainPattern } from '../sdk/lib/manifest.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/manifest-cases.json', import.meta.url), 'utf8'));

for (const c of fixture.cases) {
  test(`manifest-cases：${c.name}`, () => {
    const r = validateManifest({ ...fixture.base, ...c.patch });
    assert.equal(r.valid, c.valid, JSON.stringify(r));
    if (!c.valid) {
      assert.equal(r.error, 'INVALID_INPUT');
      assert.equal(r.field, c.field);
    }
  });
}

for (const c of fixture.domainMatch) {
  test(`domainMatch：${c.pattern} ~ ${c.host} → ${c.match}`, () => {
    assert.equal(domainMatches(c.pattern, c.host), c.match);
  });
}

test('domains 其他不合法格式', () => {
  for (const d of ['*', '*.com', 'Example.com', 'example.com:443', '[::1]', '10.0.0.1', '*.localhost', 'a..b', '-a.com', 'example.com/', '']) {
    assert.equal(isValidDomainPattern(d), false, d);
  }
  for (const d of ['example.test', '*.img.example.test', 'xn--fiq228c.tw', 'a-b.example.com']) assert.equal(isValidDomainPattern(d), true, d);
});

test('checkUrlAllowed：只允許 https 與宣告的網域', () => {
  const domains = fixture.base.domains;
  assert.equal(checkUrlAllowed(domains, 'https://example.com/a').ok, true);
  assert.equal(checkUrlAllowed(domains, 'http://example.com/a').ok, false);
  assert.equal(checkUrlAllowed(domains, 'https://www.example.com/').ok, false);
  assert.equal(checkUrlAllowed(domains, 'https://x.cdn.example.com/').ok, true);
  assert.equal(checkUrlAllowed(domains, 'https://u:p@example.com/').ok, false);
  assert.equal(checkUrlAllowed(domains, 'not a url').ok, false);
});

test('compareSemver', () => {
  assert.ok(compareSemver('1.0.1', '1.0.0') > 0);
  assert.ok(compareSemver('1.10.0', '1.9.0') > 0);
  assert.ok(compareSemver('1.0.0', '1.0.0-beta.2') > 0);
  assert.ok(compareSemver('1.0.0-beta.10', '1.0.0-beta.2') > 0);
  assert.ok(compareSemver('1.0.0-alpha', '1.0.0-1') > 0);
  assert.equal(compareSemver('1.0.0+build.1', '1.0.0'), 0);
  assert.ok(compareSemver('0.9.9', '1.0.0') < 0);
});

test('settings 與其他選用欄位', () => {
  const base = fixture.base;
  const opt = [{ value: 'zh', label: '中文' }];
  assert.equal(validateManifest({ ...base, settings: [{ key: 'lang', type: 'select', label: '語言', options: opt, default: 'zh' }] }).valid, true);
  assert.equal(validateManifest({ ...base, settings: [{ key: 'lang', type: 'select', label: '語言', options: opt, default: 'en' }] }).field, 'settings[0].default');
  assert.equal(validateManifest({ ...base, settings: [{ key: 'x', type: 'toggle', label: 'X', default: 'yes' }] }).field, 'settings[0].default');
  assert.equal(validateManifest({ ...base, main: '../index.js' }).field, 'main');
  assert.equal(validateManifest({ ...base, icon: 'icon.gif' }).field, 'icon');
  assert.equal(validateManifest({ ...base, login: { url: 'http://example.com/login' } }).field, 'login.url');
});
