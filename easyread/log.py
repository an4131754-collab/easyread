"""日誌：寫到資料目錄下的 easyread.log（雙擊啟動時沒有控制台，出錯資訊全靠它）。"""
from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

log = logging.getLogger("easyread")


def setup(path: Path) -> Path:
    if log.handlers:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")
    fh = RotatingFileHandler(path, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    if sys.stderr is not None and getattr(sys.stderr, "name", "") != "nul" and sys.stderr.isatty():
        sh = logging.StreamHandler(sys.stderr)
        sh.setFormatter(fmt)
        log.addHandler(sh)
    log.setLevel(logging.INFO)
    return path


def tail(path: Path, n: int = 80) -> str:
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:])
    except OSError:
        return ""
