# mekuri 插件 SDK

用 TypeScript（或 JavaScript）為 mekuri 漫畫閱讀器撰寫網站插件，在本機用假資料測試，最後發佈到集散地。

> 寫插件之前請先讀 [上架政策](../POLICY.md)：**不接受盜版來源，也不接受繞過 DRM／付費牆的插件。** 本教學的範例都使用不存在的示範網站 `example.test`。

SDK 以 [MIT 授權](LICENSE) 提供。

## 目錄

| 路徑 | 內容 |
|---|---|
| [`plugin-api.d.ts`](plugin-api.d.ts) | 插件 API v1 的型別：manifest、必要函式、Host API（複製自 mekuri 的契約，檔頭註明來源 commit） |
| [`sandbox-globals.d.ts`](sandbox-globals.d.ts) | 沙盒提供的標準物件型別（`URL`、`TextEncoder`、`setTimeout`…） |
| [`template/`](template/) | TypeScript 插件範本專案 |
| [`bin/mekuri-plugin.mjs`](bin/mekuri-plugin.mjs) | 命令列工具：`init`、`build`、`test`、`pack`、`validate` |
| [`lib/`](lib/) | 沙盒（quickjs-emscripten）、manifest 驗證、打包、測試工具；集散地 CI 也使用同一份程式碼 |
| [`examples/example-source/`](examples/example-source/) | 範例插件 `io.github.mekuri.example`（純 JavaScript）與它的測試案例 |

## 1. 準備

- Node.js 22 以上（建議 24）與 git。
- 不需要 Visual Studio 或任何原生編譯工具。

取得 SDK（建議先在 GitHub 上 fork 本 repo，之後發佈時會用到）：

```bash
git clone https://github.com/<你的帳號>/mekuri-hub.git
cd mekuri-hub
npm ci
```

## 2. 建立專案

在 mekuri-hub 根目錄執行（專案可以放在任何地方，建議放在 repo 外面）：

```bash
npx mekuri-plugin init ../my-plugin --id io.github.<你的帳號>.<名稱> --name "我的插件" --author <你的名字>
cd ../my-plugin
npm install
```

- `id` 是全小寫的反向網域，例如 `io.github.alice.mysource`。上架後不能改。
- `init` 會把專案的 `@mekuri/plugin-sdk` 依賴指向你 clone 下來的 `sdk/` 資料夾，所以之後不要移動 mekuri-hub 的位置（移動後修改 `package.json` 中的路徑，再重新執行 `npm install` 即可）。

專案結構：

```
my-plugin/
├─ manifest.json      插件資訊（見第 3 節）
├─ icon.svg           圖示（選用，256×256 的 PNG 或 SVG）
├─ src/index.ts       進入點：匯出四個必要函式
├─ src/http.ts        範本的輔助函式（可以自由增減檔案，build 會打包成一個檔）
├─ test/cases.json    測試案例與假 HTTP 回應（見第 5 節）
├─ tsconfig.json
└─ package.json
```

先確認範本本身可以通過測試：

```bash
npm run typecheck   # TypeScript 型別檢查
npm test            # 建置並在 QuickJS 沙盒中跑 test/cases.json
```

看到 `8 通過，0 失敗` 就表示環境沒問題。

## 3. manifest.json

| 欄位 | 必填 | 說明 |
|---|---|---|
| `id` | ✓ | 全小寫反向網域，例如 `io.github.alice.mysource` |
| `name` | ✓ | 顯示名稱 |
| `version` | ✓ | [semver](https://semver.org/lang/zh-TW/)，例如 `1.0.0`。每次發佈都必須比上一版大 |
| `apiVersion` | ✓ | 目前固定為 `1` |
| `author` | ✓ | 作者 |
| `description` | ✓ | 說明 |
| `domains` | ✓ | 允許連線的網域：`example.com`（只有這個主機）或 `*.example.com`（所有子網域，不含 `example.com` 本身）。**圖片 CDN 也要列出。** 不允許 `*`、IP、`localhost`、協定或路徑 |
| `homepage` | | 插件或作者的網頁 |
| `icon` | | 套件內的圖示路徑（`.png` 或 `.svg`） |
| `main` | | 主程式在套件內的路徑，預設 `index.js` |
| `tags` | | 分類，例如 `["manga", "zh-TW"]`，集散地用來篩選 |
| `readingDirection` | | 建議閱讀方向：`rtl` 或 `ltr` |
| `login` | | 需要登入時提供：`{ "url": "https://.../login", "cookieNames": ["session"] }`。`url` 的網域必須在 `domains` 內；`cookieNames` 任一存在即視為已登入 |
| `settings` | | 使用者可調整的設定：`select`、`toggle`、`text`，各有 `key`、`label`、`default` |

使用者安裝插件時，App 會列出 `domains` 請使用者確認；插件只能連到這些網域，也只拿得到這些網域的 Cookie。

## 4. 撰寫插件

插件是一個 **ES module**，用具名匯出提供四個必要函式（型別見 [`plugin-api.d.ts`](plugin-api.d.ts)）：

| 函式 | 回傳 | 用途 |
|---|---|---|
| `search(query, page)` | `{ items: [{ workKey, title, coverUrl?, subtitle? }], hasMore }` | 搜尋；`page` 從 1 開始 |
| `getWork(workKey)` | `{ workKey, title, author?, description?, coverUrl?, url?, readingDirection? }` | 作品資訊 |
| `getChapters(workKey)` | `[{ chapterKey, title, number? }]` | 章節清單，**由舊到新** |
| `getPages(chapterKey)` | `[{ url, headers? }]` | 章節的圖片網址；`headers` 可以指定 `Referer` 等，**不能指定 Cookie** |
| `checkLogin()` | `boolean` | 選用；未提供時以 `manifest.login.cookieNames` 判斷 |

`workKey`、`chapterKey` 是你自己決定的字串，App 會原樣傳回給你。

### Host API：全域物件 `mekuri`

```ts
const res = await mekuri.http.request({ url, method, headers, body, responseType: 'json' });
// res = { status, headers, url, body }；body 在 responseType 為 'json' 時是解析後的物件
const doc = mekuri.html.parse(res.body as string, res.url);   // 第二個參數用來解析相對網址
doc.select('.result').map((el) => el.attr('data-id'));
doc.selectFirst('img')?.absUrl('src');   // 轉成絕對網址
el.text(); el.html();
await mekuri.storage.set('key', value);  // 每個插件獨立，上限 1 MB
mekuri.settings.get('lang');              // manifest.settings 的值
mekuri.log('除錯訊息');                    // 也可以用 console.log
mekuri.env;                               // { appVersion, platform: 'windows' | 'android', apiVersion: 1 }
```

### 沙盒限制

- 插件在 QuickJS 沙盒中執行：**沒有** `fetch`、DOM、`require`／`import` 外部模組、檔案系統、Node.js API。
- 有 `URL`、`URLSearchParams`、`TextEncoder`／`TextDecoder`、`atob`／`btoa`、`console`、`setTimeout`（最長 10 秒）。型別在 [`sandbox-globals.d.ts`](sandbox-globals.d.ts)，範本已在檔案開頭引用。
- `mekuri.http.request` 只允許 `https`，且只能連到 `domains` 內的網域，重新導向到其他網域也會被拒絕（`PLUGIN_DOMAIN_DENIED`）。單次逾時 30 秒，回應上限 10 MB。
- 單次呼叫的執行時間上限 20 秒（`PLUGIN_TIMEOUT`），記憶體上限 64 MB。
- 可以使用 npm 套件，只要它不依賴 Node.js 或瀏覽器 API；`npm run build` 會用 esbuild 把所有程式碼打包成**單一 ES module**。

## 5. 用假資料測試

`test/cases.json` 的格式與 mekuri App 的一致性測試相同：

```json
{
  "responses": {
    "https://example.test/api/works/42": {
      "status": 200,
      "contentType": "application/json",
      "body": "{\"title\":\"海之歌\",\"chapters\":[]}"
    }
  },
  "cases": [
    { "call": "getWork", "args": ["42"], "expect": { "workKey": "42", "title": "海之歌", "url": "https://example.test/works/42" } },
    { "name": "未授權網域被拒", "eval": "await mekuri.http.request({ url: 'https://evil.test/' })", "expectError": "PLUGIN_DOMAIN_DENIED" }
  ]
}
```

- **`responses`**：鍵是完整網址（含查詢字串，需與插件送出的網址完全相同），也可以寫成 `"POST https://..."` 指定方法。值有 `status`（預設 200）、`contentType`、`headers`（選用，例如 `{ "Location": "..." }` 測試重新導向）、`body`（字串）、`delayMs`（選用）。**沒有列出的網址一律回 404。**
- **`cases`**：每個案例用新的沙盒執行。
  - `call` + `args`：呼叫插件匯出的函式；`expect` 是預期的回傳值（完全相等，`undefined` 的欄位會被忽略）。
  - `eval`：以 async 函式本體執行任意程式碼，可以用 `await` 與 `mekuri`。
  - `expectError`：預期丟出的錯誤碼，例如 `PLUGIN_DOMAIN_DENIED`、`PLUGIN_TIMEOUT`、`PLUGIN_ERROR`。
  - `timeoutOverrideMs`：覆寫這個案例的執行時間上限。
  - `name`：選用的案例名稱。
- 頂層也可以加 `settings`（覆寫設定值）與 `storage`（初始 storage 內容）。

開始改寫成你的網站時：

1. 修改 `manifest.json` 的 `domains`（與 `login`），以及 `src/http.ts` 的 `BASE`。
2. 從網站存下幾個頁面或 API 回應（**不要存漫畫圖片**，只需要 HTML／JSON），放進 `responses`。
3. 寫下你預期的回傳值放進 `cases`。
4. 反覆執行 `npm test` 直到全部通過。加上 `-- --verbose` 可以看到插件的 `mekuri.log` 輸出。

測試工具不會真的連線；要確認插件在真實網站上能用，請在 mekuri App 中安裝插件包試用。

## 6. 打包與檢查

```bash
npm run pack:plugin   # 建置並產生 dist/<version>.mekuri-plugin
npm run validate      # 執行與集散地 CI 相同的插件包檢查
```

`.mekuri-plugin` 是 ZIP 檔，內含 `manifest.json`、主程式與圖示，總大小不得超過 50 MB。打包時使用固定的時間戳，同樣的內容會產生同樣的 sha256。

產生的插件包可以直接在 mekuri App 中從檔案安裝（不公開，只存在你的裝置上）。

## 7. 發佈到集散地

### 方法一：從 mekuri App 發佈（建議）

在 App 中以 GitHub 帳號登入後選擇公開插件，App 會自動 fork mekuri-hub、建立分支 `plugin/<id>-<version>`、上傳 `manifest.json` 與插件包，並用 PR 範本開 PR（ADR-008）。你需要在 App 中勾選來源合法聲明。

### 方法二：手動開 PR

```bash
# 在 mekuri-hub（你的 fork）中建立分支
git switch -c plugin/io.github.alice.mysource-0.1.0
# 打包並放到 plugins/<id>/<version>.mekuri-plugin 與 plugins/<id>/manifest.json
cd ../my-plugin
npx mekuri-plugin pack --hub ../mekuri-hub
cd ../mekuri-hub
git add plugins/io.github.alice.mysource
git commit -m "plugin: io.github.alice.mysource 0.1.0"
git push -u origin HEAD
```

然後到 GitHub 對 `mekuri-comics/mekuri-hub` 的 `main` 開 PR：

- 標題：`[插件] 我的插件 0.1.0`。
- 依 PR 範本填寫插件資訊與**每個網域的用途**，並勾選「我聲明此插件的來源合法…」。
- **不要**修改 `index.json` 或其他檔案；`index.json` 會在合併後自動更新。

CI 通過後由 owner 人工審核；合併後幾分鐘內 `index.json` 就會更新，App 會在下次讀取集散地時看到你的插件（App 會快取 1 小時）。

### 更新版本

提高 `manifest.json` 的 `version`，重新 `pack --hub`，開新的 PR。舊版本的插件包可以保留，但**不能修改**；集散地只提供 `manifest.json` 中目前版本的插件包。

### 取消公開

開一個刪除整個 `plugins/<id>/` 目錄的 PR（App 的「取消公開」會自動這樣做）。

## 集散地 CI 檢查什麼

每個 PR 都會執行「插件驗證」workflow（檢查工具取自目標分支，PR 無法修改自己的檢查規則）：

| 檢查 | 失敗的原因 |
|---|---|
| 修改範圍 | 一個 PR 只能修改**一個** `plugins/<id>/` 目錄，不能修改其他檔案（維護者的 PR 例外）。沒有修改 `plugins/` 的 PR 視為基礎設施 PR，略過插件檢查 |
| 目錄內容 | `plugins/<id>/` 只能有 `manifest.json`、`<version>.mekuri-plugin`（以及 CI 產生的 `icon.png`／`icon.svg`） |
| manifest | 規則與 mekuri App 的 `manifest-cases.json` 一致；錯誤訊息會指出第一個不合法的欄位 |
| id | 目錄名稱必須等於 `manifest.id`；`delisted.json` 中已下架的 id 不能重新上架 |
| 版本 | 必須大於目前已上架的版本；已發佈的插件包不可修改 |
| 插件包 | 必須是 ZIP、≤ 50 MB（壓縮前後都算）、根目錄有 `manifest.json` 與主程式、宣告的圖示存在、沒有不安全的路徑；內含的 `manifest.json` 必須與 `plugins/<id>/manifest.json` 相同 |
| 載入 | 在 QuickJS 沙盒中以 ES module 載入（沒有網路），必須匯出 `search`、`getWork`、`getChapters`、`getPages` 四個函式；`checkLogin` 若有匯出必須是函式 |
| 聲明 | PR 內文必須勾選「我聲明此插件的來源合法…」 |

錯誤會顯示在 PR 的檢查結果與 Actions 的 Summary 頁。本機可以先用 `npm run validate` 檢查插件包。

## 指令參考

```
mekuri-plugin init <資料夾> [--id <id>] [--name <名稱>] [--author <作者>]
mekuri-plugin build [資料夾]
mekuri-plugin test [資料夾|插件包] [--cases <cases.json>] [--platform windows|android] [--verbose]
mekuri-plugin pack [資料夾] [--hub <mekuri-hub 路徑>]
mekuri-plugin validate [資料夾|插件包]
```

範例插件（純 JavaScript，不需要建置）也可以直接測試：

```bash
npx mekuri-plugin test sdk/examples/example-source
```

## 與 App 的差異

本機測試工具盡量模擬 App 的沙盒，但有以下差異：

- 不會真的連線，只回傳 `responses` 中的假回應；不會附加 Cookie 與 App 的 User-Agent。
- `mekuri.env.appVersion` 固定為 `0.0.0-sdk`，`platform` 預設 `windows`（可用 `--platform android` 切換）。
- HTML 解析器是 [node-html-parser](https://github.com/taoqf/node-html-parser)；App 的解析器可能在不合法的 HTML 上有細微差異，請盡量使用單純的 CSS 選擇器。
