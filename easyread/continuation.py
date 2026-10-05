"""跨頁續文核對：模型對一批頁返回空（整批都是上一頁那段的續文，已经並進上一段），確認屬實才算譯完。

只有原頁文字完整出現在上一段英文的結尾、原頁上又沒有圖形時才接受，不能據此吞掉沒譯的內容。
（思路和测試來自 NGman-s 的 PR #30。）
"""
from __future__ import annotations

import re
import unicodedata
from contextlib import closing

from . import engines, pdfwork
from .paperdata import fill_zh
from .prompts import _is_note
from .store import Workspace

_LIGATURES = str.maketrans({"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"})
_BREAK = re.compile(
    r"(?<=[^\W\d_])[­￾](?:[ \t]*\n[ \t]*)?(?=[^\W\d_])"
    r"|(?<=[^\W\d_]{2})-[ \t]*\n[ \t]*(?=[^\W\d_]{2})"
)


def _text(text: str) -> str:
    """只统一空白和 PDF 連字，保留大小寫、詞間邊界、連字符及上下標。"""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text).translate(_LIGATURES)).strip()


def _pattern(text: str) -> str:
    """僅原頁明確的斷詞位置允許有/无連字符，不刪除普通詞中或公式裡的減號。"""
    text = unicodedata.normalize("NFC", text).translate(_LIGATURES).strip()
    return "[-­￾]?".join(re.escape(_text(part)) for part in _BREAK.split(text))


def _source(ws: Workspace, batch: list[int]) -> str | None:
    """文字吻合不能證明圖形也已處理；只接受可核對的纯文本 PDF 頁。"""
    import pypdfium2 as pdfium

    if not (ws.root / "source.pdf").exists():
        return None
    parts = []
    try:
        with pdfwork.open_pdf(ws.root / "source.pdf") as doc:
            for n in batch:
                path = ws.root / "extract" / f"page-{n:03d}.txt"
                if not path.exists():
                    return None
                lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
                with closing(doc[n - 1]) as page, closing(page.get_textpage()) as textpage:
                    if not textpage.count_chars() or any(obj.type != pdfium.raw.FPDF_PAGEOBJ_TEXT for obj in page.get_objects()):
                        return None
                    width, height = page.get_size()
                    footer = _text(textpage.get_text_bounded(0, 0, width, height * 0.08))
                    if lines and lines[-1] == str(n) and footer == str(n):
                        lines.pop()  # 僅忽略原頁底部單獨的頁碼，不把正文數字當頁碼丟掉
                text = "\n".join(lines)
                if not text or not any(c.isalpha() for c in text):
                    return None  # 空白頁、扫描頁、只有頁碼，都沒有可核對的正文
                parts.append(text)
        return "\n".join(parts)
    except (OSError, UnicodeError, pdfium.PdfiumError, IndexError, ValueError):
        return None  # 原頁讀不出就保留失敗状態，不能僅凭緩存文本宣告完成


def covered(ws: Workspace, batch: list[int], read: bool) -> bool:
    """這批（連續的頁、上面還沒有塊）的原文已经完整並在上一段結尾：空輸出算譯完。
    read：只讀原文，上一段有英文就行；否則上一段還得已经有譯文。在合並鎖裡調。"""
    paper = ws.load("paper")
    if not batch or batch != list(range(batch[0], batch[-1] + 1)):
        return False
    if batch[0] - 1 not in paper.get("translation", {}).get("done_pages", []):
        return False
    blocks = paper.get("blocks", [])
    if any(b.get("page") in batch for b in blocks):
        return False  # 重譯空輸出不能刪掉這些頁上已有的塊
    # 腳注不算上一段（和 prompts._context 一致：模型常把腳注排在頁的最後一塊）
    prev = next((b for b in reversed(blocks) if (b.get("page") or 0) < batch[0] and not _is_note(b)), None)
    if not prev or prev.get("type") != "para" or not prev.get("en") or (not read and not (prev.get("zh") or "").strip()):
        return False
    text = _source(ws, batch)
    return text is not None and re.search(_pattern(text) + r"\Z", _text(prev["en"])) is not None


class WaitPrev(Exception):
    """這幾頁模型沒給新內容，可能整頁都是上一頁那段的續文，但上一頁還在別的段裡譯，現在核對不了：
    先放著，全部譯完再核對（settle）。核對通過就調 finish 把這幾頁記為完成。"""

    def __init__(self, pages: list[int], read: bool, finish):
        super().__init__(pages)
        self.pages, self.read, self.finish = pages, read, finish


def _runs(pages: list[int]) -> list[list[int]]:
    """把頁碼切成幾段連續的。"""
    out: list[list[int]] = []
    for n in pages:
        if out and out[-1][-1] == n - 1:
            out[-1].append(n)
        else:
            out.append([n])
    return out


def fill_empty(ws: Workspace, empty: list[int], wait: bool) -> None:
    """補譯文時沒有塊的頁：上一段已经有譯文、續文核對得上，就移出 en_pages；
    核對不上拋錯，wait（上一頁還在別的段裡譯）時拋 WaitPrev 等全部譯完再核對。在合並鎖裡調。"""
    left = [n for run in _runs(empty) if not covered(ws, run, read=False) for n in run]
    done = [n for n in empty if n not in left]
    if done:
        fill_zh(ws, {}, done, set())
    if left and wait:
        raise WaitPrev(left, False, lambda: fill_zh(ws, {}, left, set()))
    if left:
        raise engines.EngineError('模型沒有譯出任何內容')


def settle(ws: Workspace, later: WaitPrev, lock, retry=None, note=lambda m: None) -> str:
    """全部譯完後核對先放著的頁：是續文就記完成；核對不上再調 retry 譯一次（相當於失敗重試，挪到了最後）。
    返回失敗原因，成功返回 ""。note 寫翻譯記錄。"""
    with lock:
        if covered(ws, later.pages, later.read):
            later.finish()
            note('整頁是上一段的續文')
            return ""
    err = '模型沒有整理出任何內容' if later.read else '模型沒有譯出任何內容'
    if not retry:
        return err
    note('核對不是上一段的續文，再譯一次')
    try:
        retry()
        return ""
    except engines.Cancelled:
        raise
    except Exception as e:  # noqa: BLE001
        return (str(e) if isinstance(e, engines.EngineError) else f"{type(e).__name__}: {e}")[:300]
