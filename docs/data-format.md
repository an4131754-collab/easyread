# 資料格式

## paper.json

```json
{
  "schema": 2,
  "meta": {
    "title_zh": "給評測加上誤差條：語言模型評測的統計學方法",
    "short_zh": "給評測加上誤差條",
    "title_en": "Adding Error Bars to Evals: ...",
    "authors": "Evan Miller", "affiliation": "Anthropic",
    "date": "2024 年 11 月 4 日", "arxiv": "arXiv:2411.00640v1 [stat.AP]",
    "pdf": "source.pdf", "source_sha256": "…", "pages": [{"n": 1, "w": 612, "h": 792, "img": "pages/page-001.webp"}]
  },
  "translation": { "scope": "全文", "done_pages": [1, 2, 3], "note": "參考文獻保留原文" },
  "glossary": [{ "en": "standard error", "zh": "標準誤", "note": "可選" }],
  "references": [{ "id": "1", "text": "原文條目" }],
  "blocks": [ … ]
}
```

`translation.en_pages`：用“只讀原文”整理過、還沒翻譯的頁（這些頁的塊只有 `en`，沒有 `zh`；頁面直接排英文）。翻譯它們時就地補 `zh`，塊 id 不變，補齊的頁從 `en_pages` 去掉。`done_pages` 包含這些頁。

`meta.pages`、`page_count`、`source_sha256`、`pdf` 由匯入時寫，不要手改。文獻庫頁裡改的標題、作者等存在 `item.json` 的 `meta_override`，不改 paper.json。

### 塊

每塊必須有唯一 `id`（後續討論、筆記都錨在它上面，定下後不要改）、`type`、`page`（這塊在原 PDF 從哪頁開始）。

| type | 欄位 | 說明 |
|---|---|---|
| `heading` | `level`(1/2)、`num`、`zh`、`en`、`appendix` | 章節標題。`num` 如 "2.1"、"A"；附錄的標題加 `"appendix": true` |
| `para` | `zh`、`en`、`role`、`cont` | 段落。`role: "abstract"` 用摘要樣式；`cont: true` 表示接著公式的半句（如 “其中 …”） |
| `list` | `ordered`、`items: [{zh, en}]` | 列表 |
| `math` | `tex`、`tag` | 行間公式。`tag` 是原文編號（"1"），無編號不寫。多行用 `aligned` / `gathered` |
| `table` | `num`、`head: [[…]]`、`rows: [[…]]`、`align`、`caption_zh`、`caption_en`、`caption_pos` | 表格。單元格支援行內標記，`\n` 換行（第二行括號內容自動變灰，適合“均值\n(標準誤)”）。`align` 如 "lrrr" |
| `figure` | `num`、`src`、`caption_zh`、`caption_en` | 圖。`src` 是論文目錄下的圖片（如 `figures/fig1.webp`），留空時頁面顯示“圖見原文第 N 頁” |
| `references` | `zh`、`en` | 放參考文獻列表的位置（內容取 `references`） |
| `note` | `zh` | 正文流裡的“閱讀批註（非原文）”。儘量不用，解釋放 discussion.json |

可選 `box: [x0, y0, x1, y1]`（按頁寬高歸一化）手工指定原頁高亮區域，覆蓋自動定位。

浮動體（表、圖）放在正文第一次提到它的段落之後，`page` 仍寫它實際所在頁。

新增一批塊（`easyread blocks ID --from 批次.json --done 4-6`）時可帶 `"_after": "某塊id"` 指定插入位置，否則追加到末尾；同 id 的塊整塊替換。

### 行內標記（zh、en、單元格、討論正文通用）

- `$...$` 行內公式（KaTeX）；字面美元符寫 `\$`
- `**粗體**`、`*斜體*`、`` `程式碼` ``
- `[7]`、`[2, 5]` 自動鏈到參考文獻
- 中文裡的“公式 (4)”“公式 (9) 和 (10)”“表 2”“圖 3”“第 2.2 節”“附錄 A”，英文裡的 “Equation 4”“Table 2”“Section 2.2”“Appendix A”，自動變成可懸停預覽、點選跳轉的連結（目標要存在）
- 討論正文裡空行分段；單獨一段 `$$...$$` 是行間公式

JSON 裡 TeX 的反斜槓要寫兩個（`\\frac`）。`\f` `\b` `\t` `\n` `\r` 開頭的命令（`\frac`、`\bar`、`\text`、`\nu`、`\right`）寫錯會被 JSON 悄悄吃掉，`paper.py check` 會報“含控制字元”。

## discussion.json

```json
{ "schema": 2, "entries": [
  { "id": "d001-ab12c", "anchor": "s2-1-p4", "quote": "對它（即“真實”的平均評測分數）進行推斷",
    "kind": "check", "title": "原句漏了一個符號", "body": "…", "at": "…" }
]}
```

| 欄位 | 說明 |
|---|---|
| `anchor` | 塊 id；不寫表示整篇（顯示在題頭旁） |
| `quote` | 可選，錨點塊**譯文**裡的一段原話（純文字，不能含 `$` 公式），頁面會給它加下劃線 |
| `kind` | `explain` 解釋 / `qa` 問答 / `insight` 感悟 / `reply` 回覆使用者問題 / `check` 原文核對提示 |
| `title`、`q`、`body` | 標題、問題（問答用）、正文（必填，支援行內標記） |
| `reply_to` | 回覆使用者筆記時填筆記 id（`easyread status` 裡能看到），錨點自動跟隨那條筆記 |

用 `easyread discuss ID --from 檔案.json` 追加（陣列或單個物件）；帶已有 `id` 是修改；`--delete ID` 刪除。`id`、`at` 不寫會自動生成。

## reader.json（只讀）

```json
{ "rev": 12,
  "edits": { "s1-p3": { "zh": "使用者版本", "base": "改時譯者稿的雜湊", "at": "…" },
             "tab1#caption": { … }, "s1-recs#2": { … } },
  "notes": { "n…": { "id": "n…", "anchor": "s1-p2", "key": "s1-p2", "quote": "…", "prefix": "…", "suffix": "…",
                    "kind": "note | question | highlight", "color": "yellow | green | blue | pink",
                    "body": "…", "created": "…", "updated": "…", "deleted": false } },
  "paper_note": { "body": "整篇的論文筆記", "at": "…" },
  "progress": { "block": "s3-1-p2", "ratio": 0.35, "at": "…" } }
```

編輯的鍵：普通塊是塊 id，表/圖題注是 `id#caption`，列表項是 `id#序號`。頁面只通過 `/api/p/ID/ops` 發操作（`edit`、`note`、`note_del`、`paper_note`、`progress`），每個操作冪等、帶時間戳，同一物件以較新的為準；服務端加鎖、原子寫、記日誌。離線版匯出的修改用 `easyread merge ID --from 匯出.json` 並回。

## item.json（只讀）

```json
{ "added": "…", "tags": ["統計"], "status": "unread | reading | done", "starred": false,
  "last_opened": "…", "meta_override": { "title_zh": "…" } }
```

## job.json（背景任務狀態）

`{"type": "translate", "state": "queued | running | done | partial | error | cancelled", "message": "…", "done": 4, "total": 14, "error": "", "failed": {"7": "原因"}, "scope": "all | body | first:N"}`。服務重啟後 queued / running 的任務會自動繼續。`partial` 表示有頁沒譯成功（`failed` 裡是頁碼和原因），頁面上可以一鍵重試。每篇的翻譯過程記在 `job.log`。

## layout.json（自動生成的原頁定位）

```json
{ "s1-p3": {
  "page": 1, "src": "text", "box": [0.08, 0.10, 0.92, 0.90],
  "boxes": [[0.08, 0.60, 0.48, 0.90], [0.52, 0.10, 0.92, 0.30]]
} }
```

每個座標框都是按原頁寬高歸一化的 `[x0, y0, x1, y1]`。跨欄段落的可選 `boxes` 儲存各欄的獨立區域，按從左到右排列；原頁高亮和點選定位逐個使用這些區域，保留欄間空白。`box` 保留整體外接框以相容舊資料；沒有 `boxes` 時只使用 `box`。圖表仍使用包含影像的完整區域。

服務首次開啟已有文獻時會用本地字元座標重算定位，無需重新翻譯；離線匯出會包含同樣的定位資料和高亮邏輯。

## chat.json（“問 AI”的對話記錄，只有服務寫）

```json
{ "threads": [
  { "id": "t…", "title": "我標紅的那些公式有什麼聯絡", "model": "opus", "created": "…", "updated": "…",
    "messages": [
      { "role": "user", "content": "…", "anchor": "s1-recs", "quote": "", "note": null, "at": "…" },
      { "id": "m…", "role": "assistant", "content": "……", "model": "Claude Opus 5", "anchor": "s1-recs", "note": null, "at": "…" } ] } ] }
```

一篇論文可以有多個對話。`note` 不為空時，這次是在回答頁邊那條筆記裡的問題，回答同時寫進 discussion.json（`reply_to` 那條筆記，`live: true`）。“放到頁邊”把一條回答寫成 discussion.json 裡的 `qa` 條目。提問時會把讀者的全部標記（按顏色分組）一起交給模型。

## 資料目錄裡的其他檔案

| 檔案 | 內容 |
|---|---|
| `config.json` | 設定：翻譯引擎、各家 API Key（`openai.keys`，按服務商分開存）、問 AI 的模型名單和預設模型（`chat.models`、`chat.default`） |
| `prefs.json` | 介面偏好：閱讀頁字號、版心、主題、劃線筆（`reader`），功能開關和快捷鍵總開關（`ui`），改過的鍵位（`keys`） |
| `easyread.log` | 服務日誌，設定底部“檢視執行日誌”能看到 |

## 為什麼用 JSON 檔案而不是資料庫

EasyRead 是個人工具：一個人、一臺電腦、幾十到幾百篇論文。每篇一個資料夾、幾個 JSON，好處是能直接看、能直接備份和同步（網盤、git 都行），agent 在對話裡也能直接讀寫；按“誰寫哪個檔案”分開之後，也不需要資料庫的併發控制。文獻庫列表每次掃描各資料夾生成，幾百篇以內是毫秒級。瀏覽器 localStorage 只用來暫存還沒寫進檔案的修改和快取偏好，不是資料的正本。
