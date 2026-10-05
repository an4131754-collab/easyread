"""先回傳已儲存的閱讀內容，再以單一背景工作準備原頁縮圖。

只有這版新匯入的論文會補圖或更新定位；舊論文的文字、順序與定位保留。
"""
from __future__ import annotations

import threading

from . import figures, pdfwork
from .log import log

_preparing: set[str] = set()
_guard = threading.Lock()
_serial = threading.Lock()


def busy() -> bool:
    with _guard:
        return bool(_preparing)


def prepare_later(ws) -> None:
    key = str(ws.root.resolve())
    with _guard:
        if key in _preparing or (ws.load("job") or {}).get("state") in ("queued", "running"):
            return
        _preparing.add(key)

    def run():
        try:
            with _serial:
                if (ws.load("job") or {}).get("state") in ("queued", "running"):
                    return
                # Do not silently recalculate older papers when opening them.
                if ws.load("paper").get("meta", {}).get("pdf_layout_version") == pdfwork.LOCATE_VERSION:
                    pdfwork.refresh_layout(ws.root)
                    figures.fill(ws)
                pdfwork.warm_variants(ws.root)
        except Exception:
            log.exception("準備閱讀頁檔案失敗 %s", ws.root)
        finally:
            with _guard:
                _preparing.discard(key)

    try:
        threading.Thread(target=run, name="reader-prepare", daemon=True).start()
    except Exception:
        with _guard:
            _preparing.discard(key)
        raise
