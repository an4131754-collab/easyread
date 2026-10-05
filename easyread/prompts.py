"""給模型的提示詞：分批翻譯、回答使用者問題、重譯一段。"""
from __future__ import annotations

import json
import re

from .store import Workspace

RULES = """翻譯要求：
- 中文譯文一律使用臺灣繁體中文與常用詞彙。
- 忠實：保留原文的論證順序、章節編號、公式、表格、引用號 [n]、限定詞（may/suggest/likely/at least）、否定和比較物件。可以調整中文語序、拆長句，讀起來要像中文母語者寫的學術文字。
- 只翻譯，不解釋、不總結、不加原文沒有的內容。原文的筆誤照錄，不要改。
- 但要留心原文自己的問題：數字前後對不上（表和正文、兩張表之間）、公式和文字說的不一致、符號用錯、明顯的筆誤。發現了就寫進 checks，正文照錄不改；沒有就不寫，不要為了寫而寫，也不要寫翻譯說明。
- 術語全文統一；首次出現的核心術語寫“中文（English）”。已有術語表必須遵守。統計學裡 standard error 譯“標準誤差”。
- 行內數學一律寫成 $TeX$（KaTeX 能渲染的 LaTeX），變數、下標、上標都要用 TeX，不要用 Unicode 拼。行間公式單獨成 math 塊，照原頁重排，原編號放 tag。
- 表格重排成 table 塊，表頭譯成繁體中文，數字原樣。圖用 figure 塊，盡量給出圖本身、不含題注的裁切框 box:[x0,y0,x1,y1]（左上、右下座標，範圍 0 到 1）。沒有原頁圖或看不清時不要猜；src 留空，由程式從原 PDF 裁圖。
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
注意 JSON 裡 TeX 的反斜槓要寫兩個（\\\\frac、\\\\text、\\\\bar）。字串裡的中文引號用“”或「」，不要出現沒轉義的英文雙引號 "。表格和圖依照它在原頁上的位置排列，不要移到提及它的段落後面。"""


_NOTE = re.compile(r"^\s*(\$\^|[¹²³⁴⁵⁶⁷⁸⁹*†‡]|\d{1,2}\s*https?:)|^\S*https?://\S*\s*$")
# 不帶上標、直接寫成 “3 That is, …” 的腳注（DeepSeek 常這麼寫）：開頭 1–2 位數字接大寫單詞，塊又很短
_NOTE_PLAIN = re.compile(r"^\s*\d{1,2}\s?[A-Z][a-z]")


_ENDS = (".", "?", "!", ":", ";", "。", "？", "！", "：", ")", "]", "\"", "”", "’")




def _context(ws: Workspace, pages: list[int], new_blocks: bool = True, skip_head: bool = False) -> str:
    """new_blocks=False：只給已有的塊補譯文（只讀原文之後再翻譯），不用提塊 id 和上一批的續文。
    skip_head：上一頁由另一段同時在譯（分段並行的交界），跨頁那段由它補完整，這批跳過頁首續文。"""
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
    if skip_head:
        p = pages[0]
        lines.append(f"第 {p - 1} 頁由另一批負責（同時在譯，或者稍後重試），從第 {p - 1} 頁跨到第 {p} 頁的那一段由它補完整。"
                     f"所以第 {p} 頁開頭如果是接著上一頁沒寫完的句子（不是新段落或新標題的開頭），這半段不要輸出，"
                     f"從第 {p} 頁第一個新段落、標題、公式或圖表開始。")
        return "\n".join(lines)
    # 只看紧挨著的前兩頁：再往前的段落不可能續到本批（分段並行時更早的頁可能是別的段譯的）
    # 腳注不算：模型常把腳注排在頁的最後一塊，拿它當“上一段”會讓下一批誤把頁首正文當續文跳過
    near = [b for b in blocks if pages[0] - 2 <= (b.get("page") or 0) < pages[0] and not _is_note(b)]
    prev = next((b for b in reversed(near) if b.get("en") and b.get("type") != "references"), None)
    if prev:
        end = prev["en"].rstrip()
        lines.append(f"上一批最後一段（{prev['id']}，第 {prev['page']} 頁）的英文結尾：……{end[-300:]}")
        # 只有最後一塊就是這個段落、而且停在半句時才算沒補完；後面跟著標題的，那段已经結束了
        tail = end[:-1].rstrip() if end.endswith("$") and end.count("$") % 2 == 0 else end  # “…$x=1.$”看公式裡面的句號
        last = near[-1]
        if last is not prev and last.get("type") in ("math", "table", "figure"):
            # 上一頁以公式、表、圖結尾：本頁開頭常是公式後面接著的半句（where …、“… independent questions.”），
            # 它不是上一段的續文，上一批也不會譯它
            lines.append(f"上一頁最後是{'公式' if last.get('type') == 'math' else '圖表'}（{last['id']}）。本批第一頁開頭如果是接在它後面的文字"
                         "（比如公式後的 where …，或者公式前那句話的後半句），要譯出來：單獨成一段，紧接公式的加 \"cont\": true。")
        elif last is not prev or prev.get("type") != "para" or tail.endswith(_ENDS) or end.endswith("$$"):
            lines.append("如果本批第一頁開頭是這一段的續文，不要再輸出這段續文。")
        else:  # 上一批沒能把這段補完（下一頁開頭的抽取文字裡常先排著表格、公式），續文得由這批譯
            lines.append("這一段在上一批停在了半句，沒有補完。本批第一頁開頭接著這段的續文要譯出來：單獨成一段並加 \"cont\": true，"
                         "從續文的第一個詞開始，不要重複上一批已经譯了的部分。")
    return "\n".join(lines)


def _page_texts(ws: Workspace, pages: list[int]) -> str:
    texts = []
    for n in pages:
        p = ws.root / "extract" / f"page-{n:03d}.txt"
        texts.append(f"===== 第 {n} 頁（抽取的文字，公式和表格可能是亂的）=====\n" + (p.read_text(encoding="utf-8") if p.exists() else ""))
    return "\n\n".join(texts)


def translate(ws: Workspace, pages: list[int], engine: str, next_head: str, skip_head: bool = False, peek=(), front: str = "") -> str:
    """front：分段並行時每段第一批的前文參考（見 front_context）。"""
    look = ""
    if next_head:
        look = ("\n===== 下一頁開頭（只用來把本批最後一段補完整，其餘不要翻譯）=====\n" + next_head)
    see = ""
    if engine == "claude":
        imgs = "、".join(f"extract/page-{n:03d}.jpg" for n in pages)
        see = f"\n先用 Read 工具看原頁圖 {imgs}，以原頁為準核對公式、表格、上下標和閱讀順序（雙欄論文按欄讀）。抽取的文字只作參考。"
    elif engine == "attached":
        see = "\n附上了這幾頁的原頁圖，以原頁為準核對公式、表格和閱讀順序。"
    see += peek_note(engine, pages, list(peek))
    return (f"你在把一篇學術論文譯成繁體中文，這次只處理第 {', '.join(map(str, pages))} 頁。{see}\n\n"
            f"{_context(ws, pages, skip_head=skip_head)}\n\n{RULES}\n\n{SCHEMA}\n\n" + (front + "\n\n" if front else "")
            + _page_texts(ws, pages) + look)


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


def _is_note(b: dict) -> bool:
    text = b.get("en") or ""
    if _NOTE.search(text):
        return True
    return b.get("type") != "heading" and bool(_NOTE_PLAIN.match(text)) and len(text.split()) < 40


def peek_note(engine: str, pages: list[int], peek: list[int]) -> str:
    """分段並行的交界：兩邊的批次都看一眼相鄰那頁的原頁圖，按同一張圖判斷跨頁那段在哪結束。
    只靠抽取文字不行：下一頁的抽取文字常常先排著表格或圖，開頭 1500 字裡可能根本沒有那段的後半句。"""
    if engine not in ("claude", "attached"):
        return ""
    out = []
    if engine == "attached" and peek:  # 附圖不帶頁碼：说清楚順序（translate 裡按頁碼排好了）
        out.append("附上的原頁圖按頁碼排，依次是第 " + "、".join(map(str, sorted({*pages, *peek}))) + " 頁。")
    for n in peek:
        img = f"Read 看 extract/page-{n:03d}.jpg" if engine == "claude" else f"看附上的第 {n} 頁原頁圖"
        if n > pages[-1]:
            out.append(f"另外用 {img} 的開頭：只用來把本批最後一段補完整（那段可能接著寫到第 {n} 頁，頁首也可能先排著表格或圖），第 {n} 頁其餘內容不要輸出。")
        else:
            out.append(f"另外用 {img} 的末尾：只用來判斷第 {pages[0]} 頁開頭哪些是第 {n} 頁那段的續文，第 {n} 頁的內容不要輸出。")
    return "\n" + "\n".join(out) if out else ""
