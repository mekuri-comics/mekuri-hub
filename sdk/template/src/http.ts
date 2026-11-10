/// <reference types="@mekuri/plugin-sdk/sandbox-globals" />
// 共用的請求輔助函式。build 時 esbuild 會把所有檔案打包成單一 ES module。
export const BASE = 'https://example.test';

export async function getJson<T>(path: string): Promise<T> {
  const res = await mekuri.http.request({ url: `${BASE}${path}`, responseType: 'json' });
  if (res.status !== 200) throw new Error(`HTTP ${res.status}：${res.url}`);
  return res.body as T;
}
