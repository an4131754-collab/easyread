"""介面偏好（字號、版心、主題、快捷鍵……）存在資料目錄的 prefs.json。

以前放在瀏覽器 localStorage 裡，換個瀏覽器或清一下快取就沒了；現在以這份檔案為準，瀏覽器裡只留一份快取。
"""
from __future__ import annotations

from . import config
from .store import read_json, write_json_atomic

ALLOWED = {"reader", "keys", "ui", "library", "import"}  # ui：功能開關 features、快捷鍵總開關 keys_on


def path():
    # 測試用的臨時文獻庫各自帶一份，不碰真實偏好
    return config.library_dir() / ".prefs.json" if config.temp_library() else config.HOME / "prefs.json"


def load() -> dict:
    return read_json(path(), {}) or {}


def save(patch: dict) -> dict:
    data = load()
    for k, v in (patch or {}).items():
        if k in ALLOWED and isinstance(v, dict):
            data[k] = {**(data.get(k) or {}), **v}
    write_json_atomic(path(), data)
    return data
