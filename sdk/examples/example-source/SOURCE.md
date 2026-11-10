# 範例插件 example-source

`manifest.json`、`index.js`、`cases.json` 複製自 mekuri-comics/mekuri `shared/fixtures/plugin/example-source/`，commit `d911e34b23c3ea4c81a51ccb2939eed6c8edd159`，內容逐位元組相同。

- 對應的網站 `example.test` 並不存在（`.test` 是保留給測試用的頂級網域），只作示範。
- 集散地上的 [`plugins/io.github.mekuri.example/`](../../../plugins/io.github.mekuri.example/) 由這裡的檔案以 `npm run build:example` 打包而成。
- 測試：在 repo 根目錄執行 `npx mekuri-plugin test sdk/examples/example-source`。
- 來源有變動時：重新複製三個檔案、更新上面的 commit、執行 `npm run build:example`；若內容改變，記得同時提高 `manifest.json` 的 `version`（集散地要求版本遞增）。
