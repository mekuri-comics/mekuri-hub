// 測試輔助：建立暫存 git repo 與插件包
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPackage } from '../sdk/lib/package.mjs';

export const EXAMPLE_DIR = new URL('../sdk/examples/example-source/', import.meta.url);
export const exampleManifest = () => JSON.parse(readFileSync(new URL('manifest.json', EXAMPLE_DIR), 'utf8'));
export const exampleCode = () => readFileSync(new URL('index.js', EXAMPLE_DIR), 'utf8');

export function tempDir(prefix = 'mekuri-hub-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export class TempRepo {
  constructor() {
    this.dir = tempDir();
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.name', 'test');
    this.git('config', 'user.email', 'test@example.test');
    this.git('config', 'commit.gpgsign', 'false');
  }
  git(...args) {
    return execFileSync('git', args, { cwd: this.dir }).toString().trim();
  }
  write(path, content) {
    const full = join(this.dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  remove(path) {
    rmSync(join(this.dir, path), { recursive: true, force: true });
  }
  commit(msg = 'c') {
    this.git('add', '-A');
    this.git('commit', '-q', '--allow-empty', '-m', msg);
    return this.git('rev-parse', 'HEAD');
  }
  /** 放一個插件（manifest.json + <version>.mekuri-plugin） */
  addPlugin(manifest, code = exampleCode(), { dirName = manifest.id, pkgManifest = manifest } = {}) {
    this.write(`plugins/${dirName}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
    this.write(`plugins/${dirName}/${pkgManifest.version}.mekuri-plugin`, createPackage({ manifest: pkgManifest, code }));
  }
  dispose() {
    cleanup(this.dir);
  }
}

export const LEGAL_BODY = '## 聲明\n- [x] 我聲明此插件的來源合法，且不繞過 DRM、付費牆或其他存取限制。\n';
