"""閱讀頁右側的“問 AI”：提示詞和流式輸出（回答一個字一個字流出來）。

- 用哪個模型：chat_models.py（設定裡的一張短名單）。
- 對話記錄：chat_store.py（每篇論文可以有多個對話）。
- 上下文：論文標題、摘要、讀者指著的段落和前後幾段、讀者引用的幾處原文、術語表。
  讀者的標記（按顏色分好的劃線、筆記、問題）只在問題提到“標紅的”“劃線”“筆記”時才帶上，
  提到具體顏色就只帶那種顏色，所以可以問“我標紅的那些公式之間有什麼聯絡”。
  Claude Code 還能自己 Read paper.json、reader.json 看全文和全部標記。
"""
from __future__ import annotations

import json
import re
import threading
from collections.abc import Iterator
from pathlib import Path

from . import engines, netcheck, openai_api, usage
from .prompts import _block_text
from .store import Workspace

HISTORY = 12  # 帶上最近幾輪對話
COLOR_NAMES = {"yellow": "黃", "green": "綠", "blue": "藍", "pink": "紅"}
MARKS_BUDGET = 9000  # 標記部分最多帶多少字


# ---------- 提示詞 ----------
def _context(ws: Workspace, anchor: str | None, quote: str, refs: list[dict] | None = None) -> str:
    paper = ws.load("paper")
    meta = paper.get("meta", {})
    blocks = paper.get("blocks", [])
    lines = [f"論文：《{meta.get('title_zh') or ''}》{meta.get('title_en') or ''}，{meta.get('authors', '')[:200]}。"]
    abstract = next((_block_text(b) for b in blocks if b.get("role") == "abstract"), "")
    if abstract:
        lines.append("摘要：" + abstract[:1500])
    idx = next((i for i, b in enumerate(blocks) if b.get("id") == anchor), None)
    if idx is not None:
        h = next((b for b in reversed(blocks[:idx + 1]) if b.get("type") == "heading"), None)
        if h:
            lines.append(f"讀者正在讀的章節：{h.get('num', '')} {h.get('zh') or h.get('en', '')}")
        near = blocks[max(0, idx - 3): idx + 3]
        lines.append("附近的段落（有譯文用譯文，沒譯的是原文）：\n" + "\n\n".join(f"[{b['id']}] {_block_text(b)}" for b in near))
        focus = blocks[idx]
        lines.append(f"讀者指著的段落 [{focus['id']}]：\n譯文：{_block_text(focus)}\n原文：{focus.get('en') or focus.get('caption_en') or focus.get('tex', '')}")
    if quote:
        lines.append(f"讀者選中的原話：「{quote}」")
    extra = [r for r in (refs or []) if r.get("anchor") != anchor or (r.get("quote") or "") != quote]
    if extra:
        by_id = {b.get("id"): b for b in blocks}
        parts = []
        for r in extra[:12]:
            b = by_id.get(r.get("anchor")) or {}
            q = (r.get("quote") or "").strip()
            parts.append(f"[{r.get('anchor')}] " + (f"讀者選中：「{q[:800]}」\n  所在段落：" if q else "") + _block_text(b)[:1200])
        lines.append("讀者引用了這幾處（問題可能是在問它們之間的關係）：\n" + "\n".join(parts))
    gl = paper.get("glossary", [])
    if gl:
        lines.append("術語表：" + "；".join(f"{g['en']} = {g['zh']}" for g in gl[:80]))
    return "\n\n".join(lines)


def _marks(ws: Workspace, colors: set[str] | None = None) -> str:
    """讀者的全部標記，按顏色分組；每處帶上所在段落的譯文（含 $TeX$），這樣問“紅色那些公式”也答得上。"""
    paper = ws.load("paper")
    blocks = {b.get("id"): b for b in paper.get("blocks", [])}
    order = {b.get("id"): i for i, b in enumerate(paper.get("blocks", []))}
    notes = [n for n in (ws.load("reader").get("notes") or {}).values() if not n.get("deleted")]
    if not notes:
        return ""
    notes.sort(key=lambda n: order.get(n.get("anchor"), 1e9))
    kinds = {"highlight": "劃線", "note": "筆記", "question": "問題"}
    groups: dict[str, list[str]] = {}
    shown: set[str] = set()
    for n in notes:
        color = COLOR_NAMES.get(n.get("color") or "yellow", "黃") if n.get("quote") else "無顏色"
        if colors and color not in colors:
            continue
        b = blocks.get(n.get("anchor")) or {}
        line = f"- [{n.get('anchor')}] {kinds.get(n.get('kind'), '筆記')}"
        if n.get("quote"):
            line += f"：「{n['quote']}」"
        if n.get("body"):
            line += f"；讀者寫道：{n['body'][:300]}"
        if b and b.get("id") not in shown:
            shown.add(b["id"])
            line += f"\n  所在段落：{_block_text(b)[:600]}"
        groups.setdefault(color, []).append(line)
    parts, used = [], 0
    for color in ["紅", "黃", "綠", "藍", "無顏色"]:
        for line in groups.get(color, []):
            if used > MARKS_BUDGET:
                break
            if not parts or not parts[-1].startswith(f"【{color}"):
                parts.append(f"【{color}色】" if color != "無顏色" else "【沒有顏色的筆記和問題】")
            parts.append(line)
            used += len(line)
    return ("讀者在譯文上做的標記（按顏色分組，讀者說“紅的”“黃色那些”就是指這裡；每處附所在段落譯文，行內公式是 $TeX$）：\n"
            + "\n".join(parts) + ("\n（標記太多，只列了一部分；Claude Code 可以 Read reader.json 看全部）" if used > MARKS_BUDGET else ""))


MARK_WORDS = re.compile(r"標[紅黃綠藍記了過的出注]|劃線|劃過|劃的|畫線|高亮|塗|顏色|[紅黃綠藍][色的]|筆記|批註|標記|我的問題|highlight", re.I)


def wants_marks(text: str) -> tuple[bool, set[str] | None]:
    """問題裡提到“標紅的”“劃線”“我的筆記”這類詞，才把讀者的標記帶上；提到具體顏色就只帶那幾種。"""
    if not MARK_WORDS.search(text or ""):
        return False, None
    colors = {c for c in "紅黃綠藍" if re.search(c + "[色的]|標" + c, text)}
    return True, (colors | {"無顏色"} if colors and re.search(r"筆記|問題|批註", text) else colors or None)


def _marks_summary(ws: Workspace) -> str:
    notes = [n for n in (ws.load("reader").get("notes") or {}).values() if not n.get("deleted")]
    if not notes:
        return ""
    counts: dict[str, int] = {}
    for n in notes:
        k = COLOR_NAMES.get(n.get("color") or "yellow", "黃") + "色" if n.get("quote") else "無顏色筆記"
        counts[k] = counts.get(k, 0) + 1
    return "讀者在論文上做過 " + str(len(notes)) + " 處標記（" + "、".join(f"{k} {v}" for k, v in counts.items()) + "），這次問題沒提到，就沒附上。"


def prompt(ws: Workspace, messages: list[dict], anchor: str | None, quote: str, engine: str,
           refs: list[dict] | None = None, attachment_context: str = "") -> str:
    history = messages[-HISTORY:]
    convo = "\n\n".join(("讀者" if m["role"] == "user" else "你") + "：" + m["content"] for m in history[:-1])
    ask = history[-1]["content"] if history else ""
    tool = ("需要看全文時，用 Read 工具讀當前目錄的 paper.json（blocks 裡是譯文和原文）；讀者的全部標記在 reader.json 的 notes 裡。\n"
            if engine == "claude" else "")
    want, colors = wants_marks(ask)
    marks = _marks(ws, colors) if want else _marks_summary(ws)
    return ("你在陪讀者讀一篇學術論文，回答他邊讀邊冒出來的問題。用臺灣繁體中文，直接、具體，能舉例就舉例；"
            "區分“論文裡寫了什麼”和“你的補充解釋”，論文裡沒有的內容不要說成是論文說的。"
            "行內公式寫 $TeX$，行間公式寫 $$TeX$$。提到原文位置時說“式 5”“第 4 頁那段”，不要寫 [p4-5] 這類內部編號。只輸出回答本身，不要客套，不要重複問題。\n" + tool + "\n"
            + _context(ws, anchor, quote, refs)
            + ("\n\n" + attachment_context if attachment_context else "")
            + ("\n\n" + marks if marks else "")
            + (f"\n\n之前的對話：\n{convo}" if convo else "")
            + f"\n\n讀者現在問：{ask}")


# ---------- 流式輸出 ----------
def stream(ecfg: dict, text: str, cwd: Path, cancel: threading.Event, on_model=None, meter=None,
           images: list[Path] | None = None) -> Iterator[str]:
    """on_model(實際模型名)：Claude Code 開頭會報它實際用的模型。meter：傳了就記下這次回答的 token 用量。"""
    e = ecfg.get("engine")
    bad = netcheck.problem(ecfg)
    if bad:
        raise engines.EngineError(bad)
    try:
        if e == "claude":
            yield from _stream_claude(ecfg["claude"], text, cwd, cancel, on_model, meter)
        elif e == "openai":
            yield from openai_api.stream(ecfg["openai"], text, cancel, meter, images or [])
        else:  # codex 沒有逐字輸出，整段給
            yield engines.run(ecfg, text, cwd, images or [], cancel, meter)
    except engines.EngineError as err:
        raise engines.EngineError(netcheck.explain(ecfg, str(err))) from None


def _stream_claude(c: dict, text: str, cwd: Path, cancel, on_model=None, meter=None) -> Iterator[str]:
    exe = engines.claude_path(c)
    if not exe:
        raise engines.EngineError("找不到 Claude Code 命令（先裝好並登入 Claude Code）")
    args = [exe, "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--allowedTools", "Read", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]
    if c.get("model"):
        args += ["--model", c["model"]]
    proc = engines._popen(args, cwd)
    proc.stdin.write(text)
    proc.stdin.close()
    killer = threading.Thread(target=lambda: (cancel.wait(), proc.poll() is None and proc.kill()), daemon=True)
    killer.start()
    got = False
    rate = None
    try:
        for line in proc.stdout:
            if cancel.is_set():
                raise engines.Cancelled()
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "system" and ev.get("subtype") == "init" and ev.get("model") and on_model:
                on_model(ev["model"])
            if ev.get("type") == "stream_event":
                d = (ev.get("event") or {}).get("delta") or {}
                if d.get("type") == "text_delta" and d.get("text"):
                    got = True
                    yield d["text"]
            elif ev.get("type") == "rate_limit_event":
                rate = ev
            elif ev.get("type") == "result":
                if meter is not None:
                    meter.add(**usage.from_claude(ev, rate))
                if ev.get("is_error"):
                    raise engines.EngineError("Claude Code 出錯：" + str(ev.get("result") or ev.get("subtype")))
                if not got and ev.get("result"):
                    yield ev["result"]
                return
        err = proc.stderr.read()[-400:]
        if not got:
            raise engines.EngineError(err or "Claude Code 沒有輸出")
    finally:
        if proc.poll() is None:
            proc.kill()
        cancel.set()  # 讓 killer 執行緒退出
