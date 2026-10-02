"""論文筆記的 AI 幫手：點評、幫我改、起草稿。

和“問 AI”對話分開：結果直接流回筆記面板，不進對話記錄；由讀者決定要不要替換或追加到筆記裡。
輸出格式和對話一樣：一行一個 JSON，{"t": 片段} … 最後 {"done": true} 或 {"error": …}。
"""
from __future__ import annotations

import json
import threading

from . import chat, chat_models, config, engines
from .log import log
from .prompts import _block_text
from .store import Workspace

PAPER_BUDGET = 14000  # 不能自己讀檔案的引擎：隨提示詞附上的譯文字數上限

ASK = {
    "review": ("請點評這份筆記：哪些理解是準確的；哪些地方和論文不符或理解有誤（說清論文實際怎麼說、在哪一節）；"
               "漏掉了哪些重要內容；還可以往哪想。直接、具體，分條寫，不要客套，不要重寫整份筆記。"),
    "revise": ("請幫讀者修改這份筆記：保留他的觀點、結構和口吻，修正和論文不符的地方，補上明顯漏掉的要點，把表達理順。"
               "只輸出修改後的完整筆記（Markdown，公式寫 $TeX$），不要解釋改了什麼。"),
    "draft": ("讀者還沒寫筆記。請幫他起一個讀書筆記草稿，留出他自己思考的空間：核心問題、方法要點、主要結論、"
              "侷限或疑問（這一項只列問題，不替他下結論）。用 Markdown，簡潔，公式寫 $TeX$。只輸出筆記本身。"),
}


def _paper_text(ws: Workspace) -> str:
    out, used = [], 0
    for b in ws.load("paper").get("blocks", []):
        if b.get("type") == "references":
            break
        t = _block_text(b) if b.get("type") != "heading" else "\n## " + (b.get("zh") or b.get("en") or "")
        if not t:
            continue
        if used + len(t) > PAPER_BUDGET:
            out.append("……（後面的內容略）")
            break
        out.append(t)
        used += len(t)
    return "\n".join(out)


def prompt(ws: Workspace, mode: str, note: str, engine: str) -> str:
    meta = ws.load("paper").get("meta", {})
    title = meta.get("title_zh") or meta.get("title_en") or ""
    paper = ("論文全文在當前目錄的 paper.json 裡（blocks 裡是譯文和原文），需要核對時用 Read 工具去讀。"
             if engine == "claude" else "論文譯文（節選）：\n" + _paper_text(ws))
    return (f"你在幫讀者整理讀論文《{title}》的筆記。請使用繁體中文。{ASK[mode]}\n\n{paper}\n\n"
            + (f"讀者的筆記：\n<<<\n{note}\n>>>" if note.strip() else ""))


def handle(handler, ws: Workspace, body: dict) -> None:
    """server.py 裡 POST /api/p/<id>/notehelp 調這裡；handler 是那次請求的 BaseHTTPRequestHandler。"""
    mode = body.get("mode")
    note = str(body.get("note") or "")[:20000]
    if mode not in ASK:
        raise ValueError("mode 只能是 review / revise / draft")
    if mode != "draft" and not note.strip():
        raise ValueError("筆記還是空的")
    ecfg, m = chat_models.engine_cfg(config.load(), body.get("model"))
    text = prompt(ws, mode, note, ecfg["engine"])
    handler.send_response(200)
    handler.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Connection", "close")
    handler.end_headers()
    handler.close_connection = True
    cancel = threading.Event()

    def send(obj):
        handler.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
        handler.wfile.flush()
    try:
        send({"model": chat_models.label(m)})
        for piece in chat.stream(ecfg, text, ws.root, cancel):
            send({"t": piece})
        send({"done": True})
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        cancel.set()  # 讀者點了停止或關了頁面
    except engines.Cancelled:
        pass
    except Exception as e:  # noqa: BLE001
        log.exception("筆記幫手出錯 %s", ws.id)
        try:
            send({"error": str(e)[:500]})
        except OSError:
            pass
