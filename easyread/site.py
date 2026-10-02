"""把一篇讀好的論文做成網站上的線上演示（GitHub Pages 這類靜態託管）。

和“匯出離線 HTML”一樣是單頁，區別是：圖片另存成檔案、按需載入；帶上問 AI 的對話記錄（只能看）；
頂欄有“線上演示”標記和回主頁、去 GitHub 的連結。讀者在演示裡做的劃線和筆記只存在他自己的瀏覽器。

    easyread demo <論文 id> --out docs/demo
"""
from __future__ import annotations

from pathlib import Path

from . import chat_store
from .build import build
from .store import Workspace

REPO = "https://github.com/Edwardxlai/easyread"


def build_demo(ws: Workspace, out_dir: Path, name: str = "index.html", credit: str = "") -> Path:
    """credit：署名和許可（比如 CC BY 4.0 要求寫明作者、出處、許可，並說明是譯文），顯示在論文標題下面。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    reader = ws.load("reader")
    reader.pop("progress", None)  # 別讓看演示的人從我讀到的地方開始
    extra = {"reader": reader, "chat": {"threads": chat_store.threads(ws)},
             "demo": {"home": "../", "repo": REPO, "credit": credit}}
    return build(ws, out_dir / name, assets=out_dir / "assets", extra=extra)
