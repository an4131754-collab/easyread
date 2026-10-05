"""圖塊截圖。兩條路：

- 翻譯 / 只讀原文整理時，模型給了圖本身的裁剪框 box：等塊 id 在合並鎖裡最終去重之後，
  prepare_figures 按 box 截圖（normalize_figure 只整理字段，不截圖）。
- 模型沒給框、或是舊論文：打開閱讀頁時 fill_later 按原頁定位（layout.json）補截或更新自動截圖。

截圖檔案名帶上頁碼、框和 PDF 檔案身份的哈希（figures/crop-<頁>-<哈希>.webp）：
重譯改了框就換新檔案，不會沿用舊圖或浏覽器緩存，同 id 的塊在別的頁上也不會撞到同一張。
"""
from __future__ import annotations

import hashlib
import json
import math
import threading

from . import pdfwork
from .log import log

_running: set[str] = set()


def figure_box(value) -> list[float] | None:
    """歸一化 [x0, y0, x1, y1]；不是有限數、反了或太小都算无效。"""
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        coords = [float(x) for x in value]
    except (TypeError, ValueError, OverflowError):
        return None
    if not all(math.isfinite(x) for x in coords):
        return None
    box = [round(max(0.0, min(1.0, x)), 4) for x in coords]
    if box[2] - box[0] < .02 or box[3] - box[1] < .02:
        return None
    return box


def _crop_path(root, page: int, box: list[float]) -> str:
    source = (root / "source.pdf").stat()
    identity = json.dumps([page, box, source.st_size, source.st_mtime_ns])
    name = f"crop-{page}-{hashlib.sha256(identity.encode()).hexdigest()[:20]}"
    return f"figures/{name}.webp"


def crop(root, page: int, box: list[float]) -> str:
    """按頁碼、框和 PDF 身份命名截圖，已有同名檔案就直接用。返回相對路径。"""
    rel = _crop_path(root, page, box)
    if not (root / rel).is_file():
        pdfwork.crop(root, page, box, rel.rsplit("/", 1)[1][:-5])
    return rel


def normalize_figure(block: dict) -> None:
    """整理模型給的圖塊字段：框无效就去掉，image_text_* 舊寫法改成 image_*。不截圖。"""
    box = figure_box(block.get("box"))
    if box:
        block["box"] = box
    else:
        block.pop("box", None)
    for lang in ("en", "zh"):
        key = f"image_{lang}"
        value = block.get(key) or block.pop(f"image_text_{lang}", "")
        if value:
            block[key] = str(value).strip()


def prepare_figures(root, blocks: list[dict], total_pages: int) -> None:
    """在合並鎖裡、最後一次 id 去重之後調用：有 box 的圖塊重新截圖。
    截不了（頁碼不對、框无效、截圖失敗）就清掉 src 和 box，留給原頁入口和 fill_later。沒 box 的塊不動。"""
    for block in blocks:
        if block.get("type") != "figure" or not block.get("box"):
            continue
        block["src"] = ""
        page, box = block.get("page"), figure_box(block["box"])
        if not box or not isinstance(page, int) or not 1 <= page <= total_pages:
            block.pop("box", None)
            continue
        try:
            block["src"] = crop(root, page, box)
        except Exception:  # noqa: BLE001
            block.pop("box", None)
            log.exception("截圖失敗 %s 第 %s 頁", block.get("id"), page)


def _pending(ws):
    """沒有截圖或自動裁剪范围已變化的圖塊；保留顯式 box 和自定義 src。"""
    layout = ws.load("layout") or {}
    out = []
    for b in (ws.load("paper") or {}).get("blocks", []):
        src = b.get("src", "")
        if b.get("type") != "figure" or src and (b.get("box") or not src.startswith("figures/crop-")):
            continue
        loc = layout.get(b.get("id")) or {}
        box = figure_box(loc.get("box"))
        page = loc.get("page")
        if not box or not isinstance(page, int) or page < 1:
            continue
        x0, y0, x1, y1 = box
        if x1 - x0 < 0.05 or y1 - y0 < 0.03:  # 只匹配到一行題注、沒撑開的框截出來沒用
            continue
        if src:
            try:
                if src == _crop_path(ws.root, page, box) and (ws.root / src).is_file():
                    continue
            except OSError:
                continue  # PDF 不在時保留已经存在的截圖。
        out.append((b, page, box))
    return out


def missing(ws) -> list[tuple[str, int, list[float]]]:
    """需要補截或更新自動截圖的圖塊：[(塊 id, 頁碼, 框)]。"""
    return [(b["id"], page, box) for b, page, box in _pending(ws)]


def fill(ws) -> int:
    """補截或更新自動截圖；寫回時保留截圖期間發生的編辑和重譯。"""
    done = {}
    for block, page, box in _pending(ws):
        try:
            done[block["id"]] = (block, crop(ws.root, page, box))
        except Exception:  # noqa: BLE001
            log.exception("截圖失敗 %s %s", ws.root, block["id"])
    if done:
        def apply(paper):
            count = 0
            for b in paper.get("blocks", []):
                previous, src = done.get(b.get("id"), (None, None))
                if b == previous:
                    b["src"] = src
                    count += 1
            return count
        return ws.update("paper", apply)
    return 0


def fill_later(ws, gate=None) -> None:
    """打開閱讀頁時在後臺補；補完 paper.json 變了，頁面轮詢到就會重畫。"""
    key = str(ws.root)
    if key in _running or not missing(ws):
        return
    if gate:
        gate.begin()
    _running.add(key)

    def run():
        try:
            fill(ws)
        finally:
            _running.discard(key)
            if gate:
                gate.end()
    threading.Thread(target=run, daemon=True).start()
