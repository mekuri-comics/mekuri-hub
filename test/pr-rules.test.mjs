// PR 驗證規則（scripts/lib/pr-rules.mjs）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { validatePr } from '../scripts/lib/pr-rules.mjs';
import { TempRepo, exampleManifest, LEGAL_BODY } from './helpers.mjs';

/** 建立 repo：base 已有範例插件 1.0.0；fn 修改後 commit 成 head，回傳驗證結果 */
async function scenario(fn, { association = 'NONE', body = LEGAL_BODY, withExample = true, maxBytes } = {}) {
  const repo = new TempRepo();
  try {
    repo.write('README.md', '# hub\n');
    if (withExample) repo.addPlugin(exampleManifest());
    const base = repo.commit('base');
    await fn(repo);
    const head = repo.commit('head');
    return await validatePr({ repoDir: repo.dir, base, head, authorAssociation: association, body, maxBytes });
  } finally {
    repo.dispose();
  }
}

const msgs = (r) => r.errors.map((e) => e.message).join('\n');
const newManifest = (patch = {}) => ({ ...exampleManifest(), id: 'io.github.alice.demo', name: 'Demo', author: 'alice', ...patch });

test('合法的新插件通過', async () => {
  const r = await scenario((repo) => repo.addPlugin(newManifest()));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.plugins, [{ id: 'io.github.alice.demo', action: 'publish', version: '1.0.0' }]);
});

test('合法的版本更新通過（舊版插件包可保留）', async () => {
  const r = await scenario((repo) => repo.addPlugin({ ...exampleManifest(), version: '1.1.0' }));
  assert.deepEqual(r.errors, []);
});

test('domains 含 * → 失敗並指出欄位', async () => {
  const r = await scenario((repo) => repo.addPlugin(newManifest({ domains: ['*'] }), undefined, { pkgManifest: newManifest() }));
  assert.match(msgs(r), /manifest 欄位 `domains` 不合法/);
});

test('目錄名稱與 manifest.id 不同 → 失敗', async () => {
  const r = await scenario((repo) => repo.addPlugin(newManifest(), undefined, { dirName: 'io.github.alice.other' }));
  assert.match(msgs(r), /目錄名稱必須與 manifest\.id 相同/);
});

test('版本沒有遞增 → 失敗', async () => {
  const r = await scenario((repo) => {
    const m = { ...exampleManifest(), description: '改了說明' };
    repo.write(`plugins/${m.id}/manifest.json`, JSON.stringify(m, null, 2));
  });
  assert.match(msgs(r), /版本必須遞增：目前已上架 1\.0\.0/);
});

test('版本變小 → 失敗', async () => {
  const r = await scenario(async (repo) => {
    repo.remove('plugins/io.github.mekuri.example');
    repo.addPlugin({ ...exampleManifest(), version: '0.9.0' });
  });
  assert.match(msgs(r), /版本必須遞增/);
});

test('修改已發佈的插件包 → 失敗', async () => {
  const r = await scenario((repo) => {
    const m = exampleManifest();
    repo.addPlugin(m, `${'// changed\n'}export async function search(){}\nexport async function getWork(){}\nexport async function getChapters(){}\nexport async function getPages(){}`);
  });
  assert.match(msgs(r), /已發佈的版本不可修改/);
});

test('非維護者修改插件目錄以外的檔案 → 失敗；維護者可以', async () => {
  const change = (repo) => {
    repo.addPlugin(newManifest());
    repo.write('README.md', '# changed\n');
  };
  const r = await scenario(change);
  assert.match(msgs(r), /只能修改自己的插件目錄.*README\.md/);
  const r2 = await scenario(change, { association: 'OWNER' });
  assert.deepEqual(r2.errors, []);
});

test('非維護者一次修改兩個插件 → 失敗', async () => {
  const r = await scenario((repo) => {
    repo.addPlugin(newManifest());
    repo.addPlugin({ ...exampleManifest(), version: '1.0.1' });
  });
  assert.match(msgs(r), /一個 PR 只能修改一個插件目錄/);
});

test('沒有修改 plugins/ 的基礎設施 PR 略過插件檢查', async () => {
  const r = await scenario((repo) => repo.write('POLICY.md', 'x'), { body: '' });
  assert.deepEqual(r.errors, []);
  assert.match(r.notes[0], /基礎設施 PR/);
});

test('刪除整個插件目錄（取消公開）不需要其他檢查', async () => {
  const r = await scenario((repo) => repo.remove('plugins/io.github.mekuri.example'), { body: '' });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.plugins, [{ id: 'io.github.mekuri.example', action: 'unpublish' }]);
});

test('缺少來源合法聲明 → 失敗', async () => {
  const r = await scenario((repo) => repo.addPlugin(newManifest()), { body: '- [ ] 我聲明此插件的來源合法' });
  assert.match(msgs(r), /來源合法聲明/);
});

test('插件目錄有多餘檔案、缺少插件包 → 失敗', async () => {
  const r = await scenario((repo) => {
    const m = newManifest();
    repo.write(`plugins/${m.id}/manifest.json`, JSON.stringify(m));
    repo.write(`plugins/${m.id}/cover.jpg`, 'x');
  });
  assert.match(msgs(r), /不能有 cover\.jpg/);
  assert.match(msgs(r), /缺少目前版本的插件包/);
});

test('插件包內容不合法：缺 main、manifest 不一致、未匯出函式、超過大小', async () => {
  const m = newManifest();
  const noMain = await scenario((repo) => {
    repo.write(`plugins/${m.id}/manifest.json`, JSON.stringify(m));
    repo.write(`plugins/${m.id}/1.0.0.mekuri-plugin`, zipSync({ 'manifest.json': strToU8(JSON.stringify(m)) }));
  });
  assert.match(msgs(noMain), /缺少主程式 index\.js/);

  const mismatch = await scenario((repo) => repo.addPlugin(m, undefined, { pkgManifest: { ...m, name: '別的名字' } }));
  assert.match(msgs(mismatch), /必須與插件包內的 manifest\.json 內容相同/);

  const noExports = await scenario((repo) => repo.addPlugin(m, 'export async function search() { return { items: [], hasMore: false }; }'));
  assert.match(msgs(noExports), /沒有匯出必要函式 getWork/);
  assert.match(msgs(noExports), /getPages/);

  const tooBig = await scenario((repo) => repo.addPlugin(m), { maxBytes: 100 });
  assert.match(msgs(tooBig), /超過上限/);

  const notZip = await scenario((repo) => {
    repo.write(`plugins/${m.id}/manifest.json`, JSON.stringify(m));
    repo.write(`plugins/${m.id}/1.0.0.mekuri-plugin`, 'not a zip');
  });
  assert.match(msgs(notZip), /必須是 ZIP/);
});

test('已下架的 id 不能重新上架', async () => {
  const r = await scenario(
    async (repo) => repo.addPlugin(newManifest()),
    {
      withExample: false,
    },
  );
  assert.deepEqual(r.errors, []);
  const repo = new TempRepo();
  try {
    repo.write('delisted.json', JSON.stringify({ plugins: [{ id: 'io.github.alice.demo', reason: '盜版來源', issue: '#1' }] }));
    const base = repo.commit();
    repo.addPlugin(newManifest());
    const head = repo.commit();
    const r2 = await validatePr({ repoDir: repo.dir, base, head, body: LEGAL_BODY });
    assert.match(msgs(r2), /已被下架（盜版來源，#1）/);
  } finally {
    repo.dispose();
  }
});
