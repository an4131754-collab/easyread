"""圖和表按原頁位置摆放：模型常把圖表挪到“第一次提到它的段落”後面，甚至挪過一個小節，
和右邊跟随的原頁對不上。定位算出每塊在原頁的框以後，把圖表插回原頁上它所在的位置。

只動圖表，正文之間的順序照模型給的不變。沒定位到的圖表留在原處。
"""
from __future__ import annotations

FLOATS = ("table", "figure")
# 拿來比位置的塊：按英文或圖形邊界在原頁找到的。“between” 是按塊順序估出來的，不能反過來决定順序
_ANCHORED = ("text", "head", "graphic", "caption", "manual")


def _overlap_x(a: list, x0: float, x1: float) -> bool:
    return max(a[0], x0) < min(a[2], x1) - 0.01


def _after(loc: dict, page: int, box: list) -> bool:
    """這塊是否排在圖表 (page, box) 後面：頁更靠後，或同一頁、同一欄、上沿不比圖表高。"""
    if loc["page"] != page:
        return loc["page"] > page
    if loc.get("src") not in _ANCHORED:
        return False
    top = (loc.get("boxes") or [loc["box"]])[0]
    wide = box[2] - box[0] > 0.5  # 横跨兩欄的圖表：任何一欄裡在它下面的塊都算後面
    return top[1] >= box[1] - 0.005 and (wide or _overlap_x(top, box[0], box[2]))


def _before_unplaced(rest: list[dict], pos: int, loc: dict, layout: dict) -> int:
    """pos 前面紧挨著一串同頁、還沒定位的塊（公式沒有英文可匹配）時，看它們在圖表上面還是下面：
    比较圖表上方和下方各剩多少空當，下方空當大就把圖表插到這串塊前面。"""
    page, box = loc["page"], loc["box"]
    start = pos
    while start > 0 and rest[start - 1].get("id") not in layout and rest[start - 1].get("page") == page:
        start -= 1
    if start == pos:
        return pos
    prev = layout.get(rest[start - 1].get("id")) if start else None
    top = prev["box"][3] if prev and prev["page"] == page else 0.08
    nxt = layout.get(rest[pos].get("id")) if pos < len(rest) else None
    bottom = nxt["box"][1] if nxt and nxt["page"] == page else 0.92
    return start if bottom - box[3] > box[1] - top else pos


def order(blocks: list[dict], layout: dict) -> list[str] | None:
    """返回按原頁位置排好的塊 id 順序；不用動時返回 None。"""
    moving = [b for b in blocks if b.get("type") in FLOATS and b.get("id") in layout]
    if not moving:
        return None
    moving_ids = {b["id"] for b in moving}
    rest = [b for b in blocks if b.get("id") not in moving_ids]
    for f in moving:
        loc = layout[f["id"]]
        pos = len(rest)
        for i, b in enumerate(rest):
            other = layout.get(b.get("id"))
            if other is None:
                if (b.get("page") or 0) > loc["page"]:  # 沒定位的塊只看頁碼
                    pos = i
                    break
                continue
            if _after(other, loc["page"], loc["box"]):
                pos = i
                break
        rest.insert(_before_unplaced(rest, pos, loc, layout), f)
    ids = [b.get("id") for b in rest]
    return None if ids == [b.get("id") for b in blocks] else ids


def apply(paper: dict, ids: list[str]) -> None:
    """按 ids 重排 paper 裡的塊。重讀到的 paper 可能多了或少了塊：只重排兩邊都有的，其餘原樣留著。"""
    blocks = paper.get("blocks", [])
    rank = {bid: i for i, bid in enumerate(ids)}
    known = sorted((b for b in blocks if b.get("id") in rank), key=lambda b: rank[b["id"]])
    it = iter(known)
    paper["blocks"] = [next(it) if b.get("id") in rank else b for b in blocks]
