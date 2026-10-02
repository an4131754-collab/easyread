"""檢查新版本：問 GitHub 最新的 Release，比當前版本新就告訴頁面（文獻庫頂欄顯示“有新版本”）。

一天最多問一次，結果記在資料目錄的 update.json；沒網、GitHub 連不上就當沒有新版本，不報錯。
幫助裡關掉“自動檢查新版本”後，只有點“檢查更新”時才聯網。
"""
from __future__ import annotations

import json
import re
import threading
import time
import urllib.request

from . import __version__, config, http
from .log import log
from .store import read_json, write_json_atomic

REPO = "Edwardxlai/easyread"
API = f"https://api.github.com/repos/{REPO}/releases/latest"
EVERY = 24 * 3600   # 成功問到後多久再問
RETRY = 3 * 3600    # 沒問到（沒網）多久後再試
_lock = threading.Lock()


def _path():
    return config.HOME / "update.json"


def parse(v: str) -> tuple[int, ...]:
    """'v1.2.10' → (1, 2, 10)；認不出的部分當 0。"""
    return tuple(int(x) for x in re.findall(r"\d+", v or "")[:3]) or (0,)


def newer(latest: str, current: str = __version__) -> bool:
    return parse(latest) > parse(current)


def _fetch() -> dict:
    req = urllib.request.Request(API, headers={"Accept": "application/vnd.github+json", "User-Agent": f"EasyRead/{__version__}"})
    with http.urlopen(req, timeout=8) as r:
        rel = json.loads(r.read())
    return {"latest": (rel.get("tag_name") or "").lstrip("v"), "url": rel.get("html_url") or f"https://github.com/{REPO}/releases/latest",
            "notes": (rel.get("body") or "")[:6000], "published": rel.get("published_at") or ""}


def check(force: bool = False) -> dict:
    """{"current", "latest", "newer", "url", "notes", "published", "enabled"}。force：手動點“檢查更新”，關掉自動檢查也照樣問。"""
    out = {"current": __version__, "latest": "", "newer": False, "enabled": bool(config.load().get("check_updates", True))}
    if not out["enabled"] and not force:
        return out
    with _lock:  # 兩個頁面同時開啟只問一次
        cache = read_json(_path(), {}) or {}
        age = time.time() - cache.get("checked", 0)
        if force or age > (EVERY if cache.get("latest") else RETRY):
            try:
                cache = {**_fetch(), "checked": time.time()}
            except Exception as e:  # noqa: BLE001  沒網、限流、GitHub 改了格式：都當沒有新版本
                log.info("檢查新版本沒成功：%s", e)
                cache = {**cache, "checked": time.time()}
            try:
                write_json_atomic(_path(), cache)
            except OSError:
                pass
    if cache.get("latest"):
        out.update(latest=cache["latest"], url=cache.get("url", ""), notes=cache.get("notes", ""),
                   published=cache.get("published", ""), newer=newer(cache["latest"]))
    return out
