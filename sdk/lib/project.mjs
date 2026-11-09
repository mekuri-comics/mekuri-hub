// 插件專案的建置、打包、載入與建立（mekuri-plugin CLI 使用）。
// 專案結構（sdk/template）：
//   manifest.json          插件資訊
//   src/index.ts|js        程式進入點
//   test/cases.json        測試案例（假 HTTP 回應）
//   icon.svg|png           選用，路徑寫在 manifest.icon
//   dist/                  build 產物：dist/<main>、dist/<version>.mekuri-plugin
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, mainOf } from './manifest.mjs';
import { createPackage, inspectPackage, PACKAGE_EXT } from './package.mjs';

export const SDK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TEMPLATE_DIR = join(SDK_DIR, 'template');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
}

export function readManifest(dir) {
  const path = join(dir, 'manifest.json');
  if (!existsSync(path)) throw new Error(`找不到 ${path}`);
  const manifest = readJson(path);
  const v = validateManifest(manifest);
  if (!v.valid) throw new Error(`manifest 欄位 ${v.field} 不合法：${v.message}`);
  return manifest;
}

function findEntry(dir) {
  for (const f of ['src/index.ts', 'src/index.js', 'src/index.mjs']) if (existsSync(join(dir, f))) return join(dir, f);
  return null;
}

/** 用 esbuild 打包成單一 ES module：dist/<main> */
export async function buildProject(dir) {
  const manifest = readManifest(dir);
  const entry = findEntry(dir);
  if (!entry) throw new Error(`找不到進入點 src/index.ts（${dir}）`);
  const outfile = join(dir, 'dist', mainOf(manifest));
  const esbuild = await import('esbuild');
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2020',
    charset: 'utf8',
    legalComments: 'inline',
    logLevel: 'warning',
  });
  return { manifest, outfile };
}

/**
 * 載入插件：可以是插件包、已 build 的專案（dist/<main>），或 manifest 與主程式在同一層的資料夾。
 * @returns {{ manifest: object, code: string, source: string, dir: string }}
 */
export function loadPlugin(target) {
  const p = resolve(target);
  if (p.endsWith(PACKAGE_EXT)) {
    const r = inspectPackage(readFileSync(p));
    if (r.errors.length) throw new Error(r.errors.join('\n'));
    return { manifest: r.manifest, code: r.code, source: p, dir: dirname(p) };
  }
  const manifest = readManifest(p);
  const main = mainOf(manifest);
  for (const f of [join(p, 'dist', main), join(p, main)]) {
    if (existsSync(f)) return { manifest, code: readFileSync(f, 'utf8'), source: f, dir: p };
  }
  throw new Error(`找不到主程式 ${main}。TypeScript 專案請先執行 npm run build。`);
}

/** 找測試案例：test/cases.json 或 cases.json */
export function findCases(dir) {
  for (const f of [join(dir, 'test', 'cases.json'), join(dir, 'cases.json')]) if (existsSync(f)) return f;
  return null;
}

/** 打包成 dist/<version>.mekuri-plugin；hubDir 有值時另外放到 <hub>/plugins/<id>/ */
export async function packProject(dir, { hubDir } = {}) {
  if (findEntry(dir)) await buildProject(dir);
  const { manifest, code } = loadPlugin(dir);
  let icon;
  if (manifest.icon !== undefined) {
    const iconPath = join(dir, manifest.icon);
    if (!existsSync(iconPath)) throw new Error(`找不到圖示 ${iconPath}（manifest.icon）`);
    icon = readFileSync(iconPath);
  }
  const bytes = createPackage({ manifest, code, icon });
  const out = join(dir, 'dist', `${manifest.version}${PACKAGE_EXT}`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  const outputs = [out];
  if (hubDir) {
    const target = join(resolve(hubDir), 'plugins', manifest.id);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, `${manifest.version}${PACKAGE_EXT}`), bytes);
    writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    outputs.push(join(target, `${manifest.version}${PACKAGE_EXT}`), join(target, 'manifest.json'));
  }
  return { manifest, bytes, outputs };
}

/** 從 sdk/template 建立新專案 */
export function initProject(targetDir, { id, name, author } = {}) {
  const dir = resolve(targetDir);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} 已存在且不是空資料夾`);
  cpSync(TEMPLATE_DIR, dir, {
    recursive: true,
    filter: (src) => !relative(TEMPLATE_DIR, src).split(/[\\/]/).some((s) => s === 'node_modules' || s === 'dist' || s === 'package-lock.json'),
  });
  const manifestPath = join(dir, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (id) manifest.id = id;
  if (name) manifest.name = name;
  if (author) manifest.author = author;
  const v = validateManifest(manifest);
  if (!v.valid) throw new Error(`manifest 欄位 ${v.field} 不合法：${v.message}`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const pkgPath = join(dir, 'package.json');
  const pkg = readJson(pkgPath);
  pkg.name = (id ?? basename(dir)).replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
  let rel = relative(dir, SDK_DIR).split('\\').join('/');
  if (!rel.startsWith('.')) rel = './' + rel;
  pkg.devDependencies['@mekuri/plugin-sdk'] = `file:${rel}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return { dir, manifest };
}
