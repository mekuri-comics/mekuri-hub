#!/usr/bin/env node
// PR 驗證（.github/workflows/validate.yml）。
// 用法：node scripts/validate-pr.mjs --repo <PR checkout> --base <base sha> [--head HEAD]
// 環境變數：PR_BODY、PR_AUTHOR_ASSOCIATION、GITHUB_STEP_SUMMARY（選用）
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { validatePr, summaryMarkdown } from './lib/pr-rules.mjs';

const { values } = parseArgs({
  options: { repo: { type: 'string', default: '.' }, base: { type: 'string' }, head: { type: 'string', default: 'HEAD' } },
});
const base = values.base ?? process.env.BASE_SHA;
if (!base) {
  console.error('缺少 --base（或環境變數 BASE_SHA）');
  process.exit(2);
}

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const result = await validatePr({
  repoDir: values.repo,
  base,
  head: values.head,
  authorAssociation: process.env.PR_AUTHOR_ASSOCIATION ?? 'NONE',
  body: process.env.PR_BODY ?? '',
});

const inActions = process.env.GITHUB_ACTIONS === 'true';
for (const n of result.notes) console.log(`說明：${n}`);
for (const w of result.warnings) console.log(inActions ? `::warning${w.file ? ` file=${w.file}` : ''}::${esc(w.message)}` : `警告：${w.file ? w.file + '：' : ''}${w.message}`);
for (const e of result.errors) console.log(inActions ? `::error${e.file ? ` file=${e.file}` : ''}::${esc(e.message)}` : `錯誤：${e.file ? e.file + '：' : ''}${e.message}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  const repoUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? 'mekuri-comics/mekuri-hub'}`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(result, repoUrl) + '\n');
}
console.log(result.errors.length ? `\n驗證失敗：${result.errors.length} 個錯誤` : '\n驗證通過');
process.exit(result.errors.length ? 1 : 0);
