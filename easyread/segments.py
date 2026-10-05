"""分段並行：把要譯的頁切成幾段連續的頁，各段同時開譯，段內一批接一批按順序譯。

段內和逐批串行一樣：後一批能看到前一批並進去的術語表、章節和上一段結尾。
段與段的交界只有 段數-1 處，切口盡量挑在“上一頁句子寫完了、下一頁從新段落或標題開始”的地方；
交界處跨頁的那一段由前一段的最後一批補完整（它本來就看下一頁開頭），後一段第一批跳過頁首那半段。
"""
from __future__ import annotations

import math
import re
from pathlib import Path

AUTO_MAX = 4      # “自動”最多同時幾段（手動最多 8 段）
LANE_BATCHES = 2  # “自動”時每段大約幾批：段數 = 總批數 / 2 向上取整（每批 2 頁時每段 4 頁），最多 AUTO_MAX

_NOISE = re.compile(r"^\s*(\d{1,4}|[ivxl]{1,5}|(?i:page \d+.*|arxiv:.*))\s*$")  # i18n-ok 頁碼、arXiv 水印這類
_HEADING = re.compile(r"^\s*((\d+(\.\d+)*\.?|[A-Z]\.?)\s+[A-Z][a-z]|\[\d+\]\s|(?i:appendix|references|abstract|acknowledg)\b)")  # i18n-ok 章節標題、新的參考文獻條目


def workers(setting, n_batches: int) -> int:
    """最多同時幾段。setting 是設定裡的“同時幾段”：0 或空是自動，按篇幅每段大約 2 批，最多 4 段；手動最多 8 段。"""
    try:
        cap = int(setting or 0)
    except (TypeError, ValueError):
        cap = 0
    if cap > 0:
        return min(8, cap)
    return max(1, min(AUTO_MAX, math.ceil(n_batches / LANE_BATCHES)))


_WORD = re.compile(r"[A-Za-z]{2,}")
_CAPTION = re.compile(r"^\s*(Table|Figure|Fig\.|Algorithm)\s*\d", re.I)  # i18n-ok
_FOOTNOTE = re.compile(r"^\s*([¹²³⁴⁵⁶⁷⁸⁹*†‡]|\d{1,2}\s*(https?|www\.)|\d{1,2}[A-Z][a-z])|https?://")


def _body(line: str) -> bool:
    return len(_WORD.findall(line)) >= 4 and not _FOOTNOTE.search(line)


def _lines(root: Path, n: int) -> list[str]:
    p = root / "extract" / f"page-{n:03d}.txt"
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    return [s.strip() for s in text.splitlines() if s.strip() and not _NOISE.match(s)]


def seam_cost(root: Path, prev: int, nxt: int) -> float:
    """在 prev 頁和 nxt 頁之間切開的代價：0 乾淨（新章節開頭），1 句子寫完了，2 看不出來，3 明顯斷在句子中間。"""
    if nxt != prev + 1:
        return 0.0  # 中間隔著沒要譯的頁，本來就接不上
    # 只看正文行：腳注、網址、表格裡的數字、圖表題注都不算（腳注末尾的句號騙不了人，頁首先排的表格也不算開頭）
    tail = [s for s in _lines(root, prev) if _body(s)]
    head = [s for s in _lines(root, nxt) if (_HEADING.match(s) and len(s) < 80) or (_body(s) and not _CAPTION.match(s))]
    if not tail or not head:
        return 2.0
    first, last = head[0], tail[-1]
    if first[:1].islower() or last.endswith(("-", ",")):
        return 3.0
    if _HEADING.match(first) and len(first) < 80:
        return 0.0
    return 1.0 if last.endswith((".", "?", "!", ":")) else 2.0


def plan(pages: list[int], size: int, k: int, root: Path) -> list[list[int]]:
    """把 pages 切成至多 k 段。先定最慢一段要譯幾批（總批數 / k 向上取整），每段不超過這麼多批；
    在這個限制下挑交界代價最小的切法：每多一個交界加 0.5，再加交界本身的代價，再按批數加一點（奇數頁的段多一次調用）。
    這樣 7 批開 4 段（2,2,2,1），5 批開 3 段（2,2,1）就夠，交界越少越好；有餘量時切口挪到乾淨的地方。"""
    n = len(pages)
    if k <= 1 or n <= 1:
        return [list(pages)] if pages else []
    k = min(k, n)
    cap = math.ceil(math.ceil(n / size) / k) * size
    inf = float("inf")
    # best[j][i]：前 i 頁切成 j 段的最小代價
    best = [[inf] * (n + 1) for _ in range(k + 1)]
    back = [[0] * (n + 1) for _ in range(k + 1)]
    best[0][0] = 0.0
    seam = [0.0] + [0.5 + seam_cost(root, pages[i - 1], pages[i]) for i in range(1, n)]
    for j in range(1, k + 1):
        for i in range(1, n + 1):
            for s in range(max(0, i - cap), i):
                if best[j - 1][s] == inf:
                    continue
                c = best[j - 1][s] + seam[s] + 0.3 * math.ceil((i - s) / size)
                if c < best[j][i]:
                    best[j][i], back[j][i] = c, s
    j = min((j for j in range(1, k + 1) if best[j][n] < inf), key=lambda j: (best[j][n], j))
    out, i = [], n
    while j:
        s = back[j][i]
        out.append(pages[s:i])
        i, j = s, j - 1
    return out[::-1]
