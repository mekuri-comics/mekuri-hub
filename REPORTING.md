# 檢舉與下架流程

違反 [上架政策](POLICY.md) 的插件可以由任何人檢舉；權利人也可以用同樣的方式提出下架請求。

## 1. 如何檢舉

1. 開一個「[檢舉插件](https://github.com/mekuri-comics/mekuri-hub/issues/new?template=report-plugin.yml)」issue，填寫插件 id、原因與可以查證的證據。
2. issue 是公開的：**不要附上漫畫圖片、帳號密碼、Cookie 或他人的個人資料。** 需要私下提供資料時，在 issue 中註明，維護者會與你聯絡。
3. 一個 issue 只檢舉一個插件。

## 2. 標籤

| 標籤 | 意義 | 由誰加 |
|---|---|---|
| `report` | 新的檢舉，尚未處理 | 範本自動加上 |
| `report:investigating` | 已確認收到，調查中 | 維護者 |
| `report:delisted` | 檢舉成立，插件已下架 | 維護者 |
| `report:rejected` | 檢舉不成立 | 維護者 |

## 3. 處理時限

| 階段 | 時限 | 說明 |
|---|---|---|
| 確認收到 | 3 天內 | 維護者留言確認並加上 `report:investigating`；必要時在 issue 中通知插件作者 |
| 緊急下架 | 24 小時內 | 明顯的惡意行為（蒐集或外傳使用者資料、與說明不符的連線）、明顯的盜版來源，或 repo 中出現 token、個資、漫畫圖片時，維護者可以先下架再補調查 |
| 作者回應 | 7 天 | 插件作者可以在 issue 中說明或提出證據；期限內沒有回應，依現有資料決定 |
| 做出決定 | 收到檢舉後 14 天內 | 下架或駁回，並在 issue 中說明 |

時限是目標而不是保證；owner 依 POLICY.md 第 5 節，仍可隨時不經通知下架任何插件。

## 4. 下架步驟（維護者）

1. 開一個 PR，標題 `[下架] <插件 id>`，內容：
   - 刪除整個 `plugins/<id>/` 目錄；
   - 在 [`delisted.json`](delisted.json) 的 `plugins` 新增一筆：`{ "id": "<id>", "reason": "<原因>", "issue": "<檢舉 issue 連結>", "date": "YYYY-MM-DD" }`。
2. 合併後，CI 會自動重新產生 `index.json`，App 下次讀取集散地時就不會再出現這個插件。
3. 在檢舉 issue 留言附上下架 PR 的連結，改標籤為 `report:delisted`，關閉 issue。
4. 若 repo 中出現 token、個資或受著作權保護的圖片，刪除檔案之外，另外評估是否需要清除 git 歷史，並通知相關的人更換 token。

駁回時：在 issue 中說明理由，改標籤為 `report:rejected`，關閉 issue。

## 5. 紀錄

- **`delisted.json` 是下架的正式紀錄**：每筆含 id、原因、檢舉 issue 與日期。列在其中的 id 不接受重新上架（CI 會拒絕）。
- 檢舉 issue 不刪除，保留處理過程。
- 下架只影響集散地：插件從 `index.json` 移除後就無法再從集散地安裝。

## 6. 申訴

插件作者對下架有異議時，可以在原檢舉 issue 留言並提出證據（例如來源網站的授權說明）。owner 重新評估後的決定為最終決定。問題解決後，維護者可以從 `delisted.json` 移除該 id，作者再重新送 PR 上架。
