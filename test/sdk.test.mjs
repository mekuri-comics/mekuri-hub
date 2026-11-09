// SDK：本機測試工具跑 example-source 的全部案例；範本專案從零建立、建置、測試、打包、檢查。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCases } from '../sdk/lib/runner.mjs';
import { loadPlugin, initProject, packProject, readJson } from '../sdk/lib/project.mjs';
import { verifyPackage } from '../sdk/lib/verify.mjs';
import { tempDir, cleanup } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(ROOT, 'sdk', 'bin', 'mekuri-plugin.mjs');
const EXAMPLE = join(ROOT, 'sdk', 'examples', 'example-source');
const CASES = readJson(join(EXAMPLE, 'cases.json'));

test('example-source：cases.json 全部通過（原始碼）', async () => {
  const { manifest, code } = loadPlugin(EXAMPLE);
  const r = await runCases({ manifest, code, cases: CASES });
  assert.equal(r.failed, 0, JSON.stringify(r.results.filter((x) => !x.ok), null, 2));
  assert.equal(r.passed, CASES.cases.length);
});

test('example-source：cases.json 全部通過（集散地上的插件包）', async () => {
  const { manifest, code } = loadPlugin(join(ROOT, 'plugins', 'io.github.mekuri.example', '1.0.0.mekuri-plugin'));
  const r = await runCases({ manifest, code, cases: CASES });
  assert.equal(r.failed, 0);
});

test('測試工具會回報失敗的案例', async () => {
  const { manifest, code } = loadPlugin(EXAMPLE);
  const cases = {
    responses: CASES.responses,
    cases: [
      { call: 'getWork', args: ['42'], expect: { workKey: '42' } },
      { eval: 'return 1', expectError: 'PLUGIN_TIMEOUT' },
      { call: 'getWork', args: ['404'] },
    ],
  };
  const r = await runCases({ manifest, code, cases });
  assert.deepEqual(r.results.map((x) => x.ok), [false, false, false]);
  assert.match(r.results[2].message, /PLUGIN_ERROR/);
});

test('CLI：mekuri-plugin test 對 example-source 通過，結束碼 0', () => {
  const out = execFileSync(process.execPath, [CLI, 'test', EXAMPLE]).toString();
  assert.match(out, /8 通過，0 失敗/);
});

test('從零建立插件：init → build → test → pack → validate（依 sdk/README.md）', async () => {
  const dir = tempDir('mekuri-plugin-');
  try {
    const project = join(dir, 'my-plugin');
    execFileSync(process.execPath, [CLI, 'init', project, '--id', 'io.github.alice.mysource', '--name', '我的來源', '--author', 'alice']);
    const manifest = readJson(join(project, 'manifest.json'));
    assert.equal(manifest.id, 'io.github.alice.mysource');
    assert.equal(manifest.author, 'alice');
    const pkg = readJson(join(project, 'package.json'));
    assert.match(pkg.devDependencies['@mekuri/plugin-sdk'], /^file:/);
    assert.equal(existsSync(join(project, 'node_modules')), false);

    execFileSync(process.execPath, [CLI, 'build', project]);
    assert.ok(existsSync(join(project, 'dist', 'index.js')));
    const out = execFileSync(process.execPath, [CLI, 'test', project]).toString();
    assert.match(out, /8 通過，0 失敗/);

    // 修改程式碼後測試失敗，表示測試工具確實在跑最新程式碼
    const src = join(project, 'src', 'index.ts');
    writeFileSync(src, readFileSync(src, 'utf8').replace("title: w.title,", "title: w.title + '!',"));
    assert.throws(() => execFileSync(process.execPath, [CLI, 'test', project], { stdio: 'pipe' }));

    writeFileSync(src, readFileSync(src, 'utf8').replace("title: w.title + '!',", 'title: w.title,'));
    const hub = join(dir, 'hub');
    const { outputs } = await packProject(project, { hubDir: hub });
    assert.ok(outputs.some((o) => o.endsWith(join('plugins', 'io.github.alice.mysource', '0.1.0.mekuri-plugin'))));
    const bytes = readFileSync(join(project, 'dist', '0.1.0.mekuri-plugin'));
    const v = await verifyPackage(new Uint8Array(bytes));
    assert.deepEqual(v.errors, []);
    assert.deepEqual(v.warnings, []);
    assert.ok(v.files['icon.svg']);
    const validate = execFileSync(process.execPath, [CLI, 'validate', join(project, 'dist', '0.1.0.mekuri-plugin')]).toString();
    assert.match(validate, /通過：io\.github\.alice\.mysource 0\.1\.0/);
  } finally {
    cleanup(dir);
  }
});

test('init 拒絕不合法的 id', () => {
  const dir = tempDir('mekuri-plugin-');
  try {
    assert.throws(() => initProject(join(dir, 'x'), { id: 'Bad.ID' }), /manifest 欄位 id/);
  } finally {
    cleanup(dir);
  }
});
