"""Resolve API credentials without sharing custom-endpoint secrets across hosts."""


def key_id(preset: str = "", base_url: str = "") -> str:
    return preset or "url:" + (base_url or "").strip().rstrip("/")


def saved_keys(openai: dict) -> dict:
    keys = dict(openai.get("keys") or {})
    current = key_id(openai.get("preset") or "", openai.get("base_url") or "")
    # The old unnamed key belongs only to the currently configured custom URL.
    legacy = keys.pop("", "")
    if not openai.get("preset") and legacy:
        keys.setdefault(current, legacy)
    if openai.get("api_key"):
        keys.setdefault(current, openai["api_key"])
    return keys


def resolve(openai: dict, preset: str = "", base_url: str = "") -> str:
    return saved_keys(openai).get(key_id(preset, base_url), "")
