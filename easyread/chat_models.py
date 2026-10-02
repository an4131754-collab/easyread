"""“問 AI”用哪些模型：設定裡一張短名單（預設 Claude Opus 5.5、Claude Sonnet 5.5、GPT），可以增刪改。

每一項：{"id", "name", "engine": "claude" | "codex" | "openai", "model", "preset"（API 服務商）, "base_url"（自定義地址時）,
         "api"（chat | responses，不填跟服務商預設）}
API 的 Key 用翻譯引擎那邊按服務商存的同一份（openai.keys），不用填兩次。
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

from . import engines
from .presets import PRESETS

# opus / sonnet 是 Claude Code 的別名：它會用自己支援的最新版（升級 Claude Code 後自動變成 Opus 5.5 等），
# 實際用的是哪個版本，第一次回答時記下來顯示在名單上。
DEFAULT_MODELS = [
    {"id": "opus", "name": "Claude Opus", "engine": "claude", "model": "opus"},
    {"id": "sonnet", "name": "Claude Sonnet", "engine": "claude", "model": "sonnet"},
    {"id": "gpt", "name": "GPT", "engine": "codex", "model": ""},
]
_SEEN_PATH = None  # config.HOME / ".models-seen.json"，懶載入避免迴圈匯入


def _seen_path():
    from . import config
    return config.HOME / ".models-seen.json"


def pretty(model_id: str) -> str:
    """claude-opus-5-5 → Claude Opus 5.5；claude-sonnet-5 → Claude Sonnet 5。"""
    m = re.fullmatch(r"claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?", model_id or "")
    if not m:
        return model_id
    return f"Claude {m.group(1).capitalize()} {m.group(2)}" + (f".{m.group(3)}" if m.group(3) else "")


def remember(alias: str, actual: str) -> None:
    """記下別名實際對應的模型（Claude Code 在每次回答開頭會報）。"""
    if not alias or not actual or alias == actual:
        return
    from .store import read_json, write_json_atomic
    seen = read_json(_seen_path(), {}) or {}
    if seen.get(alias) != actual:
        seen[alias] = actual
        write_json_atomic(_seen_path(), seen)


def actual_of(alias: str) -> str:
    from .store import read_json
    return (read_json(_seen_path(), {}) or {}).get(alias, "")
DEFAULT_CHAT = {"models": DEFAULT_MODELS, "default": "opus"}


def codex_default_model() -> str:
    """Codex CLI 沒指定模型時用它自己配置裡的（~/.codex/config.toml 的 model）。"""
    try:
        text = (Path.home() / ".codex" / "config.toml").read_text(encoding="utf-8")
    except OSError:
        return ""
    m = re.search(r'(?m)^\s*model\s*=\s*"([^"]+)"', text.split("[", 1)[0])
    return m.group(1) if m else ""


def models(cfg: dict) -> list[dict]:
    return list((cfg.get("chat") or {}).get("models") or DEFAULT_MODELS)


def find(cfg: dict, mid: str | None) -> dict:
    ms = models(cfg)
    want = mid or (cfg.get("chat") or {}).get("default")
    return next((m for m in ms if m.get("id") == want), ms[0] if ms else DEFAULT_MODELS[0])


def _key(cfg: dict, preset: str) -> str:
    o = cfg["openai"]
    keys = dict(o.get("keys") or {})
    if o.get("api_key"):
        keys.setdefault(o.get("preset") or "", o["api_key"])
    return keys.get(preset or "", "")


def engine_cfg(cfg: dict, mid: str | None) -> tuple[dict, dict]:
    """名單裡的一項 → (engines 認的配置, 這一項)。"""
    m = find(cfg, mid)
    out = copy.deepcopy(cfg)
    out["engine"] = m["engine"]
    if m["engine"] in ("claude", "codex"):
        out[m["engine"]]["model"] = m.get("model") or ""
    elif m["engine"] == "openai":
        p = next((x for x in PRESETS if x["id"] == m.get("preset")), None)
        out["openai"] = {**out["openai"], "preset": m.get("preset") or "", "vision": False,
                         "base_url": m.get("base_url") or (p["base_url"] if p else out["openai"].get("base_url", "")),
                         "model": m.get("model") or (p["model"] if p else ""), "api_key": _key(cfg, m.get("preset") or ""),
                         "api": m.get("api") or (p or {}).get("api") or "chat"}
    else:
        raise engines.EngineError(f"不認識的模型來源：{m.get('engine')}")
    return out, m


def translation_id(cfg: dict) -> str:
    """名單裡哪一張就是翻譯用的那個模型（設定裡標著“翻譯”的卡片）；對不上返回空。"""
    e = cfg.get("engine")
    for m in models(cfg):
        if m.get("engine") != e:
            continue
        if e in ("claude", "codex") and (m.get("model") or "") == (cfg.get(e, {}).get("model") or ""):
            return m["id"]
        if e == "openai":
            o = cfg.get("openai", {})
            if (m.get("preset") or "") == (o.get("preset") or "") and (m.get("model") or "") == (o.get("model") or ""):
                return m["id"]
    return ""


def label(m: dict) -> str:
    """面板上顯示的名字：Claude 別名顯示實際版本（Claude Opus 5），Codex 沒填模型時帶上它實際用的模型。"""
    if m.get("engine") == "claude" and m.get("model") in ("opus", "sonnet", "haiku") and actual_of(m["model"]):
        return pretty(actual_of(m["model"]))
    if m.get("engine") == "codex" and (not m.get("name") or m.get("name") in ("GPT", m.get("model"))):
        from . import cli_models  # 用 Codex 裡 /model 顯示的名字，比如 GPT-6-Astra
        slug = m.get("model") or codex_default_model()
        return next((x["name"] for x in cli_models.codex()["models"] if x["id"] == slug), slug or "GPT")
    return m.get("name") or m.get("model") or "模型"


def listing(cfg: dict) -> dict:
    """給頁面：名單 + 每項能不能用、來源說明。"""
    from .detect import detect, needs_key
    found = detect(cfg)
    out = []
    for m in models(cfg):
        e = m.get("engine")
        if e in ("claude", "codex"):
            ready = bool(found.get(e, {}).get("found"))
            source = "Claude Code" if e == "claude" else "Codex CLI"
            hint = "" if ready else f"本機沒找到 {source}"
        else:
            p = next((x for x in PRESETS if x["id"] == m.get("preset")), None)
            ready = bool(_key(cfg, m.get("preset") or "")) or not needs_key({"preset": m.get("preset"), "base_url": m.get("base_url", "")})
            source = p["name"] if p else "自定義地址"
            hint = "" if ready else f"還沒填 {source} 的 Key（設定 → 模型 → 點這張卡片 → 修改）"
        out.append({**m, "label": label(m), "source": source, "ready": ready, "hint": hint,
                    "detail": (actual_of(m.get("model", "")) or m.get("model") or _claude_default()) if e == "claude"
                    else m.get("model") or ((codex_default_model() + "（跟隨 Codex 預設）") if e == "codex" and codex_default_model() else "")})
    default = (cfg.get("chat") or {}).get("default") or (out[0]["id"] if out else "")
    return {"models": out, "default": default, "translate": translation_id(cfg), "presets": [{"id": p["id"], "name": p["name"], "models": p.get("models", []), "api": p.get("api", "chat")} for p in PRESETS]}


def sanitize(items: list[dict]) -> list[dict]:
    """設定頁提交的名單：去掉空項、補 id。"""
    out, seen = [], set()
    for k, m in enumerate(items or []):
        e = m.get("engine")
        if e not in ("claude", "codex", "openai") or (e == "openai" and not (m.get("preset") or m.get("base_url"))):
            continue
        mid = re.sub(r"[^\w\-]", "-", str(m.get("id") or f"m{k}"))[:40] or f"m{k}"
        while mid in seen:
            mid += "-2"
        seen.add(mid)
        out.append({"id": mid, "name": str(m.get("name") or m.get("model") or "模型")[:40], "engine": e,
                    "model": str(m.get("model") or "")[:120], "preset": str(m.get("preset") or ""), "base_url": str(m.get("base_url") or "")[:300],
                    "api": m.get("api") if m.get("api") in ("chat", "responses") else ""})
    return out or copy.deepcopy(DEFAULT_MODELS)


def _claude_default() -> str:
    """“跟隨 Claude Code 預設”的卡片下面寫出實際是哪個：跟隨預設（Claude Opus 5.5）"""
    from .cli_models import claude_default  # cli_models 引用了本檔案，放這裡免得迴圈匯入
    d = claude_default()
    return f"跟隨預設（{d}）" if d else "跟隨預設"
