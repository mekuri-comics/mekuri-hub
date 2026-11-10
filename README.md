# mekuri-hub

**mekuri** 漫畫閱讀器（Android／Windows）的公開下載處與插件集散地。

> 本 repo 不提供任何漫畫內容，也不接受盜版來源或繞過 DRM／付費牆的插件（[上架政策](POLICY.md)）。

## 下載 App

到 [Releases](https://github.com/mekuri-comics/mekuri-hub/releases) 下載最新版本：

| 平台 | 檔案 | 說明 |
|---|---|---|
| Windows 10／11 | `.exe` 安裝檔 | 安裝檔沒有付費的程式碼簽章，第一次安裝時 Windows SmartScreen 會顯示警告：選「其他資訊」→「仍要執行」。 |
| Android 8.0 以上 | `.apk` | mekuri 不在 Google Play 上架。下載後開啟 APK，依提示允許瀏覽器或檔案管理員「安裝不明應用程式」。 |

每個版本都附有 `SHA256SUMS`，可以用來確認下載的檔案沒有損壞或被竄改：

```bash
sha256sum -c SHA256SUMS --ignore-missing   # Windows PowerShell：Get-FileHash <檔名> -Algorithm SHA256
```

標示為 Pre-release 的是測試版。

## 安裝插件

mekuri 本身不內建任何網站；要瀏覽、下載網路上的漫畫，需要安裝插件。

- **從集散地安裝：** 在 App 的插件頁瀏覽集散地，選擇插件後安裝。App 讀取的是本 repo 的 [`index.json`](index.json)，下載插件包後會驗證 sha256。
- **從檔案安裝：** 也可以直接安裝 `.mekuri-plugin` 檔（例如自己寫的、不公開的插件）。

安裝前 App 會列出插件要求連線的**網域**，請確認後再同意。插件在沙盒中執行，只能連到這些網域，也只拿得到這些網域的登入 Cookie。

插件由第三方作者提供，集散地不擔保其內容。發現違反政策的插件，請[檢舉](https://github.com/mekuri-comics/mekuri-hub/issues/new?template=report-plugin.yml)。

## 撰寫與發佈插件

1. 讀 [上架政策](POLICY.md)。
2. 依 [SDK 教學](sdk/README.md) 從範本建立專案、用假資料在本機測試、打包成 `.mekuri-plugin`。
3. 發佈：在 mekuri App 中以 GitHub 帳號一鍵發佈（App 會自動開 PR），或手動對本 repo 開 PR（[步驟](sdk/README.md#7-發佈到集散地)）。
4. CI 會自動檢查格式、權限網域與插件包（[檢查項目](sdk/README.md#集散地-ci-檢查什麼)），再由 owner 人工審核。合併後 `index.json` 會自動更新。

範例插件：[`plugins/io.github.mekuri.example/`](plugins/io.github.mekuri.example/)（對應不存在的示範網站 `example.test`，原始碼在 [`sdk/examples/example-source/`](sdk/examples/example-source/)）。

## repo 結構

```
mekuri-hub/
├─ index.json                         ← CI 產生，App 讀這個（不要手動修改）
├─ plugins/<id>/manifest.json
├─ plugins/<id>/<version>.mekuri-plugin
├─ plugins/<id>/icon.png|svg          ← CI 從插件包取出（manifest 有 icon 時）
├─ delisted.json                      ← 下架紀錄（REPORTING.md）
├─ sdk/                               ← 型別、範本、測試工具（MIT）
├─ scripts/                           ← CI 腳本：PR 驗證、產生 index.json
├─ test/                              ← CI 腳本與 SDK 的測試
├─ POLICY.md · REPORTING.md
└─ .github/                           ← PR 範本、檢舉範本、CI
```

### index.json

```json
{
  "apiVersion": 1,
  "generatedAt": "2026-11-10T00:00:00.000Z",
  "plugins": [
    {
      "id": "io.github.mekuri.example",
      "name": "Example Source",
      "version": "1.0.0",
      "author": "mekuri",
      "description": "…",
      "domains": ["example.test", "*.img.example.test"],
      "tags": ["manga", "example"],
      "icon": null,
      "package": "https://raw.githubusercontent.com/mekuri-comics/mekuri-hub/main/plugins/io.github.mekuri.example/1.0.0.mekuri-plugin",
      "sha256": "…",
      "updatedAt": "…"
    }
  ]
}
```

- `icon`、`package` 是可以直接下載的完整網址；沒有圖示時 `icon` 為 `null`，沒有 tags 時為 `[]`。
- `sha256` 是插件包檔案的 SHA-256（小寫 16 進位）。`updatedAt` 是目前版本的插件包最後一次提交的時間（UTC）。
- 依 `id` 排序。

## CI

| workflow | 觸發 | 內容 |
|---|---|---|
| [插件驗證](.github/workflows/validate.yml) | 每個 PR | 「插件檢查」：manifest、目錄、版本遞增、插件包大小與內容、在 QuickJS 中載入並確認四個必要函式、只能修改自己的插件目錄、來源合法聲明。「SDK 與腳本測試」：`npm test`、範本型別檢查 |
| [更新 index.json](.github/workflows/index.yml) | 推送到 `main` 且 `plugins/` 有變動，或手動執行 | 重新產生 `index.json` 與圖示並提交（commit 訊息帶 `[skip ci]`，內容沒變時不提交） |

本機執行：

```bash
npm ci
npm test                 # 所有測試
npm run build:index      # 重新產生 index.json
node scripts/validate-pr.mjs --base origin/main   # 以目前的 commit 模擬 PR 驗證
```

## 授權

- [`sdk/`](sdk/) 以 [MIT](sdk/LICENSE) 授權。
- `plugins/` 中的插件由各自的作者提供，授權依各插件而定。
- mekuri App 本身不開源，只在本 repo 的 Releases 發佈安裝檔。
