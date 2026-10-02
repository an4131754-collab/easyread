"""翻譯方對 paper.json / discussion.json 的寫入：併入譯文塊、追加討論。都在鎖內完成。"""
from __future__ import annotations

import hashlib
import json

from .store import Workspace, now_iso

BLOCK_TYPES = {"heading", "para", "list", "math", "table", "figure", "references", "note"}
DISCUSSION_KINDS = {"explain", "qa", "insight", "reply", "check"}


def parse_pages(spec) -> list[int]:
    if isinstance(spec, list):
        return [int(x) for x in spec]
    out = []
    for part in str(spec or "").split(","):
        if "-" in part:
            a, b = part.split("-")
            out += list(range(int(a), int(b) + 1))
        elif part.strip():
            out.append(int(part))
    return out


def merge_blocks(ws: Workspace, data: dict, done=None, replace_pages=None, en_only: bool = False) -> dict:
    """併入一批塊。同 id 整塊替換；新塊按 _after 或頁碼順序插入。
    replace_pages：先刪掉這些頁上已有的塊（重新翻譯某幾頁時用）。
    en_only：這批是“只讀原文”整理出來的、只有英文的塊，done 的頁記進 translation.en_pages；否則從 en_pages 裡去掉。"""
    if isinstance(data, list):
        data = {"blocks": data}
    for b in data.get("blocks", []):
        if not b.get("id") or b.get("type") not in BLOCK_TYPES:
            raise ValueError(f"塊缺 id 或型別不對：{str(b)[:120]}")

    def apply(paper):
        blocks = paper.setdefault("blocks", [])
        if replace_pages:
            drop = set(replace_pages)
            blocks[:] = [b for b in blocks if b.get("page") not in drop]
        n_new = n_upd = 0
        last = None  # 同一批的新塊保持給定順序，接在上一個新塊後面
        for b in data.get("blocks", []):
            b = dict(b)
            after = b.pop("_after", None)
            index = {x["id"]: i for i, x in enumerate(blocks)}
            if b["id"] in index:
                blocks[index[b["id"]]] = b
                n_upd += 1
                continue
            if after in index:
                pos = index[after] + 1
            elif last is not None:
                pos = index[last] + 1
            else:  # 這批第一個新塊按頁碼放：插在第一個頁碼更大的塊之前
                pos = next((i for i, x in enumerate(blocks) if (x.get("page") or 0) > (b.get("page") or 0)), len(blocks))
            blocks.insert(pos, b)
            last = b["id"]
            n_new += 1
        for key, ident in (("glossary", "en"), ("references", "id")):
            if data.get(key):
                have = {str(x.get(ident)) for x in paper.get(key, [])}
                paper[key] = paper.get(key, []) + [x for x in data[key] if str(x.get(ident)) not in have]
        if data.get("meta"):
            meta = paper.setdefault("meta", {})
            for k, v in data["meta"].items():
                if v and k not in ("pages", "source_sha256", "pdf", "page_count"):
                    meta[k] = v
        tr = paper.setdefault("translation", {})
        if data.get("translation"):
            tr.update(data["translation"])
        if done:
            pages = set(parse_pages(done))
            tr["done_pages"] = sorted(set(tr.get("done_pages", [])) | pages)
            en = set(tr.get("en_pages", []))
            tr["en_pages"] = sorted(en | pages if en_only else en - pages)
            _scope(paper)
        return {"new": n_new, "updated": n_upd, "done_pages": tr.get("done_pages", [])}

    return ws.update("paper", apply)


def _scope(paper: dict) -> None:
    tr = paper.setdefault("translation", {})
    total = paper.get("meta", {}).get("page_count") or 0
    n = len(set(tr.get("done_pages", [])) - set(tr.get("en_pages", [])))
    tr["scope"] = "全文" if total and n >= total else f"已譯 {n} / {total} 頁"


def fill_zh(ws: Workspace, data: dict, pages: list[int], keys: set[str]) -> list[str]:
    """給只讀原文整理出來的塊就地補譯文（塊 id 不變，筆記還掛得住）。
    data 是模型的輸出 {"zh": {鍵: 譯文}, "meta", "glossary"}；keys 是這次要譯的鍵。
    返回漏譯的鍵；這幾頁的鍵都譯齊了，才把頁從 en_pages 去掉。"""
    got = {k: v for k, v in (data.get("zh") or {}).items() if k in keys and v}

    def apply(paper):
        by_id = {b.get("id"): b for b in paper.get("blocks", [])}
        for key, zh in got.items():
            bid, _, field = key.partition("#")
            b = by_id.get(bid)
            if not b:
                continue
            if field == "caption":
                b["caption_zh"] = str(zh)
            elif field == "head":
                if isinstance(zh, list) and len(zh) == len(b.get("head", [])):
                    b["head"] = zh
            elif field.isdigit() and int(field) < len(b.get("items", [])):
                b["items"][int(field)]["zh"] = str(zh)
            else:
                b["zh"] = str(zh)
        meta = paper.setdefault("meta", {})
        for k in ("title_zh", "short_zh"):
            if (data.get("meta") or {}).get(k):
                meta[k] = data["meta"][k]
        if data.get("glossary"):
            have = {str(x.get("en")) for x in paper.get("glossary", [])}
            paper["glossary"] = paper.get("glossary", []) + [x for x in data["glossary"] if isinstance(x, dict) and str(x.get("en")) not in have]
        missing = [k for k in keys if k not in got and not k.endswith("#head")]  # 表頭沒譯不算漏
        left = {by_id[k.partition("#")[0]].get("page") for k in missing if k.partition("#")[0] in by_id}
        tr = paper.setdefault("translation", {})
        tr["en_pages"] = sorted(set(tr.get("en_pages", [])) - (set(pages) - left))
        _scope(paper)
        return missing

    return ws.update("paper", apply)


def add_discussion(ws: Workspace, items) -> tuple[int, int]:
    items = items if isinstance(items, list) else [items]
    paper = ws.load("paper")
    block_ids = {b.get("id") for b in paper.get("blocks", [])}
    notes = ws.load("reader").get("notes", {})
    for it in items:
        if it.get("kind", "explain") not in DISCUSSION_KINDS:
            raise ValueError(f"kind 只能是 {sorted(DISCUSSION_KINDS)}")
        if it.get("anchor") and it["anchor"] not in block_ids:
            raise ValueError(f"錨點塊不存在：{it['anchor']}")
        if it.get("reply_to") and it["reply_to"] not in notes:
            raise ValueError(f"要回復的使用者筆記不存在：{it['reply_to']}")
        if not (it.get("body") or "").strip():
            raise ValueError("body 不能為空")

    def merge(disc):
        entries = disc.setdefault("entries", [])
        by_id = {e["id"]: e for e in entries}
        stamp = now_iso()
        n_new = n_upd = 0
        for k, it in enumerate(items):
            it = dict(it)
            it.setdefault("kind", "explain")
            if it.get("id") in by_id:
                by_id[it["id"]].update(it)
                by_id[it["id"]]["updated"] = stamp
                n_upd += 1
            else:
                it.setdefault("id", f"d{len(entries) + 1:03d}-{hashlib.md5((stamp + str(k)).encode()).hexdigest()[:5]}")
                it["at"] = stamp
                entries.append(it)
                n_new += 1
        return n_new, n_upd

    return ws.update("discussion", merge)


def delete_discussion(ws: Workspace, did: str) -> int:
    def drop(disc):
        before = len(disc["entries"])
        disc["entries"] = [e for e in disc["entries"] if e.get("id") != did]
        return before - len(disc["entries"])
    return ws.update("discussion", drop)


def set_block_text(ws: Workspace, key: str, zh: str) -> None:
    """重譯一段後寫回譯者稿。key 同頁面：塊 id、id#caption、id#序號。"""
    bid, _, field = key.partition("#")

    def apply(paper):
        for b in paper.get("blocks", []):
            if b.get("id") != bid:
                continue
            if field == "caption":
                b["caption_zh"] = zh
            elif field.isdigit():
                b["items"][int(field)]["zh"] = zh
            else:
                b["zh"] = zh
            return
        raise KeyError(key)
    ws.update("paper", apply)


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=1)
