"""頁眉、頁腳帶的范围：圖的標籤不能連到頁眉頁腳裡去。

兩种依據：頂部 / 底部的整宽横線；在多頁同一位置重複出現的文字行（去掉數字後相同，
例如“Page 11”“NIST AI 100-1”、單獨的頁碼）。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

_BAND = .1  # 只在頁面上下各 10% 裡找頁眉頁腳
_DIGITS = re.compile(r"[\d\s]+")


def _lines(chars):
    """頁面上下邊帶裡的文字行：[(框, 去掉數字和空白的文字)]。"""
    chars = sorted((c for c in chars if c[2] < _BAND or c[4] > 1 - _BAND), key=lambda c: (c[2], c[1]))
    lines = []
    for c in chars:
        if lines and abs(c[2] - lines[-1][0][1]) < .004:
            box, text = lines[-1]
            lines[-1] = ([min(box[0], c[1]), min(box[1], c[2]), max(box[2], c[3]), max(box[3], c[4])], text + c[0])
        else:
            lines.append(([c[1], c[2], c[3], c[4]], c[0]))
    return [(box, _DIGITS.sub("", text).lower()) for box, text in lines]


def running_lines(extract_dir: Path, page_count: int) -> dict[int, list[list[float]]]:
    """在至少 3 頁、且不少於四分之一的頁上同一高度重複出現的行，按頁返回它們的框。"""
    per_page = {}
    for pn in range(1, page_count + 1):
        path = extract_dir / f"page-{pn:03d}.chars.json"
        try:
            per_page[pn] = _lines(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError, IndexError):
            continue
    seen = {}
    for pn, lines in per_page.items():
        for key in {(round(box[1] * 200), text) for box, text in lines}:
            seen[key] = seen.get(key, 0) + 1
    need = max(3, page_count / 4)
    return {pn: [box for box, text in lines if seen.get((round(box[1] * 200), text), 0) >= need]
            for pn, lines in per_page.items()}


def margins(separators, running=()) -> tuple[float, float]:
    """頁眉帶下沿和頁腳帶上沿，至少留頁邊 6%。"""
    rules = [b for b in separators if b[2] - b[0] > b[3] - b[1]]
    top = max([b[3] for b in rules if b[3] < .12] + [b[3] for b in running if b[3] < .5] + [.06])
    bottom = min([b[1] for b in rules if b[1] > .88] + [b[1] for b in running if b[1] > .5] + [.94])
    return top, bottom
