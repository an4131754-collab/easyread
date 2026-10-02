"""檔案讀寫：原子寫、跨程序鎖、使用者修改的合併規則。

一篇論文一個目錄，檔案按“誰寫”分開，這是互不覆蓋的根本保證：
  paper.json       翻譯方（對話裡的 agent 或背景翻譯任務）寫：原文、譯文、術語、參考文獻
  discussion.json  翻譯方寫：解釋、問答、回覆、原文核對提示
  reader.json      只由頁面經 /api/.../ops 寫：使用者改的譯文、筆記、劃線、論文筆記、進度
  item.json        只由頁面經 /api/items 寫：標籤、閱讀狀態、星標、開啟時間
"""
from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 2


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="milliseconds")


def read_json(path: Path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json_atomic(path: Path, data) -> None:
    path = Path(path)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{time.monotonic_ns()}.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:  # Windows：別的程序正在讀，稍等重試
            time.sleep(0.05 * (attempt + 1))
    os.replace(tmp, path)


@contextmanager
def dir_lock(folder: Path, name: str = ".write.lock", timeout: float = 15.0):
    """O_EXCL 建鎖檔案做跨程序互斥；超過 30 秒的舊鎖視為殘留。"""
    lock = Path(folder) / name
    start = time.time()
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            break
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > 30:
                    lock.unlink(missing_ok=True)
                    continue
            except FileNotFoundError:
                continue
            if time.time() - start > timeout:
                raise TimeoutError(f"等鎖超時：{lock}")
            time.sleep(0.05)
    try:
        yield
    finally:
        lock.unlink(missing_ok=True)


def text_hash(s: str | None) -> str:
    """和頁面 util.js 的 hashText 一致：FNV-1a 32 位，按 UTF-16 碼元。"""
    h = 0x811C9DC5
    b = (s or "").encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def file_version(path: Path) -> str:
    try:
        st = Path(path).stat()
        return f"{st.st_mtime_ns:x}-{st.st_size:x}"
    except FileNotFoundError:
        return "0"


def empty_reader() -> dict:
    return {"schema": SCHEMA, "rev": 0, "edits": {}, "notes": {}, "paper_note": {}, "progress": {}}


def empty_discussion() -> dict:
    return {"schema": SCHEMA, "entries": []}


# ---------- reader.json 的操作合併 ----------
# 每個操作冪等、帶時間戳；同一物件以較新的為準。頁面斷網時操作留在瀏覽器，恢復後重發不會重複或倒退。

def _newer(a: str | None, b: str | None) -> bool:
    return (a or "") >= (b or "")


def apply_ops(reader: dict, ops: list[dict]) -> list[str]:
    applied = []
    edits = reader.setdefault("edits", {})
    notes = reader.setdefault("notes", {})
    progress = reader.setdefault("progress", {})
    for op in ops:
        kind = op.get("op")
        at = op.get("at") or now_iso()
        if kind == "edit":
            block = str(op["block"])
            cur = edits.get(block)
            if cur and not _newer(at, cur.get("at")):
                continue
            if op.get("zh") is None:  # 恢復譯者稿：留一條撤銷記錄
                if cur:
                    edits[block] = {"reverted": True, "prev": cur.get("zh"), "at": at}
            else:
                entry = {"zh": op["zh"], "base": op.get("base", ""), "at": at}
                if cur and cur.get("zh") and cur.get("zh") != op["zh"]:
                    entry["prev"] = cur.get("zh")
                edits[block] = entry
            applied.append(f"edit:{block}")
        elif kind == "note":
            note = dict(op["note"])
            nid = str(note["id"])
            cur = notes.get(nid)
            if cur and not _newer(note.get("updated"), cur.get("updated")):
                continue
            notes[nid] = note
            applied.append(f"note:{nid}")
        elif kind == "note_del":
            nid = str(op["id"])
            cur = notes.get(nid)
            if not cur or _newer(at, cur.get("updated")):
                notes[nid] = {**(cur or {"id": nid}), "deleted": True, "updated": at}
                applied.append(f"note_del:{nid}")
        elif kind == "paper_note":
            cur = reader.get("paper_note") or {}
            if _newer(at, cur.get("at")):
                reader["paper_note"] = {"body": op.get("body", ""), "at": at}
                applied.append("paper_note")
        elif kind == "progress":
            if _newer(at, progress.get("at")):
                progress.update({"block": op.get("block"), "at": at})
                if op.get("ratio") is not None:
                    progress["ratio"] = op["ratio"]
            applied.append("progress")
    if applied:
        reader["rev"] = int(reader.get("rev", 0)) + 1
    return applied


class Workspace:
    """一篇論文的目錄。"""

    PARTS = ("paper", "discussion", "reader", "layout")

    def __init__(self, root: Path):
        self.root = Path(root).resolve()

    @property
    def id(self) -> str:
        return self.root.name

    paper_path = property(lambda s: s.root / "paper.json")
    discussion_path = property(lambda s: s.root / "discussion.json")
    reader_path = property(lambda s: s.root / "reader.json")
    item_path = property(lambda s: s.root / "item.json")
    journal_path = property(lambda s: s.root / "history" / "reader.log.jsonl")

    def load(self, name: str):
        defaults = {"reader": empty_reader(), "discussion": empty_discussion(), "layout": {}, "item": {}, "job": {}, "chat": {"messages": []}}
        return read_json(self.root / f"{name}.json", defaults.get(name))

    def versions(self) -> dict:
        v = {n: file_version(self.root / f"{n}.json") for n in self.PARTS}
        v["job"] = file_version(self.root / "job.json")
        return v

    def apply_reader_ops(self, ops: list[dict], client: str = "") -> dict:
        with dir_lock(self.root):
            reader = self.load("reader")
            applied = apply_ops(reader, ops)
            if applied:
                self._journal(ops, client)
                self._snapshot()
                write_json_atomic(self.reader_path, reader)
            return {"rev": reader.get("rev", 0), "applied": applied}

    def _journal(self, ops, client):
        self.journal_path.parent.mkdir(exist_ok=True)
        with open(self.journal_path, "a", encoding="utf-8") as f:
            for op in ops:
                f.write(json.dumps({"t": now_iso(), "client": client, **op}, ensure_ascii=False) + "\n")

    def _snapshot(self, every_seconds: int = 600):
        """reader.json 每 10 分鐘最多留一份快照，出事可以回滾。"""
        hist = self.root / "history"
        hist.mkdir(exist_ok=True)
        snaps = sorted(hist.glob("reader-*.json"))
        if snaps and time.time() - snaps[-1].stat().st_mtime < every_seconds:
            return
        if self.reader_path.exists():
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            (hist / f"reader-{stamp}.json").write_bytes(self.reader_path.read_bytes())

    def update(self, name: str, fn):
        """在鎖內讀-改-寫一個翻譯方的檔案（paper / discussion / job / item）。"""
        with dir_lock(self.root):
            data = self.load(name)
            result = fn(data)
            write_json_atomic(self.root / f"{name}.json", data)
            return result

    def patch_item(self, fields: dict) -> dict:
        allowed = {"tags", "status", "starred", "rating", "last_opened", "meta_override", "archived"}

        def apply(item):
            for k, v in fields.items():
                if k in allowed:
                    item[k] = v
            item["updated"] = now_iso()
            return item
        return self.update("item", apply)
