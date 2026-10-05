"""分段並行時，每段第一批的“前文參考”：論文開頭、章節目錄、上一頁全文。只給模型理解用，不翻譯。

段內後面的批能看到前一批的譯文和上一段結尾；每段第一批開譯時前文還沒譯出來，
只能給原文：頁首如果是半句話，上一頁那整句是理解它的關鍵；前面定義過的縮寫、符號也在前文裡。
全部來自 PDF 抽取的文字，不多調一次模型，大約多兩三千 token。
"""
from __future__ import annotations

import re
from pathlib import Path

from .segments import _HEADING, _lines

HEAD_CHARS = 1800   # 論文開頭：標題、作者、摘要
PREV_CHARS = 5000   # 上一頁全文太長時只留後面這些（離本批最近的部分）
OUTLINE_MAX = 60    # 章節目錄最多幾條
_REFS = re.compile(r"^\s*(\d+\.?\s*)?(references|bibliography)\s*$", re.I)  # i18n-ok
_ENTRY = re.compile(r"[A-Z]\.\s*(,|and\b)|\bet al\.|\(\d{4}\)|\d{4}\.")  # 參考文獻條目、正文句子裡像作者、年份的寫法


def _page(root: Path, n: int) -> str:
    return "\n".join(_lines(root, n))


def outline(root: Path, upto: int) -> list[str]:
    """第 1 頁到 upto 頁裡像章節標題的行，帶頁碼。到參考文獻為止（後面的編號條目不是標題）；
    太多時留離本批最近的那些。"""
    out: list[str] = []
    for n in range(1, upto + 1):
        for s in _lines(root, n):
            if len(s) < 80 and _REFS.match(s):
                return out[-OUTLINE_MAX:]
            if len(s) < 80 and _HEADING.match(s) and not s.startswith("[") and not _ENTRY.search(s):
                out.append(f"{s}（第 {n} 頁）")
    return out[-OUTLINE_MAX:]


def build(root: Path, first_page: int) -> str:
    """first_page 這批之前的原文參考。first_page 是 1 時沒有前文，返回空。"""
    if first_page <= 1:
        return ""
    parts = ["===== 前文參考（原文，只用來理解本批：縮寫、符號、指代、頁首半句話的完整意思；不要翻譯、不要輸出）====="]
    head = _page(root, 1)[:HEAD_CHARS]
    if head and first_page > 2:  # 上一頁就是第 1 頁時，下面已经整頁給了
        parts.append("【論文開頭】\n" + head)
    toc = outline(root, first_page - 1)
    if toc:
        parts.append("【前面的章節】\n" + "\n".join(toc))
    prev = _page(root, first_page - 1)
    if prev:
        parts.append(f"【第 {first_page - 1} 頁全文】\n" + (prev if len(prev) <= PREV_CHARS else "……" + prev[-PREV_CHARS:]))
    parts.append("===== 前文參考到此 =====")
    return "\n".join(parts)
