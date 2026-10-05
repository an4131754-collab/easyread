"""翻譯調用 Codex 時不拉起使用者自己配的 MCP 服務，也關掉翻譯用不到的功能。

codex exec 每次啟動都會把 ~/.codex/config.toml（或 CODEX_HOME 下的）裡的 [mcp_servers.*] 全部拉起來：
npx 起的服務每個就是好幾個 node 進程，分段並行 4 段時實测 300 多個進程、峰值 8 GB。翻譯用不到這些工具。
這裡讀出設定裡有哪些 MCP 服務，給每個傳 -c mcp_servers.<名字>.enabled=false，再把 turn 結束時的 notify 钩子關掉。
不用 --ignore-user-config：那樣會連使用者自定義的 provider、model 一起丟掉。
讀不到設定、解析不出來就不碰 MCP；Codex 版本不認這些鍵時會忽略，真報錯時 run_codex 去掉它們再調一次，也就是退回現状。
"""
from __future__ import annotations

import os
import re
from pathlib import Path

# [mcp_servers.名字] 或 [mcp_servers."帶點的名字"]；子表 [mcp_servers.名字.env] 不算新服務
_HEADER = re.compile(r"""(?m)^\s*\[\s*mcp_servers\s*\.\s*("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)\s*\]""")
_BARE = re.compile(r"[A-Za-z0-9_-]+")


def config_path() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "config.toml"


def server_names(text: str) -> list[str]:
    out = []
    for m in _HEADER.finditer(text):
        raw = m.group(1)
        name = raw[1:-1].replace('\\"', '"') if raw[0] in "\"'" else raw
        if name and name not in out:
            out.append(name)
    return out


def _key(name: str) -> str:
    return name if _BARE.fullmatch(name) else '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


def args(path: Path | None = None) -> list[str]:
    """codex exec 要加的 -c 參數。設定讀不到、解析不出就只關功能、不碰 MCP。"""
    try:
        text = (path or config_path()).read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return features()  # 沒有設定檔案：沒有 MCP 要關
    try:
        names = server_names(text)
    except Exception:  # noqa: BLE001 —— 解析不了就不碰 MCP
        return features()
    out: list[str] = []
    for n in names:
        out += ["-c", f"mcp_servers.{_key(n)}.enabled=false"]
    if re.search(r"(?m)^\s*notify\s*=", text.split("\n[", 1)[0]):
        out += ["-c", "notify=[]"]  # 每次結束時調用的提醒程序（Codex 桌面版的电脑操作組件），翻譯用不到
    return out + features()


# 翻譯用不到的功能：插件、應用、浏覽器、电脑操作、生圖、多代理、記忆……每個都會往每次調用裡加工具定義，
# 有的還會拉起 node_repl 之類的進程。實测（codex-cli 0.159）空調用固定上下文從約 2.5 萬 token 降到約 1.7 萬，
# 進程從 19 個降到 3 個，記憶體從約 840 MB 降到約 200 MB。只關這一次調用，不改使用者的設定。
# 版本不認某個名字時 Codex 照常忽略；真報錯時 run_codex 會去掉這些參數再調一次。
FEATURES_OFF = ("apps", "plugins", "browser_use", "browser_use_external", "computer_use", "image_generation", "multi_agent",
                "memories", "goals", "skill_search", "in_app_browser", "tool_suggest", "realtime_conversation", "code_mode_host",
                "sleep_tool")


def features() -> list[str]:
    out: list[str] = []
    for f in FEATURES_OFF:
        out += ["-c", f"features.{f}=false"]
    return out
