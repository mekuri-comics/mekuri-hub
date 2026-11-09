// 範例插件：示範 mekuri 插件 API v1 的全部必要函式。
const BASE = 'https://example.test';

export async function search(query, page) {
  const res = await mekuri.http.request({
    url: `${BASE}/search?q=${encodeURIComponent(query)}&p=${page}`,
  });
  const doc = mekuri.html.parse(res.body, res.url);
  const items = doc.select('.result').map((el) => ({
    workKey: el.attr('data-id'),
    title: el.selectFirst('.title').text().trim(),
    coverUrl: el.selectFirst('img')?.absUrl('src') ?? undefined,
  }));
  return { items, hasMore: doc.selectFirst('.next') !== null };
}

export async function getWork(workKey) {
  const res = await mekuri.http.request({ url: `${BASE}/api/works/${workKey}`, responseType: 'json' });
  const w = res.body;
  return { workKey, title: w.title, author: w.author, coverUrl: w.cover, url: `${BASE}/works/${workKey}` };
}

export async function getChapters(workKey) {
  const res = await mekuri.http.request({ url: `${BASE}/api/works/${workKey}`, responseType: 'json' });
  return res.body.chapters.map((c) => ({ chapterKey: `${workKey}/${c.id}`, title: c.name, number: c.no }));
}

export async function getPages(chapterKey) {
  const res = await mekuri.http.request({ url: `${BASE}/api/chapters/${chapterKey}`, responseType: 'json' });
  return res.body.images.map((url) => ({ url, headers: { Referer: `${BASE}/` } }));
}

export async function checkLogin() {
  const res = await mekuri.http.request({ url: `${BASE}/api/me`, responseType: 'json' });
  return res.status === 200 && res.body.loggedIn === true;
}
