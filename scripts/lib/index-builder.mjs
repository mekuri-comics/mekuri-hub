// 產生 index.json（logic-layer §10.1）。App 讀 https://raw.githubusercontent.com/mekuri-comics/mekuri-hub/main/index.json。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { inspectPackage, PACKAGE_EXT } from '../../sdk/lib/package.mjs';
import { deepEqual } from '../../sdk/lib/runner.mjs';
import { git } from './git.mjs';

export const INDEX_API_VERSION = 1;
export const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com/mekuri-comics/mekuri-hub/main';

/**
 * @param {object} o
 * @param {string} o.repoDir
 * @param {string} [o.rawBase]     package／icon 網址的前綴
 * @param {Date}   [o.now]
 * @param {object} [o.previous]    舊的 index.json；內容沒變時沿用 generatedAt
 * @returns {{ index: object, icons: Array<{ path: string, bytes: Uint8Array }>, problems: string[], changed: boolean }}
 */
export function buildIndex({ repoDir, rawBase = DEFAULT_RAW_BASE, now = new Date(), previous }) {
  const problems = [];
  const icons = [];
  const plugins = [];
  const pluginsDir = join(repoDir, 'plugins');
  const ids = existsSync(pluginsDir) ? readdirSync(pluginsDir).filter((d) => statSync(join(pluginsDir, d)).isDirectory()).sort() : [];
  for (const id of ids) {
    const dir = join(pluginsDir, id);
    const rel = `plugins/${id}`;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      problems.push(`${rel}/manifest.json 無法讀取：${e.message}，略過`);
      continue;
    }
    const pkgName = `${manifest.version}${PACKAGE_EXT}`;
    const pkgPath = join(dir, pkgName);
    if (!existsSync(pkgPath)) {
      problems.push(`${rel}/${pkgName} 不存在，略過`);
      continue;
    }
    const bytes = readFileSync(pkgPath);
    const r = inspectPackage(new Uint8Array(bytes));
    if (r.errors.length) {
      problems.push(`${rel}/${pkgName} 不合法（${r.errors.join('；')}），略過`);
      continue;
    }
    if (r.manifest.id !== id || !deepEqual(r.manifest, manifest)) {
      problems.push(`${rel}/manifest.json 與插件包內容不一致，略過`);
      continue;
    }
    let icon = null;
    if (manifest.icon) {
      const ext = extname(manifest.icon).toLowerCase();
      const iconRel = `${rel}/icon${ext}`;
      icons.push({ path: iconRel, bytes: r.files[manifest.icon] });
      icon = `${rawBase}/${iconRel}`;
    }
    const committed = git(repoDir, ['log', '-1', '--format=%cI', '--', `${rel}/${pkgName}`], { allowFail: true })?.trim();
    plugins.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      domains: manifest.domains,
      tags: manifest.tags ?? [],
      icon,
      package: `${rawBase}/${rel}/${pkgName}`,
      sha256: r.sha256,
      updatedAt: committed ? new Date(committed).toISOString() : now.toISOString(),
    });
  }
  const changed = !(previous && deepEqual(previous.plugins, plugins) && previous.apiVersion === INDEX_API_VERSION);
  const generatedAt = !changed && previous.generatedAt ? previous.generatedAt : now.toISOString();
  return { index: { apiVersion: INDEX_API_VERSION, generatedAt, plugins }, icons, problems, changed };
}
