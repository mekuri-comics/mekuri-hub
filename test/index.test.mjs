// index.json 產生（scripts/lib/index-builder.mjs）與 repo 內容一致性
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildIndex, DEFAULT_RAW_BASE } from '../scripts/lib/index-builder.mjs';
import { createPackage } from '../sdk/lib/package.mjs';
import { TempRepo, exampleManifest } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('buildIndex：格式依 logic-layer §10.1，含 sha256，圖示另外輸出', () => {
  const repo = new TempRepo();
  try {
    repo.addPlugin(exampleManifest());
    const withIcon = { ...exampleManifest(), id: 'io.github.alice.demo', icon: 'icon.svg' };
    delete withIcon.tags;
    repo.write(`plugins/${withIcon.id}/manifest.json`, JSON.stringify(withIcon));
    const pkg = createPackage({ manifest: withIcon, code: 'export {}', icon: Buffer.from('<svg/>') });
    repo.write(`plugins/${withIcon.id}/1.0.0.mekuri-plugin`, pkg);
    repo.write('plugins/broken.id/manifest.json', '{');
    repo.commit();
    const now = new Date('2026-01-01T00:00:00Z');
    const { index, icons, problems, changed } = buildIndex({ repoDir: repo.dir, rawBase: 'https://raw.test/hub', now });
    assert.equal(changed, true);
    assert.equal(index.apiVersion, 1);
    assert.equal(index.generatedAt, now.toISOString());
    assert.deepEqual(index.plugins.map((p) => p.id), ['io.github.alice.demo', 'io.github.mekuri.example']);
    const demo = index.plugins[0];
    assert.deepEqual(Object.keys(demo), ['id', 'name', 'version', 'author', 'description', 'domains', 'tags', 'icon', 'package', 'sha256', 'updatedAt']);
    assert.equal(demo.icon, 'https://raw.test/hub/plugins/io.github.alice.demo/icon.svg');
    assert.equal(demo.package, 'https://raw.test/hub/plugins/io.github.alice.demo/1.0.0.mekuri-plugin');
    assert.equal(demo.sha256, createHash('sha256').update(pkg).digest('hex'));
    assert.deepEqual(demo.tags, []);
    assert.match(demo.updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.equal(index.plugins[1].icon, null);
    assert.deepEqual(icons.map((i) => i.path), ['plugins/io.github.alice.demo/icon.svg']);
    assert.equal(problems.length, 1);

    // 內容沒變時沿用 generatedAt（不產生新的 commit）
    const again = buildIndex({ repoDir: repo.dir, rawBase: 'https://raw.test/hub', now: new Date(), previous: index });
    assert.equal(again.changed, false);
    assert.equal(again.index.generatedAt, index.generatedAt);
  } finally {
    repo.dispose();
  }
});

test('repo 內的範例插件包與 sdk/examples 一致', () => {
  execFileSync(process.execPath, ['scripts/build-example.mjs', '--check'], { cwd: ROOT });
});

test('repo 內的 index.json 格式正確，且列出的插件包 sha256 相符', () => {
  // 插件 PR 不需要更新 index.json（合併後由 CI 產生），所以這裡只檢查已列出的項目
  const committed = JSON.parse(readFileSync(join(ROOT, 'index.json'), 'utf8'));
  assert.equal(committed.apiVersion, 1);
  assert.ok(!Number.isNaN(Date.parse(committed.generatedAt)));
  const { index } = buildIndex({ repoDir: ROOT, rawBase: DEFAULT_RAW_BASE });
  for (const p of committed.plugins) {
    const now = index.plugins.find((x) => x.id === p.id);
    if (!now || now.version !== p.version) continue;
    const { updatedAt: _a, ...a } = p;
    const { updatedAt: _b, ...b } = now;
    assert.deepEqual(a, b);
  }
});
