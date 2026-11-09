// git 輔助函式（CI 腳本用）
import { execFileSync } from 'node:child_process';

export function git(cwd, args, { buffer = false, allowFail = false } = {}) {
  try {
    const out = execFileSync('git', args, { cwd, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return buffer ? out : out.toString('utf8');
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} 失敗：${e.stderr?.toString() ?? e.message}`);
  }
}

/** 讀取某個 commit 的檔案；不存在回傳 null */
export function showFile(cwd, rev, path) {
  return git(cwd, ['show', `${rev}:${path}`], { buffer: true, allowFail: true });
}

/** 列出某個 commit 在 dir 底下的所有檔案 */
export function listFiles(cwd, rev, dir) {
  const out = git(cwd, ['ls-tree', '-r', '-z', '--name-only', rev, '--', dir], { allowFail: true });
  return out ? out.split('\0').filter(Boolean) : [];
}

/** base 到 head 的變更：[{ status: 'A'|'M'|'D'|..., path }] */
export function changedFiles(cwd, base, head) {
  const out = git(cwd, ['diff', '--name-status', '-z', '--no-renames', base, head]);
  const parts = out.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ status: parts[i][0], path: parts[i + 1] });
  return files;
}
