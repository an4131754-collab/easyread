"""完整單篇備份／恢復；限定本篇的備份，不自動刪除舊備份。"""
from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .store import Workspace, dir_lock

_NAME = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{8}$")


def _base(ws: Workspace) -> Path:
    return ws.root.parent / ".backups" / ws.id


def create(ws: Workspace) -> str:
    name = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid4().hex[:8]
    target = _base(ws) / name
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copytree(ws.root, target, ignore=shutil.ignore_patterns(".write.lock", ".maintenance.lock", ".*.tmp"))
        (target / ".complete").write_text("完整備份\n", encoding="utf-8")
    except Exception:
        # Incomplete copies are never offered as recovery candidates.
        raise
    return name


def listing(ws: Workspace) -> list[dict]:
    base = _base(ws)
    if not base.is_dir():
        return []
    return [{"name": p.name} for p in sorted(base.iterdir(), reverse=True)
            if _NAME.fullmatch(p.name) and p.is_dir() and (p / ".complete").is_file()]


def restore(ws: Workspace, name: str) -> dict:
    base = _base(ws).resolve()
    source = (base / name).resolve()
    if not _NAME.fullmatch(name or "") or source.parent != base or not (source / ".complete").is_file():
        raise ValueError("找不到這篇論文的完整備份")
    check = Workspace(source)
    for part in ("paper", "reader", "discussion", "item", "layout", "chat", "job"):
        check.load(part)  # Validate before touching the current paper; corrupt backups remain untouched.
    paper = check.load("paper")
    if not paper or not isinstance(paper.get("blocks", []), list):
        raise ValueError("備份中的論文格式不正確")
    with dir_lock(ws.root):
        before = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid4().hex[:8]
        stage = ws.root.parent / (".restore-" + uuid4().hex)
        shutil.copytree(source, stage, ignore=shutil.ignore_patterns(".complete", ".write.lock", ".maintenance.lock"))
        # Keep the previous directory until the new one has been installed successfully.
        previous = _base(ws) / before
        ws.root.rename(previous)
        try:
            stage.rename(ws.root)
        except Exception:
            previous.rename(ws.root)
            raise
        # The old lock moved with the directory; let dir_lock release it at its original path.
        old_lock = previous / ".write.lock"
        if old_lock.exists():
            old_lock.unlink()
        # Preserve the old tree as an extra recovery copy; never recursively delete user data here.
        old_maintenance = previous / ".maintenance.lock"
        if old_maintenance.exists():
            old_maintenance.unlink()
        (previous / ".complete").write_text("恢復前完整資料\n", encoding="utf-8")
    return {"ok": True, "before": before}
