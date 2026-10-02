"""Claude Code / Codex CLI 能選哪些模型，給設定頁的下拉框用。

- Codex：讀 ~/.codex/models_cache.json（Codex 自己從服務端拉的名單），只要 /model 裡列出來的那些，按它的順序；
  預設模型是 ~/.codex/config.toml 裡的 model。
- Claude：opus / sonnet / haiku 是 Claude Code 的別名，會用它支援的最新版；
  實際是哪個版本記在 .models-seen.json（見 chat_models.remember）：每次回答時記一次；
  另外 probe_claude() 在服務啟動時把還沒記過的別名查一遍（Claude Code 升級後重查），名單裡一開始就有版本號。
  不指定模型時 Claude Code 用哪個（“跟隨預設”）：~/.claude/settings.json 裡寫了 model 就是它，沒寫就看探測時記下的 _default。
"""
from __future__ import annotations

import json
import tempfile
import threading
from pathlib import Path

from . import chat_models, engines
from .log import log
from .presets import PRESETS

_probing = threading.Lock()
CLAUDE_ALIASES = [("opus", "Opus", "最強"), ("sonnet", "Sonnet", "快、省"), ("haiku", "Haiku", "最快最省")]


def codex() -> dict:
    """{"default": slug, "models": [{"id", "name", "desc"}]}；Codex 沒裝或沒登入過就是空名單。"""
    out: list[dict] = []
    try:
        data = json.loads((Path.home() / ".codex" / "models_cache.json").read_text(encoding="utf-8"))
        ms = [m for m in data.get("models") or [] if m.get("visibility") == "list" and m.get("slug")]
        ms.sort(key=lambda m: m.get("priority", 99))
        out = [{"id": m["slug"], "name": m.get("display_name") or m["slug"], "desc": m.get("description") or ""} for m in ms]
    except (OSError, ValueError, AttributeError):
        pass
    return {"default": chat_models.codex_default_model(), "models": out}


def claude_default() -> str:
    """Claude Code 不指定模型時用的那個，顯示名（Claude Opus 5.5）；不知道就空。"""
    try:
        model = json.loads((Path.home() / ".claude" / "settings.json").read_text(encoding="utf-8")).get("model") or ""
    except (OSError, ValueError, AttributeError):
        model = ""
    actual = (chat_models.actual_of(model) or model) if model else chat_models.actual_of("_default")
    if actual in ("opus", "sonnet", "haiku", "fable"):  # 別名還沒查到對應版本
        return "Claude " + actual.capitalize()
    return chat_models.pretty(actual) if actual else ""


def claude() -> dict:
    """{"default": "Claude Opus 5.5", "models": [{"id": "opus", "name": "Opus", "desc": "最強", "actual": "Claude Opus 5.5"}]}"""
    return {"default": claude_default(), "models": [{"id": a, "name": n, "desc": d, "actual": chat_models.pretty(chat_models.actual_of(a)) if chat_models.actual_of(a) else ""}
                       for a, n, d in CLAUDE_ALIASES]}


def probe_claude(c: dict, version: str) -> None:
    """讓 Claude Code 報一下 opus / sonnet / haiku 現在各指向哪個版本。
    它啟動時第一行（init 事件）就帶著實際模型名，這時還沒發請求；讀到就結束程序，不花 token。"""
    exe = engines.claude_path(c)
    if not exe or (chat_models.actual_of("_claude_version") == version
                   and all(chat_models.actual_of(a) for a in [x for x, _, _ in CLAUDE_ALIASES] + ["_default"])):
        return
    if not _probing.acquire(blocking=False):  # 上一輪還沒查完
        return
    try:
        _probe(exe, version)
    finally:
        _probing.release()


def _probe(exe: str, version: str) -> None:
    for alias in [a for a, _, _ in CLAUDE_ALIASES] + ["_default"]:  # _default：不帶 --model，看它預設用哪個
        proc = engines._popen([exe, "-p", *([] if alias == "_default" else ["--model", alias]), "--output-format", "stream-json", "--verbose",
                               "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"],
                              Path(tempfile.gettempdir()))
        try:
            proc.stdin.write(".")
            proc.stdin.close()
            for _, line in zip(range(20), proc.stdout):
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if ev.get("type") == "system" and ev.get("subtype") == "init":
                    chat_models.remember(alias, ev.get("model", ""))
                    break
        except Exception:  # noqa: BLE001 —— 查不到就等第一次回答時再記
            log.info("查 Claude 別名 %s 失敗", alias, exc_info=True)
        finally:
            proc.kill()
    chat_models.remember("_claude_version", version)


def listing() -> dict:
    return {"claude": claude(), "codex": codex()}


def engine_label(cfg: dict) -> str:
    """文獻庫右上角的引擎標籤：“Claude Code · Claude Opus 5.5”“DeepSeek · deepseek-v4-flash”。"""
    e = cfg.get("engine")
    if e == "openai":
        preset = next((p["name"] for p in PRESETS if p["id"] == cfg["openai"].get("preset")), "API")
        return f"{preset.split('（')[0]} · {cfg['openai'].get('model') or '未填模型'}"
    name = engines.ENGINE_NAMES.get(e, e or "")
    if e == "claude":  # 帶上實際用的模型：Claude Code · Claude Opus 5.5
        m = cfg["claude"].get("model") or ""
        actual = chat_models.actual_of(m) if m else ""
        model = chat_models.pretty(actual) if actual else ("Claude " + m.capitalize() if m in ("opus", "sonnet", "haiku") else m) if m else claude_default()
    elif e == "codex":
        model = chat_models.label({"engine": "codex", "model": cfg["codex"].get("model") or ""})
    else:
        model = ""
    return f"{name} · {model}" if model and model != "GPT" else name
