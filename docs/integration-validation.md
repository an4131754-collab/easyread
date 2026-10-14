# develop 整合驗證紀錄

日期：2026-10-14。上游來源固定為 v1.4.2、`44190260c719377c1503a8587082cfb1313b34e7`。本次只交付 develop，未變更 main、正式版號或發布 Release。

## 驗收項目

| 項目 | 檢查方式與結果 |
|---|---|
| 保留拖曳分隔線 | 真實 Chrome：PDF／筆記／問 AI 共用比例、最小寬度、雙擊重設、小於 1180px 覆蓋；無整頁橫向溢出。splitter.js 和分隔線 CSS 保持既有提交內容。 |
| 雙語螢光筆 | 真實 Chrome：正文／清單／圖說、主次交換、模式切換、重新整理；取消中英標記、筆記保留。 |
| 問 AI | 真實 Chrome：照片上傳、純照片沒有自動泡泡；多則 AI 回答引用、去重、移除、送出與重開對話。模型回覆為測試替身。 |
| 搜尋与公式複製 | 真實 Chrome：隱藏英文命中暫切對照、關閉還原，調字號不覆蓋原模式；複製公式保留 TeX。 |
| 圖表筆記 | 真實 Chrome：卡片點擊定位、明確編輯、切換立即保存；挑選／拖放／收合／改名／重載、純圖表筆記、取消標記不復活。 |
| 資料容錯及備份 | Python＋真實 HTTP：損壞論文不擋其他文獻、原檔不改寫；完整備份／恢復 notes/chat/images；手動 PDF 更新失敗可回滾。 |
| PDF | 合成真實 PDF：跨頁定位、裁圖與題注分離；雙欄圖表順序只對 v2 啟用；既有 25 項裁圖測試仍通過，重匯舊 PDF 不偷偷啟用新策略。 |
| 接口與任務 | Python／前端：接口 A/B 金鑰分離、旧空槽遷移、公開設定無明文金鑰；同時兩篇確實重疊、1–4 worker 配置、取消所有權、刪除／損壞任務不阻塞下一篇。 |
| 桌面更新 | Node／真實 Chrome替身：fork feed、Win/mac/AppImage資格、下載後不自動安裝、關閉重開面板、忙碌阻止／重試、下載不重複；GitHub失敗狀態與三小時重試。 |

執行方式（Windows，專案目錄）：

```powershell
.venv\Scripts\python.exe -m unittest discover tests
node --test tests/test_*.cjs
$env:PLAYWRIGHT = '你的 playwright 模組路徑'
node tests/e2e_features.cjs
node tests/e2e_annotation_followup.cjs
node tests/e2e_integration.cjs
npm run dist
.venv\Scripts\python.exe scripts/smoke_backend.py
```

瀏覽器測試使用獨立 `EASYREAD_HOME`／文獻庫。沒有對真實翻譯模型送出請求，沒有重算使用者舊論文。`build/` 保存本機測試日誌與截圖，屬忽略產物。

## 更新與平台界線

- 本機 Windows 包：維持目前 `1.2.9` 版號，僅供本次打包驗證，不可當成新正式版發布。建置使用 `--publish never`。
- develop 的 workflow_dispatch 可建置三平台驗證資產，不建立 tag、不執行 Release job。`validate_unsigned_mac=true` 僅允許 macOS 臨時簽章的測試資產。
- 已查詢 fork 的 Secret **名稱**，目前沒有 `MAC_SIGN_P12`／`MAC_SIGN_P12_PASSWORD`；未讀取任何秘密值。macOS固定簽章與真實跨版本更新尚未驗證。正式 tag 建置缺憑證會失敗，不把臨時簽章包當成正式可更新包。
- 要啟用 macOS 真實更新，維護者須準備固定名稱為 `EasyRead Self-Signed` 的程式簽章憑證與私鑰，以 base64 P12 放入 `MAC_SIGN_P12`，密碼放 `MAC_SIGN_P12_PASSWORD`。憑證應持續沿用。使用者首次手動安裝該固定簽章版本；後續更新需相同身分及 mac ZIP＋latest-mac.yml。macOS實機與跨版本替換仍需驗證。
- Linux 需從 AppImage 執行，其他開發／解包方式仍手動下載。CI建置不等於使用者 Linux/macOS 實機安裝驗收。
- OneDrive短暫占用已加入有限重試及唯讀處理；未在真實 OneDrive 同步事故中驗證。
- 本次不提供舊論文批次自動重算。完整備份放在文獻庫 `.backups/<論文ID>/`，不自動刪除；恢復前也保留現況，磁碟需有足夠空間。

## 本機與 CI 建置結果

Windows本機建置與frozen backend smoke均成功；260項Python、26項Node，以及三份Chrome回歸已通過。三平台CI結果於完成後補入，macOS固定簽章與跨版本更新不由CI建置成功推定完成。

Windows驗證安裝包：`dist\electron\EasyRead-Setup-1.2.9.exe`，146249349 bytes，SHA-256 `dc4f53d74cfe2b040a4916ae03e09d52b5e40131a65f325f8a639750faf12e9f`。
