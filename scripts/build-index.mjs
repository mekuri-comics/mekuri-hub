#!/usr/bin/env node
// 重新產生 index.json 與插件圖示（.github/workflows/index.yml，推送到 main 時執行）。
// 用法：node scripts/build-index.mjs [--repo .] [--raw-base <網址>] [--check]
//   --check：只檢查 index.json 是否為最新，不寫檔（不是最新時結束碼 1）
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { buildIndex, DEFAULT_RAW_BASE } from './lib/index-builder.mjs';

const { values } = parseArgs({
  options: { repo: { type: 'string', default: '.' }, 'raw-base': { type: 'string' }, check: { type: 'boolean' } },
});
const repo = values.repo;
const rawBase =
  values['raw-base'] ?? (process.env.GITHUB_REPOSITORY ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/main` : DEFAULT_RAW_BASE);
const indexPath = join(repo, 'index.json');
const previous = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : undefined;
const { index, icons, problems, changed } = buildIndex({ repoDir: repo, rawBase, previous });
for (const p of problems) console.log(process.env.GITHUB_ACTIONS === 'true' ? `::warning::${p}` : `警告：${p}`);

let iconsChanged = false;
for (const { path, bytes } of icons) {
  const full = join(repo, path);
  if (existsSync(full) && Buffer.compare(readFileSync(full), Buffer.from(bytes)) === 0) continue;
  iconsChanged = true;
  if (!values.check) {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
}
if (values.check) {
  if (changed || iconsChanged) {
    console.log('index.json 或插件圖示不是最新，請執行 npm run build:index');
    process.exit(1);
  }
  console.log('index.json 是最新的');
  process.exit(0);
}
if (changed) writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
console.log(`${changed ? '已更新' : '沒有變動'} index.json：${index.plugins.length} 個插件${iconsChanged ? '；已更新圖示' : ''}`);
