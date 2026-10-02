<p align="center">
  <img src="docs/images/logo.svg" width="72" alt="EasyRead">
</p>
<h1 align="center">EasyRead</h1>
<p align="center"><b>把英文論文，讀成舒服的繁體中文。</b><br>
匯入 PDF，背景逐頁翻譯；公式、表格照原文排好，隨時對照原文，邊讀邊劃線、記筆記、提問。<br>
本地執行，論文和筆記只存在你自己的電腦上。</p>

<p align="center"><b>繁體中文</b> · <a href="README.en.md">English</a></p>

<p align="center"><a href="https://edwardxlai.github.io/easyread/demo/"><b>▶ 線上試讀一篇</b></a> · <a href="https://edwardxlai.github.io/easyread/">專案主頁</a> · <a href="https://github.com/Edwardxlai/easyread/releases/latest">下載</a></p>

<p align="center">
  <a href="https://github.com/Edwardxlai/easyread/releases/latest"><img src="https://img.shields.io/github/v/release/Edwardxlai/easyread?label=%E7%89%88%E6%9C%AC" alt="版本"></a>
  <a href="https://github.com/Edwardxlai/easyread/actions/workflows/test.yml"><img src="https://github.com/Edwardxlai/easyread/actions/workflows/test.yml/badge.svg" alt="測試"></a>
  <img src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-本地執行-2f6070" alt="平臺">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="MIT">
</p>

<p align="center"><img src="docs/images/pages.jpg" width="860" alt="譯文和原頁對照"></p>

## 它和“把 PDF 丟給翻譯軟體”有什麼不一樣

- **像讀一本排好版的中文書。** 宋體正文、舒服的行寬和行距，公式用 KaTeX 按原文重排，表格是三線表，參考文獻保留原文。頂欄一鍵切深色。
- **隨時核對原文。** 一鍵切“對照”，每段下面附英文；右側可以開原頁，跟著閱讀位置翻頁，還會框出當前段落在原頁的位置。
- **翻譯和解釋分開。** 正文只放忠實的譯文；AI 的解釋、回答放在頁邊，一眼就能分清哪句是論文說的。
- **邊讀邊問 AI。** 右側“問 AI”面板即時對話，回答逐字流出來；可以一次引用好幾段（選中文字拖進輸入框就行）。問“我標紅的那些公式有什麼聯絡”，它會按顏色找出你的劃線。可以開多個對話，模型單獨選：Claude、GPT（Codex）、DeepSeek、通義、本機 Ollama……好的回答一鍵放到頁邊。
- **邊讀邊批註。** 選中文字四色熒光筆或下劃線、寫筆記、提問；問題一鍵讓 AI 回答，筆記可以讓 AI 點評。所有筆記按原文順序彙總，可以勾選匯出成 Markdown（放進 Obsidian、Notion）。
- **譯文可以改。** 雙擊一段直接改；術語表裡改一個譯法，全文替換。
- **不只是 arXiv。** 拖進任何 PDF；或者填 arXiv 編號、DOI、論文標題、論文網頁（OpenReview、ACL、NeurIPS、bioRxiv、PMC、期刊頁面），自動找到公開的 PDF 並補全作者、年份、出處。
- **文獻庫。** 側欄像聊天軟體：論文和分類都能置頂；自己建分類（右鍵改名、刪除，把論文拖進去），內建分類可以隱藏；最近閱讀、搜尋、未讀 / 在讀 / 已讀、星標、閱讀進度、複製引用（GB/T 7714、APA、BibTeX）、匯出單檔案離線 HTML 發給別人。刪掉的論文先進回收站，可以恢復。快捷鍵可以自定義。
- **用了多少心裡有數。** 每次翻譯、每條 AI 回答都記下用了多少 token；用 Claude 訂閱時，還能看到 5 小時 / 7 天額度用到多少、什麼時候重置。
- **不會丟東西。** 每次修改先存在瀏覽器，本地服務確認寫進檔案才刪；翻譯方後來改了你改過的段落，只提示，不覆蓋。

<p align="center"><img src="docs/images/chat.jpg" width="860" alt="邊讀邊問 AI"></p>

<p align="center"><img src="docs/images/library.jpg" width="860" alt="文獻庫"></p>

## 翻譯用什麼模型：你來選

| 引擎 | 要什麼 | 說明 |
|---|---|---|
| **Claude Code**（推薦） | 裝好並登入 [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) | 不用 Key，用你訂閱的額度；會自己看原頁圖核對公式，譯文最好 |
| **Codex CLI** | 裝好並登入 [Codex](https://github.com/openai/codex) | 不用 Key，用 ChatGPT 賬號 |
| **API 介面 · 國內直連**：DeepSeek / 智譜 / 阿里雲百鍊 / Kimi / 矽基流動 / 魔搭 | API Key | 智譜 GLM-4.7-Flash、矽基流動小模型免費；DeepSeek 一篇 20 頁論文幾毛錢 |
| **API 介面 · 海外（要梯子）**：OpenAI / Anthropic / Gemini / OpenRouter / Groq / Cerebras | API Key | Gemini、OpenRouter、Groq、Cerebras 有免費額度 |
| **API 介面 · 本機**：Ollama / LM Studio | 本機裝 [Ollama](https://ollama.com) 或 [LM Studio](https://lmstudio.ai) | 完全離線、免費，推薦 qwen3.5:9b（顯示卡小用 4b） |
| **API 介面 · 自定義地址**：任意 OpenAI 相容介面、中轉站 | 地址 + Key | Chat Completions 和 Responses 兩種格式都支援；點“獲取模型列表”從介面拉模型名 |

不想讓它匯入後馬上翻譯，在設定裡關掉“匯入後自動開始翻譯”就行，之後可以讓對話裡的 agent 來譯。

設定裡會自動檢測本機裝了什麼，點“試譯一句”馬上知道能不能用。某一頁翻譯失敗（限流、網路、額度）會自動重試，還不行就先跳過、接著譯後面的頁，最後一鍵“重試失敗的頁”。

<p align="center"><img src="docs/images/settings.jpg" width="640" alt="設定"></p>

## 安裝

**最省事：下載安裝包**（不用裝 Python）。在 [Releases](https://github.com/Edwardxlai/easyread/releases/latest) 下載：

- **Windows**：`EasyRead-Setup-x.x.x.exe`，雙擊安裝。沒有程式碼簽名，如果彈出“Windows 已保護你的電腦”，點“更多資訊 → 仍要執行”。
- **macOS**（Apple 晶片）：`EasyRead-x.x.x-arm64.dmg`，把 EasyRead 拖進“應用程式”。第一次開啟會提示“無法驗證開發者”：去“系統設定 → 隱私與安全性”，在下面點“仍要開啟”，之後就正常了。
- **Linux**：`EasyRead-x.x.x.AppImage`，`chmod +x` 後執行。

安裝版的論文和設定存在使用者目錄下的 `EasyRead` 資料夾（和 pip 安裝版同一個位置），解除安裝重灌不會丟。

**或者從原始碼執行**：需要 [Python 3.10+](https://www.python.org/downloads/)。

先從 [Releases](https://github.com/Edwardxlai/easyread/releases/latest) 下載最新版的 zip 解壓（或者 `git clone` 本倉庫）。

**Windows**：雙擊 `start.cmd`。第一次會自動裝好環境（一分鐘左右），之後雙擊直接開啟。

**macOS / Linux**：在解壓出來的目錄裡執行

```bash
./start.sh
```

這樣啟動的，瀏覽器裡的 EasyRead 頁面全部關掉後，背景服務過十幾秒會自己退出；還有翻譯在跑的話，等譯完再退。

每次推送都會在 Windows、macOS、Linux 上自動裝一遍、跑測試、啟動一次（見上面的“測試”徽章）。

**或者用 pip**（資料放在 `~/EasyRead`）：

```bash
pip install git+https://github.com/Edwardxlai/easyread
easyread
```

瀏覽器會開啟 `http://127.0.0.1:8765`。服務只監聽本機。

## 桌面版（Electron）

桌面版複用同一套本地 Python 服務和 Web 介面，由 Electron 負責啟動服務並顯示視窗。開發環境需要 Node.js 22+、Python 3.10+ 和 PyInstaller：

```bash
npm install
python -m pip install pyinstaller
npm run dev
```

生成可分發安裝包：

```bash
npm run dist
```

輸出在 `dist/electron/`：Windows 為 NSIS 安裝程式，macOS 為 DMG，Linux 為 AppImage。推送 `v*` 標籤後，GitHub Actions 會在三個系統上構建，並把這些安裝包自動附加到 GitHub Release；原始碼 zip 仍會由 GitHub 保留。打包後的文獻庫和設定儲存在系統的 EasyRead 使用者資料目錄中，不會寫進安裝目錄。

## 怎麼用

1. 右上角“設定” → “模型”：新增要用的模型，點卡片選“設為翻譯”。翻譯和“問 AI”用的模型都在這一頁管理。
2. 把 PDF 拖進視窗；或者貼上 arXiv 編號、arXiv / OpenReview 連結、PDF 直鏈（在文獻庫頁面直接 `Ctrl+V` 也行）。長論文可以選“只譯正文”，或者“指定頁”只譯第幾頁到第幾頁。匯入時還能選這次用哪個模型；“匯入後”選“讀英文原文”就只排版、不翻譯，想看中文了隨時點“翻譯成繁體中文”。
3. 翻譯在背景一頁頁進行，已譯的部分馬上能讀，沒譯到的頁先顯示原頁。
4. 讀的時候點一下段落出現操作條；選中文字可以劃線、寫筆記、提問。按 `?` 看全部快捷鍵。

## 和 AI agent 一起讀

EasyRead 自帶命令列，Claude Code / Codex 這類 agent 可以在對話裡直接讀你的筆記和問題、把回答寫到對應段落旁邊，也可以親自翻譯或重譯某幾頁。技能說明在 [`skill/paper-reading/SKILL.md`](skill/paper-reading/SKILL.md)，把這個目錄放進 `~/.claude/skills/` 或 `~/.codex/skills/` 即可。

```bash
easyread list                          # 列出文獻庫
easyread import 論文.pdf                # 或 arXiv 編號 / 連結
easyread status ID                     # 進度、我改過的譯文、筆記、待回答的問題
easyread discuss ID --from 回答.json    # 把討論寫到頁邊
easyread export ID                     # 匯出單檔案離線 HTML
```

完整命令見 `easyread --help`，資料格式見 [docs/data-format.md](docs/data-format.md)。

## 常見問題

**翻譯到一半失敗了？** 文獻庫裡點這篇，右側“翻譯”一欄會寫原因和失敗的頁，點“重試”。“翻譯記錄”裡有每一批的詳細情況；設定底部“執行日誌”能看到服務本身的日誌。

**用 Claude Code 要掛梯子嗎？** 和你平時在終端裡用 `claude` 一樣：平時要，這裡也要。不想折騰就在設定的“API 介面”裡選智譜、矽基流動（都有免費模型）或本機 Ollama，國內直連。

**Claude Code 額度用完了？** 等額度恢復後點“重試”，或者在設定裡臨時換成 API / Ollama，已經譯好的頁不會重譯。

**資料存在哪？** 全在本機。從原始碼執行時在專案目錄的 `library/`；pip 安裝後在 `~/EasyRead/library/`。每篇論文一個資料夾，裡面是原 PDF、原頁圖和幾個 JSON（譯文、你的筆記、AI 討論、對話記錄），設定和介面偏好在 `config.json`、`prefs.json`。可以直接備份或同步。為什麼不用資料庫見 [docs/data-format.md](docs/data-format.md#為什麼用-json-檔案而不是資料庫)。

**能離線看、發給別人嗎？** 能。文獻庫裡右鍵一篇論文 → “匯出離線 HTML”，得到一個單檔案網頁（命令列是 `easyread export ID`）。對方不用裝 EasyRead，雙擊用瀏覽器開啟就能讀：譯文、公式、原頁圖、你的劃線和筆記都在裡面，也能切對照、開原頁、接著劃線。原頁圖是打包進去的，所以檔案不小（27 頁的論文約 10 MB）。在離線版裡新做的劃線和筆記只存在開啟它的那個瀏覽器裡；想並回文獻庫，在左側“說明”裡點“匯出我的修改”得到一個 JSON，再執行 `easyread merge ID --from 匯出.json`。

想放到網站上（比如 GitHub Pages），用 `easyread demo ID --out 目錄`：圖片另存成檔案、按需載入，還會帶上問 AI 的對話記錄（只能看）。

## 開發

沒有前端構建：`easyread/web/` 下是純 HTML/CSS/JS，改完重新整理即可。後端只用 Python 標準庫加 PDF 處理庫。

```bash
python -m unittest discover tests         # 翻譯排程等單元測試
node tests/e2e.cjs library/<論文ID>       # 瀏覽器端到端測試（需要 Playwright 和一篇已譯好的論文）
```

設計取捨見 [docs/design.md](docs/design.md)，版本變化見 [CHANGELOG.md](CHANGELOG.md)。

## 許可

MIT。公式渲染用 [KaTeX](https://katex.org)（MIT）。

線上演示用的論文是 Rafailov 等人的 *Direct Preference Optimization: Your Language Model is Secretly a Reward Model*（[arXiv:2305.18290](https://arxiv.org/abs/2305.18290)，CC BY 4.0），中文譯文由 EasyRead 呼叫 Claude 生成，演示裡的劃線和筆記是示例。

## 貢獻者

- [@Wang-auspicious](https://github.com/Wang-auspicious) — Electron 桌面版打包與釋出流程
- [@bisuwuss-netizen](https://github.com/bisuwuss-netizen) — 修復桌面安裝包漏打 PDF 依賴、雙欄論文原頁定位；“問 AI”和筆記裡的 Markdown 表格與引用塊
- [@MeshedPoto](https://github.com/MeshedPoto) — 並行翻譯時 PDFium 隨機報錯、跨欄段落原頁高亮、macOS 桌面版穩定性、HTTPS 證書與流式回答的一批修復
