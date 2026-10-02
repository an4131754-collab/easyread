"""給模型的提示詞：分批翻譯、回答使用者問題、重譯一段。"""
from __future__ import annotations

import json

from .store import Workspace

RULES = """翻譯要求：
- 中文譯文一律使用臺灣繁體中文與常用詞彙。
- 忠實：保留原文的論證順序、章節編號、公式、表格、引用號 [n]、限定詞（may/suggest/likely/at least）、否定和比較物件。可以調整中文語序、拆長句，讀起來要像中文母語者寫的學術文字。
- 只翻譯，不解釋、不總結、不加原文沒有的內容。原文的筆誤照錄，不要改。
- 但要留心原文自己的問題：數字前後對不上（表和正文、兩張表之間）、公式和文字說的不一致、符號用錯、明顯的筆誤。發現了就寫進 checks，正文照錄不改；沒有就不寫，不要為了寫而寫，也不要寫翻譯說明。
- 術語全文統一；首次出現的核心術語寫“中文（English）”。已有術語表必須遵守。統計學裡 standard error 譯“標準誤差”。
- 行內數學一律寫成 $TeX$（KaTeX 能渲染的 LaTeX），變數、下標、上標都要用 TeX，不要用 Unicode 拼。行間公式單獨成 math 塊，照原頁重排，原編號放 tag。
- 表格重排成 table 塊，表頭譯成繁體中文，數字原樣。圖用 figure 塊，只寫題注（src 留空）。
- 參考文獻列表不翻譯：輸出一個 references 塊，條目放進 references 陣列（id 是編號，text 是原文）。
- 看不清的地方寫“此處識別不清，請核對原文第 N 頁”，不要猜。
- 頁首、頁尾、頁碼、arXiv 側邊水印不要輸出。"""

SCHEMA = """輸出格式：只輸出一個 JSON 物件，不要任何別的文字。
{
  "meta": {"title_zh": "", "short_zh": "不超過 12 字的短標題", "title_en": "", "authors": "作者, 用逗號分隔", "affiliation": "", "date": "", "venue": ""},   // 只有包含第 1 頁時才寫
  "glossary": [{"en": "standard error", "zh": "標準誤差"}],   // 本批新出現的核心術語
  "references": [{"id": "1", "text": "原文條目"}],             // 本批出現參考文獻列表時才寫
  "checks": [{"anchor": "塊 id", "quote": "譯文裡相關的幾個字（可空）", "title": "一句話：哪裡不對", "body": "具體說明和依據，比如算一遍給出對得上的數"}],   // 原文有問題時才寫
  "blocks": [ ... ]
}
塊（每塊都要 id、type、page；page 是這塊在原 PDF 中開始的頁碼）：
- {"id":"p3-2","type":"para","page":3,"en":"英文原文（行內數學也寫成 $TeX$）","zh":"繁體中文譯文"}   摘要段落加 "role":"abstract"；緊接在公式後的半句（如 where …）加 "cont": true
- {"id":"s2-1","type":"heading","page":2,"level":1或2,"num":"2.1","en":"Independent questions","zh":"相互獨立的題目"}   附錄標題加 "appendix": true，摘要標題 num 留空
- {"id":"p2-5","type":"list","page":2,"ordered":true,"items":[{"en":"…","zh":"…"}]}
- {"id":"eq1","type":"math","page":3,"tex":"…","tag":"1"}   沒有編號不寫 tag；多行用 \\begin{aligned}…\\end{aligned}
- {"id":"tab2","type":"table","page":3,"num":"2","head":[["","題目數","…"]],"rows":[["MATH","5,000","65.5%\\n(0.7%)"]],"align":"lrr","caption_en":"Table 2: …","caption_zh":"表 2：…"}
- {"id":"fig1","type":"figure","page":4,"num":"1","src":"","caption_en":"Figure 1: …","caption_zh":"圖 1：…"}
- {"id":"refs","type":"references","page":10,"zh":"參考文獻","en":"References"}
id 規則：段落 p{頁}-{序號}，標題 s{編號，點換成橫線}，公式 eq{編號} 或 eq-p{頁}-{序號}，表 tab{編號}，圖 fig{編號}。
注意 JSON 裡 TeX 的反斜槓要寫兩個（\\\\frac、\\\\text、\\\\bar）。字串裡的中文引號用“”或「」，不要出現沒轉義的英文雙引號 "。表格和圖放在正文第一次提到它的段落之後。"""


def _context(ws: Workspace, pages: list[int], new_blocks: bool = True) -> str:
    """new_blocks=False：只給已有的塊補譯文（只讀原文之後再翻譯），不用提塊 id 和上一批的續文。"""
    paper = ws.load("paper")
    meta = paper.get("meta", {})
    blocks = paper.get("blocks", [])
    lines = [f"論文：{meta.get('title_en') or meta.get('source', '')}，共 {meta.get('page_count', '?')} 頁。"]
    gl = paper.get("glossary", [])
    if gl:
        lines.append("已有術語表（必須沿用）：" + "；".join(f"{g['en']} = {g['zh']}" for g in gl))
    heads = [f"{b.get('num', '')} {b.get('zh') or b.get('en', '')}".strip() for b in blocks if b.get("type") == "heading"]
    if heads:
        lines.append("已有的章節：" + " / ".join(heads))
    if not new_blocks:
        return "\n".join(lines)
    ids = [b["id"] for b in blocks]
    if ids:
        lines.append("已用過的塊 id（不要重複）：" + ", ".join(ids[-60:]))
    prev = next((b for b in reversed(blocks) if (b.get("page") or 0) < pages[0] and b.get("en")), None)
    if prev:
        lines.append(f"上一批最後一段（{prev['id']}，第 {prev['page']} 頁）的英文結尾：……{prev['en'][-300:]}\n"
                     "如果本批第一頁開頭是這一段的續文，不要再輸出這段續文。")
    return "\n".join(lines)


def _page_texts(ws: Workspace, pages: list[int]) -> str:
    texts = []
    for n in pages:
        p = ws.root / "extract" / f"page-{n:03d}.txt"
        texts.append(f"===== 第 {n} 頁（抽取的文字，公式和表格可能是亂的）=====\n" + (p.read_text(encoding="utf-8") if p.exists() else ""))
    return "\n\n".join(texts)


def translate(ws: Workspace, pages: list[int], engine: str, next_head: str) -> str:
    look = ""
    if next_head:
        look = ("\n===== 下一頁開頭（只用來把本批最後一段補完整，其餘不要翻譯）=====\n" + next_head)
    see = ""
    if engine == "claude":
        imgs = "、".join(f"extract/page-{n:03d}.jpg" for n in pages)
        see = f"\n先用 Read 工具看原頁圖 {imgs}，以原頁為準核對公式、表格、上下標和閱讀順序（雙欄論文按欄讀）。抽取的文字只作參考。"
    elif engine == "attached":
        see = "\n附上了這幾頁的原頁圖，以原頁為準核對公式、表格和閱讀順序。"
    return (f"你在把一篇學術論文譯成繁體中文，這次只處理第 {', '.join(map(str, pages))} 頁。{see}\n\n"
            f"{_context(ws, pages)}\n\n{RULES}\n\n{SCHEMA}\n\n" + _page_texts(ws, pages) + look)


def repair(original_json: str, problems: list[str]) -> str:
    return ("下面這份論文翻譯 JSON 有問題，請修好後輸出完整的 JSON（格式不變，只輸出 JSON）：\n"
            + "\n".join(f"- {p}" for p in problems[:30]) + "\n\nJSON：\n" + original_json)


def _block_text(b: dict) -> str:
    """塊的正文：有譯文用譯文，只讀原文、還沒譯的塊用英文。"""
    if b.get("type") == "list":
        return "\n".join(f"- {it.get('zh') or it.get('en', '')}" for it in b.get("items", []))
    if b.get("type") in ("table", "figure"):
        return b.get("caption_zh") or b.get("caption_en", "")
    if b.get("type") == "math":
        return f"$${b.get('tex', '')}$$"
    return b.get("zh") or b.get("en", "")


def answer(ws: Workspace, note: dict) -> str:
    paper = ws.load("paper")
    blocks = paper.get("blocks", [])
    idx = next((i for i, b in enumerate(blocks) if b.get("id") == note.get("anchor")), None)
    near = blocks[max(0, idx - 3): idx + 3] if idx is not None else blocks[:6]
    section = ""
    if idx is not None:
        h = next((b for b in reversed(blocks[:idx + 1]) if b.get("type") == "heading"), None)
        section = f"{h.get('num', '')} {h.get('zh') or h.get('en', '')}" if h else ""
    ctx = "\n\n".join(f"[{b['id']}] {_block_text(b)}" for b in near)
    focus = blocks[idx] if idx is not None else {}
    return (f"你在和讀者一起讀論文《{paper.get('meta', {}).get('title_zh') or paper.get('meta', {}).get('title_en')}》。"
            f"讀者讀到「{section}」時在 [{note.get('anchor')}] 這段提了一個問題。\n\n"
            f"上下文（繁體中文譯文；還沒譯的段落是英文原文）：\n{ctx}\n\n這段英文原文：{focus.get('en', '')}\n\n"
            + (f"讀者選中的原話：「{note.get('quote')}」\n" if note.get("quote") else "")
            + f"讀者的問題：{note.get('body', '')}\n\n"
            "需要時可以用 Read 讀當前目錄的 paper.json 看全文。請直接回答：用繁體中文，具體、講清楚，能舉例就舉例，"
            "區分“論文裡寫了什麼”和“你的補充解釋”。行內公式用 $TeX$，段落之間空一行。只輸出回答正文，不要客套。")


def retranslate(ws: Workspace, key: str, hint: str) -> str:
    paper = ws.load("paper")
    bid, _, field = key.partition("#")
    blocks = paper.get("blocks", [])
    idx = next(i for i, b in enumerate(blocks) if b.get("id") == bid)
    b = blocks[idx]
    if field == "caption":
        en, zh = b.get("caption_en", ""), b.get("caption_zh", "")
    elif field.isdigit():
        en, zh = b["items"][int(field)].get("en", ""), b["items"][int(field)].get("zh", "")
    else:
        en, zh = b.get("en", ""), b.get("zh", "")
    near = "\n".join(_block_text(x) for x in blocks[max(0, idx - 2): idx + 3] if x is not b)
    gl = "；".join(f"{g['en']} = {g['zh']}" for g in paper.get("glossary", []))
    return (f"請重新翻譯論文裡的一段。\n{RULES}\n\n術語表：{gl}\n\n前後文（譯文）：\n{near}\n\n"
            f"英文原文：\n{en}\n\n現在的譯文：\n{zh}\n\n"
            + (f"讀者覺得不好的地方：{hint}\n\n" if hint else "")
            + '只輸出 JSON：{"zh": "新譯文"}')


def dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1)
