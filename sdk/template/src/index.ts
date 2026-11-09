/// <reference types="@mekuri/plugin-sdk/sandbox-globals" />
// mekuri 插件範本。對應不存在的示範網站 example.test；請改成你的網站（並同步修改 manifest.json 的 domains）。
// 插件必須匯出 search、getWork、getChapters、getPages 四個函式；checkLogin 選用。
// 全域物件 mekuri 的型別來自 @mekuri/plugin-sdk（plugin-api.d.ts）。
import type { SearchPage, SourceWork, SourceChapter, SourcePage } from '@mekuri/plugin-sdk';
import { getJson, BASE } from './http';

interface WorkJson {
  title: string;
  author?: string;
  cover?: string;
  chapters: Array<{ id: string; name: string; no?: number }>;
}

export async function search(query: string, page: number): Promise<SearchPage> {
  const res = await mekuri.http.request({ url: `${BASE}/search?q=${encodeURIComponent(query)}&p=${page}` });
  const doc = mekuri.html.parse(res.body as string, res.url);
  const items = doc.select('.result').map((el) => ({
    workKey: el.attr('data-id') ?? '',
    title: el.selectFirst('.title')?.text().trim() ?? '',
    coverUrl: el.selectFirst('img')?.absUrl('src') ?? undefined,
  }));
  return { items, hasMore: doc.selectFirst('.next') !== null };
}

export async function getWork(workKey: string): Promise<SourceWork> {
  const w = await getJson<WorkJson>(`/api/works/${workKey}`);
  return { workKey, title: w.title, author: w.author, coverUrl: w.cover, url: `${BASE}/works/${workKey}` };
}

export async function getChapters(workKey: string): Promise<SourceChapter[]> {
  const w = await getJson<WorkJson>(`/api/works/${workKey}`);
  // 回傳順序即章節順序（由舊到新）
  return w.chapters.map((c) => ({ chapterKey: `${workKey}/${c.id}`, title: c.name, number: c.no }));
}

export async function getPages(chapterKey: string): Promise<SourcePage[]> {
  const ch = await getJson<{ images: string[] }>(`/api/chapters/${chapterKey}`);
  // Cookie 由 App 自動附加，這裡只能指定其他標頭（例如 Referer）
  return ch.images.map((url) => ({ url, headers: { Referer: `${BASE}/` } }));
}

export async function checkLogin(): Promise<boolean> {
  const res = await mekuri.http.request({ url: `${BASE}/api/me`, responseType: 'json' });
  return res.status === 200 && (res.body as { loggedIn?: boolean }).loggedIn === true;
}
