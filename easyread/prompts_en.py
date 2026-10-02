"""“只讀原文”的兩段提示詞：
- structure：不翻譯，只把原頁整理成和譯文一樣的塊（段落、標題、公式、表格），文字都放 en；
- fill：之後想看中文了，給已經整理好的塊就地補上 zh，塊 id 不變，筆記、劃線都還掛得住。"""
from __future__ import annotations

import json

from .prompts import RULES, _context, _page_texts
from .store import Workspace

RULES_EN = """整理要求（不翻譯）：
- 只把原文整理好，不翻譯、不解釋、不總結，不加原文沒有的內容。原文的筆誤照錄。
- 保留原文的閱讀順序、章節編號、引用號 [n]。雙欄論文按欄讀，斷在行尾的連字元單詞拼回去。
- 行內數學一律寫成 $TeX$（KaTeX 能渲染的 LaTeX），變數、下標、上標都要用 TeX，不要用 Unicode 拼。行間公式單獨成 math 塊，照原頁重排，原編號放 tag。
- 表格重排成 table 塊，表頭和單元格照原文。圖用 figure 塊，只寫題注（src 留空）。
- 參考文獻列表：輸出一個 references 塊，條目放進 references 陣列（id 是編號，text 是原文）。
- 看不清的地方寫“[unclear, see page N]”，不要猜。
- 頁首、頁尾、頁碼、arXiv 側邊水印不要輸出。"""

SCHEMA_EN = """輸出格式：只輸出一個 JSON 物件，不要任何別的文字。
{
  "meta": {"title_en": "", "authors": "作者, 用逗號分隔", "affiliation": "", "date": "", "venue": ""},   // 只有包含第 1 頁時才寫
  "references": [{"id": "1", "text": "原文條目"}],             // 本批出現參考文獻列表時才寫
  "blocks": [ ... ]
}
塊（每塊都要 id、type、page；page 是這塊在原 PDF 中開始的頁碼；文字只寫 en，不寫 zh）：
- {"id":"p3-2","type":"para","page":3,"en":"原文（行內數學也寫成 $TeX$）"}   摘要段落加 "role":"abstract"；緊接在公式後的半句（如 where …）加 "cont": true
- {"id":"s2-1","type":"heading","page":2,"level":1或2,"num":"2.1","en":"Independent questions"}   附錄標題加 "appendix": true，摘要標題 num 留空
- {"id":"p2-5","type":"list","page":2,"ordered":true,"items":[{"en":"…"}]}
- {"id":"eq1","type":"math","page":3,"tex":"…","tag":"1"}   沒有編號不寫 tag；多行用 \\begin{aligned}…\\end{aligned}
- {"id":"tab2","type":"table","page":3,"num":"2","head":[["","Questions","…"]],"rows":[["MATH","5,000","65.5%\\n(0.7%)"]],"align":"lrr","caption_en":"Table 2: …"}
- {"id":"fig1","type":"figure","page":4,"num":"1","src":"","caption_en":"Figure 1: …"}
- {"id":"refs","type":"references","page":10,"en":"References"}
id 規則：段落 p{頁}-{序號}，標題 s{編號，點換成橫線}，公式 eq{編號} 或 eq-p{頁}-{序號}，表 tab{編號}，圖 fig{編號}。
注意 JSON 裡 TeX 的反斜槓要寫兩個（\\\\frac、\\\\text、\\\\bar）。字串裡的英文雙引號要轉義成 \\"。表格和圖放在正文第一次提到它的段落之後。"""


def structure(ws: Workspace, pages: list[int], engine: str, next_head: str) -> str:
    see = ""
    if engine == "claude":
        imgs = "、".join(f"extract/page-{n:03d}.jpg" for n in pages)
        see = f"\n先用 Read 工具看原頁圖 {imgs}，以原頁為準核對公式、表格、上下標和閱讀順序（雙欄論文按欄讀）。抽取的文字只作參考。"
    elif engine == "attached":
        see = "\n附上了這幾頁的原頁圖，以原頁為準核對公式、表格和閱讀順序。"
    look = ("\n===== 下一頁開頭（只用來把本批最後一段補完整，其餘不要輸出）=====\n" + next_head) if next_head else ""
    return (f"你在把一篇學術論文的 PDF 整理成便於閱讀的結構化原文（讀者要直接讀英文，不要翻譯），這次只處理第 {', '.join(map(str, pages))} 頁。{see}\n\n"
            f"{_context(ws, pages)}\n\n{RULES_EN}\n\n{SCHEMA_EN}\n\n" + _page_texts(ws, pages) + look)


def todo(blocks: list[dict]) -> dict[str, object]:
    """這些塊裡還沒有中文的地方：{鍵: 英文}。鍵同頁面：塊 id、id#caption、id#序號、id#head（表頭）。"""
    out: dict[str, object] = {}
    for b in blocks:
        t = b.get("type")
        if t in ("para", "heading") and b.get("en") and not b.get("zh"):
            out[b["id"]] = b["en"]
        elif t == "list":
            for i, it in enumerate(b.get("items", [])):
                if it.get("en") and not it.get("zh"):
                    out[f"{b['id']}#{i}"] = it["en"]
        elif t in ("table", "figure") and b.get("caption_en") and not b.get("caption_zh"):
            out[f"{b['id']}#caption"] = b["caption_en"]
            if t == "table" and b.get("head"):
                out[f"{b['id']}#head"] = b["head"]
    return out


def fill(ws: Workspace, pages: list[int], items: dict[str, object]) -> str:
    """給已經整理好的原文塊補譯文。"""
    first = 1 in pages
    meta = ('  "meta": {"title_zh": "", "short_zh": "不超過 12 字的短標題"},   // 論文英文標題：'
            + json.dumps(ws.load("paper").get("meta", {}).get("title_en", ""), ensure_ascii=False) + "\n") if first else ""
    return (f"你在把一篇學術論文譯成繁體中文。原文已經整理成塊，這次只翻譯第 {', '.join(map(str, pages))} 頁上下面這些鍵對應的文字。\n\n"
            f"{_context(ws, pages)}\n\n{RULES}\n"
            "- 表頭（鍵以 #head 結尾）是二維陣列：保持行列數不變，把文字譯成繁體中文，數字和符號原樣。\n\n"
            "輸出格式：只輸出一個 JSON 物件，不要任何別的文字。\n{\n" + meta +
            '  "glossary": [{"en": "standard error", "zh": "標準誤差"}],   // 本批新出現的核心術語\n'
            '  "checks": [{"anchor": "塊 id", "quote": "譯文裡相關的幾個字（可空）", "title": "一句話：哪裡不對", "body": "具體說明和依據"}],   // 原文有問題時才寫\n'
            '  "zh": {"鍵": "繁體中文譯文", …}   // 下面每個鍵都要有，一個不漏\n}\n'
            "注意 JSON 裡 TeX 的反斜槓要寫兩個（\\\\frac、\\\\text、\\\\bar）。字串裡的中文引號用“”或「」。\n\n"
            "要翻譯的內容（鍵 → 英文）：\n" + json.dumps(items, ensure_ascii=False, indent=1))
