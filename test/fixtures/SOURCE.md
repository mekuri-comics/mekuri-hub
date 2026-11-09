# fixtures 來源

| 檔案 | 來源 | commit |
|---|---|---|
| `manifest-cases.json` | mekuri-comics/mekuri `shared/fixtures/plugin/manifest-cases.json` | `d911e34b23c3ea4c81a51ccb2939eed6c8edd159` |

- 內容與來源**逐位元組相同**，不要直接修改。
- mekuri 的 fixture 有變動時，重新複製並更新上表的 commit，再跑 `npm test`；`sdk/lib/manifest.mjs` 的規則必須讓所有案例通過。
- 範例插件的案例（`example-source/cases.json`）放在 [`sdk/examples/example-source/`](../../sdk/examples/example-source/)。
