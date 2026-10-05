"""按原頁渲染結果確認圖形真的畫在頁面上。

PDF 裡的白色背景矩形、被裁剪路径挡住的內容、嵌入圖片自帶的白邊，在對象坐標裡都有范围，
但頁面上看不見；只按對象坐標取范围會把圖框撑到正文或頁眉。這裡把每個候選框收到看得見的像素上。
"""
from __future__ import annotations

import math
from contextlib import closing
from pathlib import Path

SCALE = 2
_WHITE = 245  # 三個通道都不低於這個值就算頁面底色


def visible_mask(pdf: Path, page_index: int, erase: list[list[float]]):
    """渲染一頁，返回兩張“非底色”像素的黑白圖（255 為有內容）：(圖形, 全部)。
    圖形那張抹掉 erase 裡的框（PDF 文字、頁眉分隔線）：文字由題注、標籤那套规則單獨處理，
    不能讓正文或頁眉線把圖形范围撑開。全部那張用來確認文字本身看得見（被裁掉的文字不算標籤）。"""
    from PIL import ImageChops, ImageDraw, ImageFilter

    from .pdfwork import open_pdf
    with open_pdf(pdf) as doc, closing(doc[page_index]) as page, closing(page.render(scale=SCALE)) as bitmap:
        with bitmap.to_pil() as raw, raw.convert("RGB") as rgb:
            r, g, b = rgb.split()
    darkest = ImageChops.darker(ImageChops.darker(r, g), b)
    ink = darkest.point(lambda v: 255 if v < _WHITE else 0)
    mask = ink.copy()
    width, height = mask.size
    draw = ImageDraw.Draw(mask)
    for x0, y0, x1, y1 in erase:
        draw.rectangle([x0 * width - 1, y0 * height - 1, x1 * width + 1, y1 * height + 1], fill=0)
    # 去掉文字抗锯齿留下的孤立噪點；1 像素宽的細線在 3x3 鄰域裡有 3 個點，會保留。
    return mask.filter(ImageFilter.BoxBlur(1)).point(lambda v: 255 if v >= 70 else 0), ink


def trim(mask, box: list[float]) -> list[float] | None:
    """把框收到框內可見像素的范围；整塊都是底色時返回 None。"""
    width, height = mask.size
    left, top = int(box[0] * width), int(box[1] * height)
    right = max(left + 1, math.ceil(box[2] * width))
    bottom = max(top + 1, math.ceil(box[3] * height))
    found = mask.crop((left, top, right, bottom)).getbbox()
    if not found:
        return None
    return [max(box[0], (left + found[0] - 1) / width), max(box[1], (top + found[1] - 1) / height),
            min(box[2], (left + found[2] + 1) / width), min(box[3], (top + found[3] + 1) / height)]


def inked(ink, box: list[float]) -> bool:
    """文字框裡真的有字：可見像素横向铺滿一半以上（只是邊上压到別的字不算）。"""
    found = trim(ink, box)
    return bool(found) and found[2] - found[0] >= (box[2] - box[0]) * .5
