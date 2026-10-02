"""翻譯、提問前先看一眼網路：連不上就立刻用中文說清楚怎麼辦（國內多半是沒開梯子），不讓人乾等到超時。

- problem(cfg)：按引擎找到它真正要連的地址，發一個請求；收到任何 HTTP 響應都算通。
- explain(cfg, msg)：引擎跑到一半報錯時，報錯像網路問題就補一句該怎麼辦。
- proxy_env()：梯子只開了“系統代理”時 Claude Code / Codex 讀不到，把它轉成 HTTPS_PROXY 傳過去。
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from . import http
from .log import log
from .presets import NEEDS_VPN, PRESETS

_OK_TTL = 120  # 通過一次後兩分鐘內不再測，一篇論文幾十批不用每批都測
_ok: dict[str, float] = {}
_LOCAL = {"localhost", "127.0.0.1", "::1"}
_NET = re.compile(r"ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN|fetch failed|connection error|unable to connect"
                  r"|error sending request|stream disconnected|timed out|getaddrinfo|連不上", re.I)
_REGION = re.compile(r"unsupported_country|not available in your (country|region)|request not allowed", re.I)
_CERT = re.compile(r"CERTIFICATE_VERIFY_FAILED|certificate verify failed|self.signed certificate|unknown issuer", re.I)


def _claude_base() -> str:
    """Claude Code 可能配了中轉（CC Switch 之類寫在 ~/.claude/settings.json 的 env 裡），國內中轉不用梯子。"""
    base = os.environ.get("ANTHROPIC_BASE_URL")
    if not base:
        try:
            env = json.loads((Path.home() / ".claude" / "settings.json").read_text(encoding="utf-8")).get("env") or {}
            base = env.get("ANTHROPIC_BASE_URL")
        except (OSError, ValueError, AttributeError):
            pass
    return base or "https://api.anthropic.com"


def _codex_base() -> str:
    try:
        text = (Path.home() / ".codex" / "config.toml").read_text(encoding="utf-8")
    except OSError:
        text = ""
    m = re.search(r'^\s*model_provider\s*=\s*"([^"]+)"', text, re.M)
    if m and m.group(1) != "openai":
        sec = re.search(r"^\[model_providers\.%s\]([\s\S]*?)(?=^\[|\Z)" % re.escape(m.group(1)), text, re.M)
        b = sec and re.search(r'^\s*base_url\s*=\s*"([^"]+)"', sec.group(1), re.M)
        if b:
            return b.group(1)
    return "https://chatgpt.com"


def target(cfg: dict) -> dict | None:
    """{name, url, vpn}：vpn 表示國內要開梯子才連得上。"""
    e = cfg.get("engine")
    if e == "claude":
        url = _claude_base()
        official = "anthropic.com" in url
        return {"name": "Claude" if official else "Claude Code 配置的中轉地址", "url": url, "vpn": official}
    if e == "codex":
        url = _codex_base()
        official = "chatgpt.com" in url or "openai.com" in url
        return {"name": "OpenAI（Codex）" if official else "Codex 配置的中轉地址", "url": url, "vpn": official}
    if e == "openai":
        o = cfg.get("openai") or {}
        url = (o.get("base_url") or "").strip().rstrip("/")
        if not url:
            return None
        p = next((x for x in PRESETS if x["id"] == o.get("preset")), None) \
            or next((x for x in PRESETS if x["base_url"].rstrip("/") == url), None)
        return {"name": p["name"] if p else "介面", "url": url, "vpn": bool(p and p["id"] in NEEDS_VPN)}
    return None


def _advice(t: dict) -> str:
    host = urlparse(t["url"]).hostname or t["url"]
    if host in _LOCAL:
        return f"連不上 {t['name']}（{urlparse(t['url']).netloc}）：先把它開啟，再點重試。"
    if t["vpn"]:
        return (f"連不上 {t['name']}（{host}）。在國內要先開啟梯子（VPN）再點重試；開著還不行，把梯子切到 TUN 或全域性模式。"
                "不想開梯子，可以在設定裡換成國內引擎（DeepSeek、智譜 GLM、矽基流動等）。")
    return f"連不上 {t['name']}（{host}）：檢查網路和地址有沒有填對；開著梯子的話，試試讓國內網站直連。"


def _region(t: dict) -> str:
    return f"{t['name']} 拒絕了當前地區的訪問：梯子節點在它不支援的地區（比如香港），換成美國、日本、新加坡等節點再重試。"


def _certificate(t: dict) -> str:
    host = urlparse(t["url"]).hostname or t["url"]
    return f"{t['name']}（{host}）證書校驗失敗：請檢查系統信任的根證書；使用代理時，也檢查代理證書是否已獲系統信任。"


def problem(cfg: dict, timeout: float = 6) -> str | None:
    """連得上返回 None，連不上返回給使用者看的一句話。"""
    t = target(cfg)
    u = urlparse(t["url"]) if t else None
    if not u or not u.hostname:
        return None
    origin = f"{u.scheme}://{u.netloc}/"
    if time.time() - _ok.get(origin, 0) < _OK_TTL:
        return None
    for attempt in range(2):  # 梯子偶爾抖一下，失敗一次不算
        try:
            http.urlopen(origin, timeout=timeout).close()
        except urllib.error.HTTPError as e:  # 有 HTTP 響應就說明網路是通的
            if _REGION.search(e.read(2000).decode("utf-8", "replace")):
                return _region(t)
        except Exception as e:  # noqa: BLE001  DNS 失敗、拒絕連線、超時、證書被劫持……
            if _CERT.search(str(e)):
                log.info("證書校驗失敗 %s：%s", origin, e)
                return _certificate(t)
            if attempt == 0:
                continue
            log.info("連通性檢查失敗 %s：%s", origin, e)
            return _advice(t)
        _ok[origin] = time.time()
        return None


def explain(cfg: dict, msg: str) -> str:
    t = target(cfg)
    if not t or "梯子" in msg or "先把它開啟" in msg:
        return msg
    if _REGION.search(msg):
        return msg + "\n" + _region(t)
    if _CERT.search(msg):
        _ok.clear()
        return msg + "\n" + _certificate(t)
    if _NET.search(msg):
        _ok.clear()
        return msg + "\n" + _advice(t)
    return msg


def offline(msg: str) -> bool:
    """這條報錯是不是網路 / 地區問題（是的話剩下的頁不用再試了）。"""
    return "梯子" in msg or "先把它開啟" in msg or "證書校驗失敗" in msg


def proxy_env() -> dict | None:
    """Windows / macOS 的系統代理 Python 讀得到，Node 寫的 Claude Code 讀不到；沒設 HTTPS_PROXY 時替它補上。"""
    if any(os.environ.get(k) for k in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy")):
        return None
    p = urllib.request.getproxies()
    proxy = p.get("https") or p.get("http")
    if not proxy or not proxy.startswith("http"):
        return None
    return dict(os.environ, HTTPS_PROXY=proxy, HTTP_PROXY=p.get("http") or proxy,
                NO_PROXY=os.environ.get("NO_PROXY") or "localhost,127.0.0.1,::1")
