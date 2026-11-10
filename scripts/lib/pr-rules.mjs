// 插件 PR 的驗證規則（.github/workflows/validate.yml 使用；規則說明見 README「CI 檢查」）。
import { validateManifest, compareSemver, isSemver } from '../../sdk/lib/manifest.mjs';
import { verifyPackage } from '../../sdk/lib/verify.mjs';
import { MAX_PACKAGE_BYTES, PACKAGE_EXT, fmtBytes } from '../../sdk/lib/package.mjs';
import { deepEqual } from '../../sdk/lib/runner.mjs';
import { changedFiles, listFiles, showFile } from './git.mjs';

/** 可以修改基礎設施（plugins/ 以外）的作者身分（GitHub author_association） */
export const MAINTAINER_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** PR 內文必須勾選的來源合法聲明（.github/pull_request_template.md） */
export const LEGAL_DECLARATION_RE = /^[ \t]*[-*][ \t]+\[[xX]\][ \t]*我聲明此插件的來源合法/m;

const PLUGIN_PATH_RE = /^plugins\/([^/]+)\/(.+)$/;
const PACKAGE_NAME_RE = /^(.+)\.mekuri-plugin$/;
const ICON_FILES = ['icon.png', 'icon.svg'];

/**
 * 驗證 PR。
 * @param {object} o
 * @param {string} o.repoDir            PR 合併結果的 checkout
 * @param {string} o.base               base commit
 * @param {string} [o.head]             PR 合併結果的 commit（預設 HEAD）
 * @param {string} [o.authorAssociation]
 * @param {string} [o.body]             PR 內文
 * @param {number} [o.maxBytes]
 * @returns {Promise<{ errors: Array<{ file?: string, message: string }>, warnings: Array<{ file?: string, message: string }>, notes: string[], plugins: Array<{ id: string, action: string, version?: string }> }>}
 */
export async function validatePr({ repoDir, base, head = 'HEAD', authorAssociation = 'NONE', body = '', maxBytes = MAX_PACKAGE_BYTES }) {
  const errors = [];
  const warnings = [];
  const notes = [];
  const plugins = [];
  const err = (message, file) => errors.push({ file, message });
  const warn = (message, file) => warnings.push({ file, message });

  const changes = changedFiles(repoDir, base, head);
  const byPlugin = new Map();
  const other = [];
  for (const c of changes) {
    const m = PLUGIN_PATH_RE.exec(c.path);
    if (m) {
      if (!byPlugin.has(m[1])) byPlugin.set(m[1], []);
      byPlugin.get(m[1]).push({ ...c, name: m[2] });
    } else other.push(c);
  }
  const maintainer = MAINTAINER_ASSOCIATIONS.includes(authorAssociation);

  if (byPlugin.size === 0) {
    notes.push(`沒有修改 \`plugins/\`，視為基礎設施 PR，略過插件檢查（共 ${changes.length} 個檔案，由 CODEOWNERS 審查）。`);
    return { errors, warnings, notes, plugins };
  }

  if (!maintainer) {
    if (byPlugin.size > 1) err(`一個 PR 只能修改一個插件目錄，這個 PR 修改了：${[...byPlugin.keys()].map((k) => `plugins/${k}/`).join('、')}`);
    for (const c of other) err(`插件 PR 只能修改自己的插件目錄 \`plugins/<id>/\`，不能修改 ${c.path}`, c.path);
  } else if (other.length) {
    notes.push(`作者身分為 ${authorAssociation}（維護者），允許同時修改插件以外的檔案（${other.length} 個）。`);
  }

  const delistedRaw = showFile(repoDir, base, 'delisted.json');
  let delisted = [];
  try {
    delisted = delistedRaw ? JSON.parse(delistedRaw.toString('utf8')).plugins ?? [] : [];
  } catch {
    warn('base 的 delisted.json 不是合法的 JSON，略過下架名單檢查');
  }

  let needsDeclaration = false;
  for (const [id, files] of byPlugin) {
    const dir = `plugins/${id}`;
    const headFiles = listFiles(repoDir, head, dir).map((p) => p.slice(dir.length + 1));
    if (headFiles.length === 0) {
      notes.push(`\`${dir}/\` 已整個刪除：視為取消公開（unpublish），由 owner 確認。`);
      plugins.push({ id, action: 'unpublish' });
      continue;
    }
    needsDeclaration = true;
    const hit = delisted.find((d) => d.id === id);
    if (hit) err(`\`${id}\` 已被下架（${hit.reason ?? '見 delisted.json'}${hit.issue ? `，${hit.issue}` : ''}），不接受重新上架。`, dir);

    // 目錄內只能有 manifest.json、<version>.mekuri-plugin、icon.png／icon.svg（後者由 index CI 產生）
    for (const f of headFiles) {
      const pm = PACKAGE_NAME_RE.exec(f);
      if (f === 'manifest.json' || ICON_FILES.includes(f)) continue;
      if (pm && isSemver(pm[1])) continue;
      err(`\`${dir}/\` 只能包含 manifest.json 與 <version>.mekuri-plugin，不能有 ${f}`, `${dir}/${f}`);
    }

    // 已發佈的插件包不可修改
    for (const c of files) {
      if (PACKAGE_NAME_RE.test(c.name) && c.status === 'M') err(`已發佈的版本不可修改：${c.path}。請提高版本號並新增插件包。`, c.path);
    }

    const manifestBuf = showFile(repoDir, head, `${dir}/manifest.json`);
    if (!manifestBuf) {
      err(`缺少 ${dir}/manifest.json`, dir);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(manifestBuf.toString('utf8').replace(/^﻿/, ''));
    } catch (e) {
      err(`manifest.json 不是合法的 JSON：${e.message}`, `${dir}/manifest.json`);
      continue;
    }
    const v = validateManifest(manifest);
    if (!v.valid) {
      err(`manifest 欄位 \`${v.field}\` 不合法：${v.message}`, `${dir}/manifest.json`);
      continue;
    }
    if (manifest.id !== id) err(`目錄名稱必須與 manifest.id 相同：目錄是 \`${id}\`，manifest.id 是 \`${manifest.id}\``, `${dir}/manifest.json`);
    plugins.push({ id, action: 'publish', version: manifest.version });

    // 版本遞增（manifest 或目前版本的插件包有變動時）
    const pkgName = `${manifest.version}${PACKAGE_EXT}`;
    const touchedCurrent = files.some((c) => c.name === 'manifest.json' || c.name === pkgName);
    const baseManifestBuf = showFile(repoDir, base, `${dir}/manifest.json`);
    if (baseManifestBuf && touchedCurrent) {
      let baseVersion;
      try {
        baseVersion = JSON.parse(baseManifestBuf.toString('utf8').replace(/^﻿/, '')).version;
      } catch {
        baseVersion = undefined;
      }
      if (isSemver(baseVersion) && compareSemver(manifest.version, baseVersion) <= 0)
        err(`版本必須遞增：目前已上架 ${baseVersion}，這個 PR 是 ${manifest.version}`, `${dir}/manifest.json`);
    }

    // 插件包
    const pkg = showFile(repoDir, head, `${dir}/${pkgName}`);
    if (!pkg) {
      err(`缺少目前版本的插件包 ${dir}/${pkgName}`, `${dir}/manifest.json`);
      continue;
    }
    if (pkg.length > maxBytes) {
      err(`插件包大小 ${fmtBytes(pkg.length)} 超過上限 ${fmtBytes(maxBytes)}`, `${dir}/${pkgName}`);
      continue;
    }
    const r = await verifyPackage(new Uint8Array(pkg), { maxBytes });
    for (const e of r.errors) err(e, `${dir}/${pkgName}`);
    for (const w of r.warnings) warn(w, `${dir}/${pkgName}`);
    if (r.manifest && r.errors.length === 0 && !deepEqual(r.manifest, manifest)) {
      err(`${dir}/manifest.json 必須與插件包內的 manifest.json 內容相同`, `${dir}/manifest.json`);
    }
    if (r.manifest && r.errors.length === 0) notes.push(`\`${id}\` ${manifest.version}：插件包 ${fmtBytes(pkg.length)}，sha256 \`${r.sha256}\`，四個必要函式都已匯出。`);
  }

  if (needsDeclaration && !LEGAL_DECLARATION_RE.test(body ?? '')) {
    err('PR 內文必須勾選來源合法聲明：`- [x] 我聲明此插件的來源合法…`（見 PR 範本與 POLICY.md）');
  }
  return { errors, warnings, notes, plugins };
}

/** 產生 Actions Summary 用的 Markdown */
export function summaryMarkdown(result, repoUrl = 'https://github.com/mekuri-comics/mekuri-hub') {
  const lines = ['## 插件驗證', ''];
  if (result.errors.length === 0) lines.push('✅ 通過', '');
  else {
    lines.push(`❌ ${result.errors.length} 個錯誤`, '');
    for (const e of result.errors) lines.push(`- ${e.file ? `\`${e.file}\`：` : ''}${e.message}`);
    lines.push('');
  }
  if (result.warnings.length) {
    lines.push('### 警告', '');
    for (const w of result.warnings) lines.push(`- ${w.file ? `\`${w.file}\`：` : ''}${w.message}`);
    lines.push('');
  }
  if (result.notes.length) {
    lines.push('### 說明', '');
    for (const n of result.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push(`規則見 [POLICY.md](${repoUrl}/blob/main/POLICY.md) 與 [sdk/README.md](${repoUrl}/blob/main/sdk/README.md#集散地-ci-檢查什麼)。`);
  return lines.join('\n');
}
