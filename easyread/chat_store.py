"""“問 AI”的對話記錄：每篇論文一個 chat.json，裡面可以有多個對話（像聊天客戶端那樣新建、切換、刪除）。

{"threads": [{"id", "title", "model", "created", "updated",
              "messages": [{"role": "user", "content", "anchor", "quote", "note", "at"},
                           {"role": "assistant", "id", "content", "model", "anchor", "note", "at"}]}]}
舊版只有一個頂層 "messages"，讀的時候當成第一個對話。
"""
from __future__ import annotations

from uuid import uuid4

from .paperdata import add_discussion
from .store import Workspace, now_iso


def _normalize(chat: dict) -> dict:
    if chat is None:
        chat = {}
    threads = chat.setdefault("threads", [])
    legacy = chat.pop("messages", None)
    if legacy:
        threads.insert(0, {"id": "t-first", "title": _title(legacy[0].get("content", "")), "model": "",
                           "created": legacy[0].get("at", ""), "updated": legacy[-1].get("at", ""), "messages": legacy})
    return chat


def _title(q: str, attachments: list[dict] | None = None) -> str:
    q = " ".join((q or "").split())
    if not q and attachments and all(a.get("kind") == "image" for a in attachments):
        q = str(attachments[0].get("name") or "")
    return (q[:22] + "…") if len(q) > 22 else (q or "新對話")


def threads(ws: Workspace) -> list[dict]:
    """最近用過的在前。"""
    return sorted(_normalize(ws.load("chat")).get("threads", []), key=lambda t: t.get("updated", ""), reverse=True)


def get(ws: Workspace, tid: str | None) -> dict | None:
    return next((t for t in threads(ws) if t["id"] == tid), None) if tid else None


def new_id() -> str:
    return "t" + uuid4().hex


def append(ws: Workspace, tid: str, user: dict, answer: str, model_id: str, model_name: str, used: dict | None = None, pending: bool = False) -> dict:
    """存一問一答；對話不存在就新建（標題取第一個問題）。回答頁邊筆記裡的問題時，同時寫成那條筆記的回覆。"""
    stamp = now_iso()
    msg = {"id": "m" + uuid4().hex, "role": "assistant", "content": answer, "at": stamp,
           "model": model_name, "anchor": user.get("anchor"), "note": user.get("note")}
    if pending:
        msg["pending"] = True
    if used and used.get("calls"):
        msg["usage"] = used  # 這條回答的 token 用量（usage.Meter 的快照）

    def apply(chat):
        _normalize(chat)
        t = next((x for x in chat["threads"] if x["id"] == tid), None)
        if not t:
            t = {"id": tid, "title": _title(user["content"], user.get("attachments")), "created": stamp, "messages": []}
            chat["threads"].append(t)
        t["messages"] += [{**user, "role": "user", "at": stamp}, msg]
        t.update(updated=stamp, model=model_id)
    ws.update("chat", apply)
    if not pending:
        _reply(ws, user.get("note"), answer, model_name)
    return msg


def _reply(ws, note_id, answer, model_name):
    if note_id and answer.strip():
        disc = ws.load("discussion").get("entries", [])
        old = next((d for d in disc if d.get("reply_to") == note_id and d.get("kind") == "reply" and d.get("live")), None)
        entry = {"reply_to": note_id, "kind": "reply", "body": answer.strip(), "by": model_name, "live": True}
        if old:
            entry["id"] = old["id"]
        add_discussion(ws, [entry])


def finish(ws: Workspace, tid: str, mid: str, answer: str, used: dict | None = None, error: str = "") -> dict:
    """Finish the already saved turn, without adding another user message."""
    result = {}
    def apply(data):
        t = next((t for t in _normalize(data)["threads"] if t["id"] == tid), None)
        if not t:  # A deleted conversation must not be resurrected.
            return
        msg = next((m for m in t["messages"] if m.get("id") == mid), None)
        if not msg:
            return
        msg.pop("pending", None)
        msg.update(content=answer)
        if error:
            msg["error"] = error
        if used and used.get("calls"):
            msg["usage"] = used
        t["updated"] = now_iso()
        result.update(msg)
    ws.update("chat", apply)
    if result and not error:
        _reply(ws, result.get("note"), answer, result.get("model", ""))
    return result


def rename(ws: Workspace, tid: str, title: str) -> None:
    def apply(chat):
        for t in _normalize(chat)["threads"]:
            if t["id"] == tid:
                t["title"] = (title or "").strip()[:60] or t["title"]
    ws.update("chat", apply)


def delete(ws: Workspace, tid: str) -> None:
    ws.update("chat", lambda chat: _normalize(chat).update(threads=[t for t in chat["threads"] if t["id"] != tid]))


def pin(ws: Workspace, tid: str, mid: str) -> None:
    """把一條回答放到頁邊，成為那段旁邊的一條 AI 討論。"""
    t = get(ws, tid)
    msgs = (t or {}).get("messages", [])
    i = next((k for k, m in enumerate(msgs) if m.get("id") == mid and m.get("role") == "assistant"), None)
    if i is None:
        raise KeyError(mid)
    ans, q = msgs[i], (msgs[i - 1] if i and msgs[i - 1].get("role") == "user" else {})
    blocks = {b.get("id") for b in ws.load("paper").get("blocks", [])}
    entry = {"kind": "qa", "q": q.get("content", ""), "body": ans["content"], "by": ans.get("model", "")}
    if ans.get("anchor") in blocks:
        entry["anchor"] = ans["anchor"]
    add_discussion(ws, [entry])
