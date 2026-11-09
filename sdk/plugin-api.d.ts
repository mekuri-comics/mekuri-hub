// 來源：mekuri-comics/mekuri `shared/contracts/plugin-api.d.ts`，commit d911e34b23c3ea4c81a51ccb2939eed6c8edd159（2026-11-10 複製）。
// 請勿直接修改；契約有變動時從 mekuri 重新複製並更新這一行。
/**
 * mekuri 插件 API v1 —— 插件作者與兩個 host 實作的共同契約（ADR-007、ADR-023）。
 * 本檔也會複製到 mekuri-hub 的插件 SDK（MIT 授權）。
 */

// ───────────── manifest.json ─────────────
export interface PluginManifest {
  /** 反向網域格式，全小寫，例：io.github.alice.example */
  id: string;
  name: string;
  /** semver */
  version: string;
  /** 目前為 1 */
  apiVersion: 1;
  author: string;
  description: string;
  homepage?: string;
  /** 套件內相對路徑，PNG 或 SVG，建議 256×256 */
  icon?: string;
  /** 主程式，套件內相對路徑，預設 index.js */
  main?: string;
  /** 分類，用於集散地篩選，例：["manga","webtoon","zh-TW"] */
  tags?: string[];
  /**
   * 允許連線的網域。支援 "example.com"（僅此網域）與 "*.example.com"（含所有子網域）。
   * 不允許 "*"、IP、localhost。圖片 CDN 也必須列出。
   */
  domains: string[];
  /** 建議閱讀方向 */
  readingDirection?: 'rtl' | 'ltr';
  /** 需要登入時提供 */
  login?: {
    url: string;                 // 開啟的登入頁，網域必須在 domains 內
    /** 用來判斷是否已登入的 Cookie 名稱（任一存在即視為已登入） */
    cookieNames?: string[];
  };
  settings?: PluginSetting[];
}

export type PluginSetting =
  | { key: string; type: 'select'; label: string; options: Array<{ value: string; label: string }>; default: string }
  | { key: string; type: 'toggle'; label: string; default: boolean }
  | { key: string; type: 'text'; label: string; default: string };

// ───────────── 插件必須匯出的函式（ES module 具名匯出）─────────────
export interface PluginModule {
  search(query: string, page: number): Promise<SearchPage>;
  getWork(workKey: string): Promise<SourceWork>;
  getChapters(workKey: string): Promise<SourceChapter[]>;
  getPages(chapterKey: string): Promise<SourcePage[]>;
  /** 選用：自訂登入判斷；未提供時以 manifest.login.cookieNames 判斷 */
  checkLogin?(): Promise<boolean>;
}

export interface SearchPage {
  items: Array<{ workKey: string; title: string; coverUrl?: string; subtitle?: string }>;
  hasMore: boolean;
}

export interface SourceWork {
  workKey: string;
  title: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  url?: string;
  readingDirection?: 'rtl' | 'ltr';
}

export interface SourceChapter {
  chapterKey: string;
  title: string;
  /** 話數，用於排序；無法判斷時省略 */
  number?: number;
  /** 回傳順序即章節順序（由舊到新） */
}

export interface SourcePage {
  url: string;
  /** 下載圖片時要附加的標頭（例如 Referer）。Cookie 由 host 自動附加，不可在此指定。 */
  headers?: Record<string, string>;
  /** 選用：圖片需要解碼（例如打亂拼圖）時，host 下載後交給插件的 decodeImage 處理 —— v1 不支援，保留欄位 */
  transform?: never;
}

// ───────────── Host API：全域物件 mekuri ─────────────
export interface MekuriHost {
  http: {
    /**
     * 只能連到 manifest.domains（且使用者已同意）中的網域，否則丟出 PLUGIN_DOMAIN_DENIED。
     * 自動附加該網域的登入 Cookie 與 App 的 User-Agent。重新導向到不允許的網域也會被拒絕。
     * 單次逾時 30 秒；回應本文上限 10 MB。
     */
    request(req: {
      url: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
      headers?: Record<string, string>;
      body?: string;
      responseType?: 'text' | 'json';
    }): Promise<{ status: number; headers: Record<string, string>; url: string; body: string | unknown }>;
  };
  html: {
    /** 在 host 端解析 HTML（不在沙盒內執行任何腳本） */
    parse(html: string, baseUrl?: string): HtmlDocument;
  };
  storage: {
    /** 每個插件獨立，總量上限 1 MB，值必須可 JSON 序列化 */
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  settings: {
    get(key: string): unknown;
  };
  log(...args: unknown[]): void;
  /** host 資訊 */
  env: { appVersion: string; platform: 'windows' | 'android'; apiVersion: 1 };
}

export interface HtmlDocument {
  select(css: string): HtmlNode[];
  selectFirst(css: string): HtmlNode | null;
}

export interface HtmlNode {
  text(): string;
  html(): string;
  attr(name: string): string | null;
  /** 解析為絕對網址（依 baseUrl） */
  absUrl(name: string): string | null;
  select(css: string): HtmlNode[];
  selectFirst(css: string): HtmlNode | null;
}

declare global {
  const mekuri: MekuriHost;
}

// ───────────── 沙盒限制（host 必須實作）─────────────
// - 每個插件一個 QuickJS runtime；記憶體上限 64 MB；單次呼叫 CPU 時間上限 20 秒（逾時丟 PLUGIN_TIMEOUT）。
// - 沒有 require/import 外部模組、沒有檔案系統、沒有計時器以外的非同步來源；提供 setTimeout（最長 10 秒）。
// - 提供 TextEncoder/TextDecoder、atob/btoa、URL、URLSearchParams、console（導向 mekuri.log）。
// - 插件程式碼必須是單一 ES module 檔（作者可自行打包）。
// - 插件包 .mekuri-plugin = ZIP：manifest.json + main + icon（選用），總大小 ≤ 50 MB。
