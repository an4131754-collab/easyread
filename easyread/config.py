"""配置和資料位置。

從原始碼目錄執行時，資料就放在原始碼目錄（library/、config.json）；pip 安裝後放在 ~/EasyRead。
環境變數 EASYREAD_HOME 改資料目錄，EASYREAD_LIBRARY 臨時指定文獻庫（測試、多庫）。
"""
from __future__ import annotations

import copy
import os
from pathlib import Path

from .chat_models import DEFAULT_CHAT
from .presets import PRESET_GROUPS, PRESETS  # noqa: F401
from .store import read_json, write_json_atomic

PACKAGE = Path(__file__).resolve().parent
WEB = PACKAGE / "web"
_SOURCE = PACKAGE.parent
HOME = Path(os.environ.get("EASYREAD_HOME") or (_SOURCE if (_SOURCE / "pyproject.toml").exists() else Path.home() / "EasyRead"))
PROJECT = HOME  # 舊名，cli 裡還在用
CONFIG_PATH = HOME / "config.json"
LOG_PATH = HOME / "easyread.log"
SERVER_INFO = HOME / ".server.json"

DEFAULTS = {
    "library_dir": str(HOME / "library"),
    "port": 8765,
    "engine": "claude",          # claude | codex（本機 CLI 無頭）| openai（任意 OpenAI 相容介面）| none
    "auto_translate": True,      # 匯入後自動開始翻譯
    "check_updates": True,       # 開啟文獻庫時問 GitHub 有沒有新版本（一天一次），見 updates.py
    "batch_pages": 2,            # 每次交給模型的頁數
    "concurrency": 0,            # 同時翻譯幾段；0 自動（最多四段），手動最多八段
    "concurrency_v": 2,        # 分段並行設定版本；0 是自動，最多四段
    "claude": {"command": "claude", "model": "", "extra_args": [], "timeout": 1200},
    "codex": {"command": "codex", "model": "", "extra_args": [], "timeout": 1200},
    # api：chat（/chat/completions）| responses（/responses），見 openai_api.py
    "openai": {"preset": "", "base_url": "", "api": "chat", "api_key": "", "model": "", "vision": False, "timeout": 600},
    # 閱讀頁右側“問 AI”的模型名單和預設模型，見 chat_models.py
    "chat": copy.deepcopy(DEFAULT_CHAT),
}

def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def is_first_run() -> bool:
    return not CONFIG_PATH.exists()


def load() -> dict:
    cfg = _merge(DEFAULTS, _saved())
    lib = os.environ.get("EASYREAD_LIBRARY") or os.environ.get("COREAD_LIBRARY")
    if lib:  # 測試或多庫時臨時指定文獻庫
        cfg["library_dir"] = lib
    return cfg


def temp_library() -> bool:
    return bool(os.environ.get("EASYREAD_LIBRARY") or os.environ.get("COREAD_LIBRARY"))


def save(patch: dict) -> dict:
    cfg = _merge(_merge(DEFAULTS, _saved()), patch)
    write_json_atomic(CONFIG_PATH, cfg)
    return load()


def with_key(o: dict) -> dict:
    """頁面提交的 openai 設定 → 要存的樣子。每家服務商的 Key 分開存（keys[預設]），換來換去不用重填；
    頁面發回來的打碼 Key 或空 Key 表示不改。"""
    cur = load()["openai"]
    o = dict(o)
    key = o.pop("api_key", None)
    preset = o.get("preset", cur.get("preset")) or ""
    keys = dict(cur.get("keys") or {})
    if cur.get("api_key") and not keys:  # 舊配置只有一個 Key
        keys[cur.get("preset") or ""] = cur["api_key"]
    if key and not key.startswith("••••"):
        keys[preset] = key.strip()
    o["keys"] = keys
    o["api_key"] = keys.get(preset, "")
    return o


def public(cfg: dict) -> dict:
    """給頁面看的配置：金鑰只露後四位。"""
    out = copy.deepcopy(cfg)
    key = out["openai"].get("api_key") or ""
    out["openai"]["api_key"] = ("••••" + key[-4:]) if key else ""
    out["openai"]["has_key"] = bool(key)
    out["openai"]["saved_keys"] = [k for k, v in (out["openai"].pop("keys", None) or {}).items() if v]
    return out


def library_dir(cfg: dict | None = None) -> Path:
    p = Path((cfg or load())["library_dir"])
    p.mkdir(parents=True, exist_ok=True)
    return p


def _saved() -> dict:
    raw = read_json(CONFIG_PATH, {}) or {}
    if raw.get("concurrency_v") != 2 and raw.get("concurrency") == 1:
        # 以前預設 1，而且切到本機 CLI 時設定頁會強制改回 1，舊設定裡的 1 多半不是自己選的：當成自動。
        # 存過一次之後帶上 concurrency_v，再選 1 就是真的要一段一段譯
        raw["concurrency"] = 0
    elif raw.get("concurrency_v") != 2 and isinstance(raw.get("concurrency"), int) and raw["concurrency"] > 4:
        raw["concurrency"] = 4  # 以前的 6 是“同時 6 批”，現在是“同時 6 段”：升級時不替老使用者開到 4 段以上
    raw["concurrency_v"] = 2
    return raw
