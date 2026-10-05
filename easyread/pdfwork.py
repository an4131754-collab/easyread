"""PDF 相關的機械活：渲染原頁、抽文字和字元座標、裁圖、給譯文段落定位原頁區域。

這裡不做任何翻譯，也不呼叫模型。
"""
from __future__ import annotations

import json
import re
import threading
import unicodedata
from contextlib import closing, contextmanager
from functools import lru_cache
from pathlib import Path
from statistics import median

from . import float_order
from .store import Workspace, write_json_atomic

# PDFium is not thread-safe, even when threads open separate documents.
# Keep native handles and their cleanup inside the same process-wide lock.
_PDFIUM_LOCK = threading.RLock()
_LAYOUT_LOCK = threading.RLock()


@contextmanager
def open_pdf(pdf: Path):
    """所有 PDFium 呼叫與資源釋放共用一把鎖，包括操作不同檔案的執行緒。"""
    import pypdfium2 as pdfium
    with _PDFIUM_LOCK, closing(pdfium.PdfDocument(str(pdf))) as doc:
        yield doc


def render_pages(pdf: Path, out_dir: Path, scale: float = 2.4, quality: int = 84) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    with open_pdf(pdf) as doc:
        for i in range(len(doc)):
            with closing(doc[i]) as page, closing(page.render(scale=scale)) as bitmap:
                w, h = page.get_size()
                with bitmap.to_pil() as raw, raw.convert("RGB") as img:
                    name = f"page-{i + 1:03d}.webp"
                    img.save(out_dir / name, "WEBP", quality=quality, method=5)
                pages.append({"n": i + 1, "w": round(w, 2), "h": round(h, 2), "img": f"pages/{name}"})
    return pages


def extract_text(pdf: Path, out_dir: Path) -> int:
    """每頁一份 .txt（給 agent 讀）和 .chars.json（給定位用，座標按頁寬高歸一化）。"""
    from pypdfium2 import raw as pdfium_c

    out_dir.mkdir(parents=True, exist_ok=True)
    with open_pdf(pdf) as doc:
        for i in range(len(doc)):
            with closing(doc[i]) as page, closing(page.get_textpage()) as tp:
                # A tiled PDF can reference the entire source document on every
                # page. Unbounded text includes the off-page content; pdfplumber
                # also builds and retains a full Python layout for every tile.
                # Use one native text page for both outputs and close it eagerly.
                text = tp.get_text_bounded()
                bounds, rotation = page.get_bbox(), page.get_rotation()
                chars = []
                count = tp.count_chars()
                for index in range(count):
                    box = _char_box(tp.get_charbox(index, loose=True), bounds, rotation)
                    if box is None:
                        continue
                    # Indexing get_text_range() is unsafe: its string indices can
                    # differ from PDFium's character indices (generated newlines,
                    # unmapped glyphs, and non-BMP Unicode characters).
                    code = pdfium_c.FPDFText_GetUnicode(tp, index)
                    if 0xD800 <= code <= 0xDBFF and index + 1 < count:
                        low = pdfium_c.FPDFText_GetUnicode(tp, index + 1)
                        if 0xDC00 <= low <= 0xDFFF:
                            code = 0x10000 + ((code - 0xD800) << 10) + low - 0xDC00
                    if not code or code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
                        continue
                    char = chr(code)
                    if char in "\r\n":
                        continue
                    chars.append([char, *box])
                (out_dir / f"page-{i + 1:03d}.txt").write_text(text, encoding="utf-8")
                (out_dir / f"page-{i + 1:03d}.chars.json").write_text(json.dumps(chars, ensure_ascii=False), encoding="utf-8")
        return len(doc)


def _char_box(box, bounds, rotation: int) -> list[float] | None:
    """PDF canvas -> rendered page, respecting CropBox origin and page rotation."""
    l, b, r, t = box
    L, B, R, T = bounds
    if r <= L or l >= R or t <= B or b >= T:
        return None
    x0, y0 = (max(l, L) - L) / (R - L), (T - min(t, T)) / (T - B)
    x1, y1 = (min(r, R) - L) / (R - L), (T - max(b, B)) / (T - B)
    if rotation == 90:
        x0, y0, x1, y1 = 1 - y1, x0, 1 - y0, x1
    elif rotation == 180:
        x0, y0, x1, y1 = 1 - x1, 1 - y1, 1 - x0, 1 - y0
    elif rotation == 270:
        x0, y0, x1, y1 = y0, 1 - x1, y1, 1 - x0
    return [round(v, 4) for v in (x0, y0, x1, y1)]


def crop(root: Path, page: int, box: list[float], out_name: str, scale: float = 3.0) -> str:
    """box 是按頁寬高歸一化的 [x0, y0, x1, y1]；輸出到 figures/，返回相對路徑。"""
    with open_pdf(root / "source.pdf") as doc:
        with closing(doc[page - 1]) as pdf_page, closing(pdf_page.render(scale=scale)) as bitmap:
            with bitmap.to_pil() as raw, raw.convert("RGB") as img:
                W, H = img.size
                x0, y0, x1, y1 = box
                with img.crop((int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))) as part:
                    (root / "figures").mkdir(exist_ok=True)
                    rel = f"figures/{out_name}.webp"
                    part.save(root / rel, "WEBP", quality=90)
    return rel


# ---------- 定位：譯文段落 -> 原頁区域 ----------

_MATH = re.compile(r"\$[^$]*\$")
_ALNUM = re.compile(r"[a-z0-9]")
LOCATE_VERSION = "7"  # 圖表按原頁位置重排；舊論文打開時重算一次。


def _norm(s: str) -> str:
    return "".join(_ALNUM.findall(unicodedata.normalize("NFKC", s).lower()))


def _page_stream(extract_dir: Path, n: int):
    path = extract_dir / f"page-{n:03d}.chars.json"
    if not path.exists():
        return None
    chars = json.loads(path.read_text(encoding="utf-8"))
    text, idx = [], []
    for k, c in enumerate(chars):
        for t in _norm(c[0]):  # 連字 ﬁ/ﬂ 會展開成兩個字母，指向同一個字符框
            text.append(t)
            idx.append(k)
    return "".join(text), idx, chars


def _anchors(en: str) -> tuple[str, str]:
    plain_parts = [p for p in _MATH.split(en) if _norm(p)]
    if not plain_parts:
        return "", ""
    head = _norm(plain_parts[0])[:28]
    tail = _norm(plain_parts[-1])[-28:]
    return head, tail


def _box(chars, idx, a: int, b: int):
    sel = [chars[idx[k]] for k in range(a, min(b, len(idx) - 1) + 1)]
    return [min(c[1] for c in sel), min(c[2] for c in sel), max(c[3] for c in sel), max(c[4] for c in sel)]


def _bounds(boxes: list[list[float]]) -> list[float]:
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def _boxes(chars, idx, a: int, b: int) -> list[list[float]]:
    """保留欄間空白：橫向不相連的字元分組各有一個框，而不是取整段的外接框。"""
    selected = [chars[i][1:5] for i in set(idx[a:min(b + 1, len(idx))])]
    selected = [box for box in selected if box[2] > box[0] and box[3] > box[1]]
    if not selected:
        return [_box(chars, idx, a, b)]
    gap = max(0.008, median(box[2] - box[0] for box in selected) * 2.5)
    boxes = []
    for box in sorted(selected, key=lambda box: box[0]):
        if not boxes or box[0] > boxes[-1][2] + gap:
            boxes.append(list(box))
        else:
            boxes[-1] = _bounds([boxes[-1], box])
    return boxes


def block_english(block: dict) -> str:
    if block.get("type") == "list":
        return " ".join(it.get("en", "") for it in block.get("items", []))
    if block.get("type") in ("table", "figure"):
        return block.get("caption_en", "")
    return block.get("en", "")


def locate(root: Path) -> dict:
    with _LAYOUT_LOCK:
        return _locate(root)


def _locate(root: Path) -> dict:
    paper = json.loads((root / "paper.json").read_text(encoding="utf-8"))
    extract_dir = root / "extract"
    # Blocks may arrive out of page order during parallel translation. Keep only
    # the current/next page streams instead of retaining a whole book's chars.
    @lru_cache(maxsize=2)
    def stream(n):
        return _page_stream(extract_dir, n)

    layout: dict[str, dict] = {}
    cursor: dict[int, int] = {}
    for block in paper.get("blocks", []):
        bid, page = block.get("id"), block.get("page")
        if not bid or not page:
            continue
        if block.get("box"):
            layout[bid] = {"page": page, "box": block["box"], "src": "manual"}
            continue
        head, tail = _anchors(block_english(block))
        if not head:
            continue
        heads = [head]
        if block.get("type") == "heading" and block.get("num"):
            heads.insert(0, _anchors(f"{block['num']} {block.get('en', '')}")[0])
        for pn in (page, page + 1):
            st = stream(pn)
            if not st:
                continue
            text, idx, chars = st
            a = -1
            for h in heads:
                a = text.find(h, cursor.get(pn, 0) if pn == page else 0)
                if a < 0:
                    a = text.find(h)
                if a >= 0:
                    break
            if a < 0:
                continue
            b = text.find(tail, a) if tail else -1
            end = b + len(tail) - 1 if b >= 0 else min(a + len(_norm(block_english(block))), len(idx) - 1)
            boxes = _boxes(chars, idx, a, end)
            layout[bid] = {"page": pn, "box": _bounds(boxes), "src": "text" if b >= 0 else "head"}
            if len(boxes) > 1:
                layout[bid]["boxes"] = boxes
            cursor[pn] = end
            break
    _extend_captioned(paper.get("blocks", []), layout, root)
    _clamp_overlaps(layout)
    ids = float_order.order(paper.get("blocks", []), layout)
    if ids:  # 圖表挪回原頁位置；公式的估算框按塊順序算，要在這之後
        paper = Workspace(root).update("paper", lambda p: (float_order.apply(p, ids), p)[1])
    _fill_gaps(paper.get("blocks", []), layout)
    write_json_atomic(root / "layout.json", layout)
    (extract_dir / "locate.version").write_text(LOCATE_VERSION, encoding="utf-8")
    return layout


def refresh_layout(root: Path) -> None:
    """沿用上游的版本標記；併發開啟同一篇論文時只重算一次。"""
    with _LAYOUT_LOCK:
        marker = root / "extract" / "locate.version"
        if not (root / "layout.json").exists() or not (root / "paper.json").exists():
            return
        if not any((root / "extract").glob("page-*.chars.json")):
            return
        if marker.exists() and marker.read_text(encoding="utf-8").strip() == LOCATE_VERSION:
            return
        locate(root)


def _overlap_x(a: list, x0: float, x1: float) -> bool:
    return max(a[0], x0) < min(a[2], x1) - 0.01


def _column(locs: list[dict], box: list) -> tuple[float, float] | None:
    """雙欄頁上 box 所在那一欄的左右邊界；單欄頁或 box 本身橫跨兩欄時返回 None。"""
    left = [l["box"] for l in locs if l["box"][2] <= 0.55]
    right = [l["box"] for l in locs if l["box"][0] >= 0.45]
    if len(left) < 2 or len(right) < 2 or box[2] - box[0] > 0.5:
        return None
    col = right if (box[0] + box[2]) / 2 >= 0.5 else left
    return min(b[0] for b in col), max(b[2] for b in col)


def _page_locs(layout: dict, page: int) -> list[dict]:
    return [{"page": page, "box": box, "src": loc["src"], "_parent": loc}
            for loc in layout.values() if loc["page"] == page
            for box in loc.get("boxes") or [loc["box"]]]


def _extend_captioned(blocks: list[dict], layout: dict, root: Path | None = None):
    """圖优先用 PDF 圖形邊界；表格或无法识別的圖按題注所在欄估算。"""
    from .figure_geometry import locate_figures
    visual = locate_figures(root, blocks, layout) if root else {}
    for block in blocks:
        loc = layout.get(block.get("id"))
        if block.get("type") not in ("table", "figure") or not loc or block.get("box") or loc.get("src") == "manual":
            continue
        if block["id"] in visual:
            loc["box"] = visual[block["id"]]
            loc.pop("boxes", None)
            loc["src"] = "graphic"
            continue
        x0, y0, x1, y1 = loc["box"]
        others = [l for l in _page_locs(layout, loc["page"]) if l["_parent"] is not loc]
        col = _column(others, loc["box"])
        if col:
            x0, x1 = col
        elif x1 - x0 < 0.45 and abs((x0 + x1) / 2 - 0.5) > 0.1:  # 窄題注偏在一側：正文绕排的小表/小圖
            x0, x1 = max(0.05, x0 - 0.02), min(0.95, x1 + 0.02)
        else:
            x0, x1 = min(x0, 0.15), max(x1, 0.85)
        same_col = [l["box"] for l in others if _overlap_x(l["box"], x0, x1)]
        if block.get("caption_pos", "below") == "below":
            above = [b[3] for b in same_col if b[3] < y0]
            y0 = max(above) + 0.005 if above else 0.08
        else:
            below = [b[1] for b in same_col if b[1] > y1]
            y1 = min(below) - 0.005 if below else 0.92
        loc["box"] = [x0, round(y0, 4), x1, round(y1, 4)]
        loc.pop("boxes", None)  # 圖表框要包含圖像本身，按題注扩展後用整個区域。
        loc["src"] = "caption"  # 撑過的框旁邊常有绕排正文，後面截重叠時不能再截它


def _clamp_overlaps(layout: dict):
    """只匹配到開頭的塊按長度估了結尾，可能壓到同一欄的下一塊；截到它的上沿。"""
    by_page = {page: _page_locs(layout, page) for page in {loc["page"] for loc in layout.values()}}
    for locs in by_page.values():
        locs.sort(key=lambda l: l["box"][1])
        for i, cur in enumerate(locs):
            if cur["src"] not in ("head", "text"):
                continue
            nxt = next((l for l in locs[i + 1:] if l["_parent"] is not cur["_parent"]
                        and _overlap_x(l["box"], cur["box"][0], cur["box"][2])
                        and l["box"][1] > cur["box"][1]), None)
            if nxt and cur["box"][3] > nxt["box"][1]:
                cur["box"][3] = round(nxt["box"][1] - 0.002, 4)
    for loc in layout.values():
        if loc.get("boxes"):
            loc["box"] = _bounds(loc["boxes"])


def _fill_gaps(blocks: list[dict], layout: dict):
    """公式這類沒有英文可匹配的塊：放在同一欄裡下一塊之上、上方最近一塊之下。"""
    for i, block in enumerate(blocks):
        bid = block.get("id")
        if not bid or bid in layout or not block.get("page"):
            continue
        page = block["page"]
        locs = _page_locs(layout, page)
        prev = next((layout[b["id"]] for b in reversed(blocks[:i]) if layout.get(b.get("id"), {}).get("page") == page), None)
        nxt = next((layout[b["id"]] for b in blocks[i + 1:] if layout.get(b.get("id"), {}).get("page") == page), None)
        if prev and prev.get("boxes"):
            prev = {**prev, "box": prev["boxes"][-1]}
        if nxt and nxt.get("boxes"):
            nxt = {**nxt, "box": nxt["boxes"][0]}
        ref = prev or nxt
        col = _column(locs, ref["box"]) if ref else None
        x0, x1 = col if col else (0.12, 0.88)
        if nxt and not _overlap_x(nxt["box"], x0, x1):
            nxt = None  # 下一塊在另一欄，不能拿它當下沿
        bottom = nxt["box"][1] if nxt else 0.92
        above = [l["box"][3] for l in locs if _overlap_x(l["box"], x0, x1) and l["box"][3] <= bottom + 0.001]
        top = max(above) if above else 0.08
        if bottom - top < 0.01:
            bottom = top + 0.04
        layout[bid] = {"page": page, "box": [x0, round(top, 4), x1, round(bottom, 4)], "src": "between"}


def engine_image(root: Path, n: int) -> Path:
    """給翻譯模型看的原頁圖（JPEG，模型工具普遍支援），按需生成。"""
    out = root / "extract" / f"page-{n:03d}.jpg"
    with _PDFIUM_LOCK:
        if not out.exists():
            out.parent.mkdir(parents=True, exist_ok=True)
            with open_pdf(root / "source.pdf") as doc:
                with closing(doc[n - 1]) as page, closing(page.render(scale=2.0)) as bitmap:
                    with bitmap.to_pil() as raw, raw.convert("RGB") as img:
                        img.save(out, "JPEG", quality=82)
    return out


def page_variant(root: Path, rel: str, width: int) -> Path | None:
    """原頁圖的縮小版（原圖 2.4 倍渲染、約 1500 畫素寬，右側面板用不著那麼大）。生成一次快取在 pages/w{寬}/。"""
    width = max(400, min(2000, width // 100 * 100))
    src = (root / rel).resolve()
    if not src.is_relative_to((root / "pages").resolve()) or not src.is_file():
        return None
    out = root / "pages" / f"w{width}" / src.name
    if not out.exists():
        from PIL import Image
        out.parent.mkdir(exist_ok=True)
        with Image.open(src) as im:
            if im.width <= width:
                return src
            im.resize((width, round(im.height * width / im.width)), Image.LANCZOS).save(out, "WEBP", quality=80, method=4)
    return out


PANEL_WIDTH = 1000  # 原頁面板預設要的宽度（閱讀頁按面板宽度只會要 1000 或 1600）


def warm_variants(root: Path, width: int = PANEL_WIDTH) -> None:
    """背景把整篇的面板圖都先生成好，開啟原頁面板時不用等。"""
    pages_dir = root / "pages"
    if not pages_dir.exists():
        return
    for src in sorted(pages_dir.glob("page-*.webp")):
        if not (root / "pages" / f"w{width}" / src.name).exists():
            page_variant(root, f"pages/{src.name}", width)


def prepare(root: Path) -> list[dict]:
    """渲染原頁 + 抽文字，返回 meta.pages。"""
    pages = render_pages(root / "source.pdf", root / "pages")
    extract_text(root / "source.pdf", root / "extract")
    return pages
