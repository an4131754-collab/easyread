"""翻譯花了多少：token 數，Claude Code 訂閱還能看到 5 小時 / 7 天額度用了百分之幾。

每次呼叫模型後，各引擎把返回裡的用量交給 Meter；整篇翻譯時 Meter 的累計寫進 job.json 給頁面顯示。
input 是全部輸入 token（含命中快取的部分），cached 是其中命中快取的，output 是輸出。
"""
from __future__ import annotations

import threading
import time

from . import config
from .store import read_json, write_json_atomic


class Meter:
    """一次翻譯任務的累計用量。併發翻譯時多個執行緒一起往裡加。"""

    def __init__(self, engine: str = ""):
        self._lock = threading.Lock()
        self.data: dict = {"engine": engine, "calls": 0, "input": 0, "cached": 0, "output": 0}

    def add(self, input: int = 0, cached: int = 0, output: int = 0, cost_usd: float | None = None, limits: dict | None = None,
            context_window: int | None = None):
        with self._lock:
            d = self.data
            d["calls"] += 1
            # 最近一次呼叫的上下文有多大（輸入 + 輸出）：問 AI 時每次都把之前的對話一起發，這就是當前對話佔了多少上下文
            d["context"] = {"cached": int(cached or 0), "fresh": int(input or 0) - int(cached or 0), "output": int(output or 0)}
            if context_window:
                d["context_window"] = int(context_window)
            d["input"] += int(input or 0)
            d["cached"] += int(cached or 0)
            d["output"] += int(output or 0)
            if cost_usd is not None:
                d["cost_usd"] = round(d.get("cost_usd", 0) + float(cost_usd), 4)
            if limits:
                d["limits"] = limits  # 整個賬號的額度（同時在用 Claude Code 幹別的也算在裡面），只記最新的
        if limits:
            remember(limits)

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self.data)


# ---------- 最近一次看到的訂閱額度（全域性，新對話也能顯示） ----------
def _limits_path():
    return config.library_dir() / ".limits.json" if config.temp_library() else config.HOME / "limits.json"


def remember(limits: dict) -> None:
    try:
        write_json_atomic(_limits_path(), {"limits": limits, "at": int(time.time())})
    except OSError:
        pass


def latest() -> dict | None:
    """{"limits": {...}, "at": 時間戳}；還沒用 Claude Code 訂閱呼叫過就是 None。"""
    return read_json(_limits_path(), None)


def merge(total: dict | None, run: dict) -> dict:
    """把這次的用量加進這篇論文的累計（job.json 的 usage_total）。"""
    out = dict(total or {})
    for k in ("calls", "input", "cached", "output"):
        out[k] = int(out.get(k, 0)) + int(run.get(k, 0))
    if "cost_usd" in run:
        out["cost_usd"] = round(out.get("cost_usd", 0) + run["cost_usd"], 4)
    for k in ("engine", "limits"):
        if run.get(k):
            out[k] = run[k]
    return out


# ---------- 各引擎返回的用量 ----------
def from_claude(result: dict, rate_event: dict | None) -> dict:
    """claude -p --output-format stream-json 的 result 行，和其中的 rate_limit_event。"""
    u = result.get("usage") or {}
    cached = int(u.get("cache_read_input_tokens") or 0)
    rec = {"input": int(u.get("input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0) + cached,
           "cached": cached, "output": int(u.get("output_tokens") or 0)}
    windows = ((rate_event or {}).get("rate_limit_info") or {}).get("unifiedWindows") or {}
    if windows:  # 有額度資訊就是訂閱；訂閱時 total_cost_usd 只是按官方價折算，不是真花的錢，不記
        rec["limits"] = {k: {"used": w.get("utilization"), "resets_at": w.get("resetsAt")}
                         for k, w in windows.items() if isinstance(w, dict)}
    elif result.get("total_cost_usd") is not None:
        rec["cost_usd"] = float(result["total_cost_usd"])
    window = next((m.get("contextWindow") for m in (result.get("modelUsage") or {}).values() if m.get("contextWindow")), None)
    if window:
        rec["context_window"] = window
    return rec


def from_codex(event: dict) -> dict:
    """codex exec --json 的 turn.completed 事件。"""
    u = event.get("usage") or {}
    return {"input": int(u.get("input_tokens") or 0), "cached": int(u.get("cached_input_tokens") or 0),
            "output": int(u.get("output_tokens") or 0)}


def from_openai(res: dict) -> dict:
    """Chat Completions 或 Responses 返回的 usage（DeepSeek 的快取命中數字段名不一樣）。"""
    u = (res or {}).get("usage") or {}
    if "prompt_tokens" in u:  # Chat Completions
        details = u.get("prompt_tokens_details") or {}
        cached = details.get("cached_tokens") or u.get("prompt_cache_hit_tokens") or 0
        return {"input": int(u.get("prompt_tokens") or 0), "cached": int(cached), "output": int(u.get("completion_tokens") or 0)}
    details = u.get("input_tokens_details") or {}
    return {"input": int(u.get("input_tokens") or 0), "cached": int(details.get("cached_tokens") or 0),
            "output": int(u.get("output_tokens") or 0)}
