#!/usr/bin/env node
// 由 sdk/examples/example-source 打包範例插件到 plugins/io.github.mekuri.example/。
// 用法：node scripts/build-example.mjs [--check]（--check：只確認已提交的插件包是最新的）
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPackage, PACKAGE_EXT } from '../sdk/lib/package.mjs';
import { readManifest } from '../sdk/lib/project.mjs';

const src = 'sdk/examples/example-source';
const manifest = readManifest(src);
const bytes = createPackage({ manifest, code: readFileSync(join(src, manifest.main ?? 'index.js')) });
const dir = join('plugins', manifest.id);
const pkgPath = join(dir, `${manifest.version}${PACKAGE_EXT}`);
const manifestJson = JSON.stringify(manifest, null, 2) + '\n';
const same =
  existsSync(pkgPath) &&
  Buffer.compare(readFileSync(pkgPath), Buffer.from(bytes)) === 0 &&
  existsSync(join(dir, 'manifest.json')) &&
  readFileSync(join(dir, 'manifest.json'), 'utf8') === manifestJson;
if (process.argv.includes('--check')) {
  console.log(same ? `${pkgPath} 是最新的` : `${pkgPath} 不是最新，請執行 npm run build:example`);
  process.exit(same ? 0 : 1);
}
mkdirSync(dir, { recursive: true });
writeFileSync(pkgPath, bytes);
writeFileSync(join(dir, 'manifest.json'), manifestJson);
console.log(`已打包 ${pkgPath}`);
