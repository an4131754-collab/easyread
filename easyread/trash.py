"""回收站：刪掉的論文整個資料夾挪到 文獻庫/.trash/<id>-<時間>，可以恢復、徹底刪除、清空。"""
from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path

from .store import read_json

_NAME = re.compile(r"^([0-9a-f]{12})-(\d{14})$")


def _dir(root: Path) -> Path:
    return root / ".trash"


def _entry(root: Path, name: str) -> Path:
    if not _NAME.match(name or ""):
        raise ValueError("回收站裡沒有這一項")
    p = _dir(root) / name
    if not p.is_dir():
        raise ValueError("回收站裡沒有這一項")
    return p


def items(root: Path) -> list[dict]:
    out = []
    for p in _dir(root).glob("*") if _dir(root).is_dir() else []:
        m = _NAME.match(p.name)
        if not m or not p.is_dir():
            continue
        meta = (read_json(p / "paper.json", {}) or {}).get("meta", {})
        out.append({"name": p.name, "id": m.group(1), "title_zh": meta.get("title_zh", ""), "title_en": meta.get("title_en", ""),
                    "authors": meta.get("authors", ""), "deleted": datetime.strptime(m.group(2), "%Y%m%d%H%M%S").isoformat(timespec="seconds")})
    return sorted(out, key=lambda x: x["deleted"], reverse=True)


def restore(root: Path, name: str) -> str:
    src = _entry(root, name)
    pid = _NAME.match(name).group(1)
    if (root / pid).exists():
        raise ValueError("文獻庫裡已經有這篇論文了（可能後來又匯入過一次）")
    shutil.move(str(src), root / pid)
    return pid


def purge(root: Path, name: str) -> int:
    """徹底刪掉回收站裡的一篇。"""
    shutil.rmtree(_entry(root, name))
    return 1


def empty(root: Path) -> int:
    """清空回收站，返回刪掉了幾篇。"""
    targets = [p for p in _dir(root).glob("*") if p.is_dir() and _NAME.match(p.name)] if _dir(root).is_dir() else []
    for p in targets:
        shutil.rmtree(p)
    return len(targets)
