#!/usr/bin/env node
// mekuri-plugin：插件專案的建立、建置、測試、打包與檢查。
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { initProject, buildProject, loadPlugin, findCases, packProject, readJson } from '../lib/project.mjs';
import { runCases, formatResults } from '../lib/runner.mjs';
import { verifyPackage } from '../lib/verify.mjs';
import { createPackage, fmtBytes } from '../lib/package.mjs';

const HELP = `用法：mekuri-plugin <指令> [選項]

指令：
  init <資料夾> [--id <id>] [--name <名稱>] [--author <作者>]
      以範本建立新的插件專案
  build [資料夾]
      用 esbuild 把 src/index.ts 打包成單一 ES module（dist/<main>）
  test [資料夾|插件包] [--cases <cases.json>] [--platform windows|android] [--verbose]
      在 QuickJS 沙盒中以假 HTTP 回應執行測試案例
  pack [資料夾] [--hub <mekuri-hub 路徑>]
      建置並打包成 dist/<version>.mekuri-plugin；--hub 會一併放到 <hub>/plugins/<id>/
  validate [資料夾|插件包]
      執行集散地 CI 的插件包檢查（manifest、大小、內容、四個必要函式）
`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      id: { type: 'string' },
      name: { type: 'string' },
      author: { type: 'string' },
      cases: { type: 'string' },
      platform: { type: 'string' },
      hub: { type: 'string' },
      verbose: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const target = resolve(positionals[0] ?? '.');
  switch (values.help || cmd === '--help' || cmd === '-h' ? 'help' : cmd) {
    case 'init': {
      if (!positionals[0]) throw new Error('請指定資料夾：mekuri-plugin init <資料夾>');
      const { dir, manifest } = initProject(target, values);
      console.log(`已建立 ${manifest.id}：${dir}\n\n下一步：\n  cd ${positionals[0]}\n  npm install\n  npm run build\n  npm test`);
      return 0;
    }
    case 'build': {
      const { outfile } = await buildProject(target);
      console.log(`已建置 ${outfile}`);
      return 0;
    }
    case 'test': {
      // TypeScript 專案先建置，確保測的是最新的程式碼
      if (!target.endsWith('.mekuri-plugin') && existsSync(join(target, 'src'))) await buildProject(target);
      const plugin = loadPlugin(target);
      const casesPath = values.cases ? resolve(values.cases) : findCases(plugin.dir);
      if (!casesPath) throw new Error('找不到測試案例（test/cases.json），請用 --cases 指定');
      const cases = readJson(casesPath);
      console.log(`插件：${plugin.manifest.id} ${plugin.manifest.version}（${plugin.source}）\n案例：${casesPath}\n`);
      const r = await runCases({
        manifest: plugin.manifest,
        code: plugin.code,
        cases,
        platform: values.platform,
        log: values.verbose ? (line) => console.log(`    log ${line}`) : undefined,
      });
      console.log(formatResults(r));
      return r.failed === 0 ? 0 : 1;
    }
    case 'pack': {
      const { manifest, bytes, outputs } = await packProject(target, { hubDir: values.hub });
      console.log(`已打包 ${manifest.id} ${manifest.version}（${fmtBytes(bytes.length)}）：\n${outputs.map((o) => '  ' + o).join('\n')}`);
      return 0;
    }
    case 'validate': {
      let bytes;
      if (target.endsWith('.mekuri-plugin')) bytes = readFileSync(target);
      else {
        const { manifest, code } = loadPlugin(target);
        const icon = manifest.icon !== undefined ? readFileSync(join(target, manifest.icon)) : undefined;
        bytes = createPackage({ manifest, code, icon });
      }
      const r = await verifyPackage(bytes);
      for (const w of r.warnings) console.log(`警告：${w}`);
      for (const e of r.errors) console.log(`錯誤：${e}`);
      if (r.errors.length) return 1;
      console.log(`通過：${r.manifest.id} ${r.manifest.version}，sha256 ${r.sha256}`);
      return 0;
    }
    case 'help':
    case undefined:
      console.log(HELP);
      return 0;
    default:
      console.error(`未知的指令：${cmd}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`錯誤：${e.message}`);
    process.exit(1);
  },
);
