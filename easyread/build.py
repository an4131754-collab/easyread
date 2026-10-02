"""把閱讀頁和一篇論文打成單個 HTML：離線開啟、發給別人看。

單檔案裡的修改存在瀏覽器；在頁面“說明”裡匯出後，用 `easyread merge ID --from 匯出.json` 並回文獻庫。
"""
from __future__ import annotations

import base64
import html as htmllib
import json
import re
from pathlib import Path

from .config import WEB
from .store import Workspace

_LINK = re.compile(r'<link rel="stylesheet" href="/web/([^"]+)"\s*/?>')
_SCRIPT = re.compile(r'<script src="/web/([^"]+)"></script>')


def _data_uri(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def _inline_css(rel: str) -> str:
    path = WEB / rel
    css = path.read_text(encoding="utf-8")
    if "katex" in rel:  # 字型轉成 data URI，離線也能顯示公式
        css = re.sub(r"url\((fonts/[^)]+\.woff2)\)", lambda m: f"url({_data_uri(path.parent / m.group(1), 'font/woff2')})", css)
        css = re.sub(r",\s*url\(fonts/[^)]+\.(woff|ttf)\) format\(\"(woff|truetype)\"\)", "", css)
    return f"<style>{css}</style>"


def _script(rel: str) -> str:
    js = (WEB / rel).read_text(encoding="utf-8").replace("</script", "<\\/script")
    return f"<script>{js}</script>"


def build(ws: Workspace, out: Path | None = None, assets: Path | None = None, extra: dict | None = None) -> Path:
    """assets：圖片不內嵌、另存到這個目錄（放到網站上時頁面小很多，圖按需載入）；extra：額外寫進頁面資料的內容。"""
    page = (WEB / "reader.html").read_text(encoding="utf-8")
    page = _LINK.sub(lambda m: _inline_css(m.group(1)), page)
    page = _SCRIPT.sub(lambda m: _script(m.group(1)), page)
    page = page.replace('<link rel="icon" href="/web/favicon.svg">', f'<link rel="icon" href="{_data_uri(WEB / "favicon.svg", "image/svg+xml")}">')
    paper = ws.load("paper")
    images = {}
    rels = [p["img"] for p in paper.get("meta", {}).get("pages", [])] + [b["src"] for b in paper.get("blocks", []) if b.get("src")]
    for rel in rels:
        src = ws.root / rel
        if not src.exists():
            continue
        if assets:
            dst = assets / rel.replace("/", "-")
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(src.read_bytes())
            images[rel] = f"{assets.name}/{dst.name}"
        else:
            images[rel] = _data_uri(src, "image/webp")
    data = {n: ws.load(n) for n in ("discussion", "reader", "layout", "item")}
    data.update({"paper": paper, "images": images}, **(extra or {}))
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    page = page.replace("<!--PR:DATA-->", f'<script id="pr-data" type="application/json">{payload}</script>')
    title = paper.get("meta", {}).get("title_zh") or paper.get("meta", {}).get("title_en") or "論文"
    page = re.sub(r"<title>.*?</title>", f"<title>{htmllib.escape(title)}</title>", page, count=1)
    stem = re.sub(r'[\\/:*?"<>|]', "", paper.get("meta", {}).get("short_zh") or ws.id)
    out = out or ws.root / f"{stem}-離線版.html"
    out.write_text(page, encoding="utf-8")
    return out
