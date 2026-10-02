"""文獻庫：一個目錄裡放多篇論文，每篇一個子目錄（目錄名就是 id，取 PDF 的 SHA-256 前 12 位）。"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import time
from datetime import datetime
from pathlib import Path

from . import sources
from .log import log
from .store import SCHEMA, Workspace, empty_discussion, empty_reader, now_iso, read_json, write_json_atomic



def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Library:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def ws(self, pid: str) -> Workspace | None:
        if not re.fullmatch(r"[A-Za-z0-9_\-]{4,64}", pid or ""):
            return None
        p = self.root / pid
        return Workspace(p) if (p / "paper.json").exists() else None

    def all(self) -> list[Workspace]:
        return [Workspace(p) for p in sorted(self.root.iterdir()) if p.is_dir() and not p.name.startswith(".") and (p / "paper.json").exists()]

    # ---------- 列表摘要 ----------
    def summary(self, ws: Workspace) -> dict:
        paper = ws.load("paper") or {}
        meta = dict(paper.get("meta", {}))
        item = ws.load("item") or {}
        meta.update({k: v for k, v in (item.get("meta_override") or {}).items() if v})
        reader = ws.load("reader") or {}
        disc = ws.load("discussion") or {}
        job = ws.load("job") or {}
        tr = paper.get("translation", {})
        notes = [n for n in reader.get("notes", {}).values() if not n.get("deleted")]
        replied = {e.get("reply_to") for e in disc.get("entries", []) if e.get("reply_to")}
        abstract = next((b.get("zh") or b.get("en") for b in paper.get("blocks", []) if b.get("role") == "abstract"), "") or meta.get("abstract_en", "")
        return {
            "id": ws.id,
            "title_zh": meta.get("title_zh", ""), "title_en": meta.get("title_en", ""), "short_zh": meta.get("short_zh", ""),
            "authors": meta.get("authors", ""), "affiliation": meta.get("affiliation", ""),
            "year": meta.get("year") or _year(meta.get("date", "")), "date": meta.get("date", ""),
            "venue": meta.get("venue", ""), "arxiv": meta.get("arxiv", ""), "url": _link(meta), "doi": meta.get("doi", ""),
            "pages": meta.get("page_count", 0), "done_pages": len(tr.get("done_pages", [])), "en_pages": len(tr.get("en_pages", [])),
            "abstract": abstract,
            "meta_override": item.get("meta_override") or {},
            "tags": item.get("tags", []), "status": item.get("status", "unread"), "starred": bool(item.get("starred")),
            "added": item.get("added", ""), "last_opened": item.get("last_opened", ""),
            "progress": (reader.get("progress") or {}).get("ratio", 0),
            "notes": len([n for n in notes if n.get("kind") != "highlight"]),
            "highlights": len([n for n in notes if n.get("kind") == "highlight"]),
            "open_questions": len([n for n in notes if n.get("kind") == "question" and n["id"] not in replied]),
            "discussions": len(disc.get("entries", [])),
            "has_paper_note": bool((reader.get("paper_note") or {}).get("body")),
            "job": {k: job.get(k) for k in ("type", "state", "message", "done", "total", "updated", "error", "failed", "scope", "usage", "usage_total")} if job else None,
            "thumb": f"/p/{ws.id}/pages/page-001.webp" if (ws.root / "pages" / "page-001.webp").exists() else "",
        }

    def list(self) -> list[dict]:
        return [self.summary(ws) for ws in self.all()]

    # ---------- 匯入 ----------
    def create_from_pdf(self, data: bytes, filename: str, meta: dict | None = None) -> tuple[Workspace, bool]:
        """建目錄、落 PDF 和空資料檔案。渲染原頁、抽文字放到背景任務裡做。返回 (目錄, 是否新建)。"""
        if not data.startswith(b"%PDF"):
            raise ValueError("不是 PDF 檔案")
        digest = sha256_bytes(data)
        pid = digest[:12]
        ws = Workspace(self.root / pid)
        if (ws.root / "paper.json").exists():
            return ws, False
        ws.root.mkdir(parents=True, exist_ok=True)
        (ws.root / "source.pdf").write_bytes(data)
        base_meta = {"title_zh": "", "title_en": "", "authors": "", "source": filename, "source_sha256": digest, "pdf": "source.pdf"}
        base_meta.update(meta or {})
        if not base_meta.get("title_en"):
            base_meta["title_en"] = _pdf_title(ws.root / "source.pdf") or Path(filename).stem
        write_json_atomic(ws.paper_path, {
            "schema": SCHEMA, "meta": base_meta,
            "translation": {"scope": "未開始", "done_pages": [], "note": ""},
            "glossary": [], "references": [], "blocks": [],
        })
        write_json_atomic(ws.discussion_path, empty_discussion())
        write_json_atomic(ws.reader_path, empty_reader())
        write_json_atomic(ws.item_path, {"added": now_iso(), "tags": [], "status": "unread", "starred": False})
        return ws, True

    def fetch(self, ref: str) -> tuple[bytes, str, dict]:
        """連結、arXiv 編號、DOI、標題 → (PDF, 檔名, 後設資料)。見 sources.py。"""
        try:
            return sources.fetch(ref)
        except sources.SourceError as e:
            log.warning("匯入失敗 %s：%s", ref[:200], e)  # 使用者說“某個連結導不進來”時能查到原因
            raise

    def trash(self, pid: str) -> Path:
        ws = self.ws(pid)
        if not ws:
            raise KeyError(pid)
        dest = self.root / ".trash" / f"{pid}-{datetime.now():%Y%m%d%H%M%S}"
        dest.parent.mkdir(exist_ok=True)
        # 只整體改名，不用 shutil.move：改名失敗時它會退回“複製再刪”，刪到一半出錯就剩半個目錄。
        # 剛取消的翻譯要零點幾秒才停下（Claude Code 程序的工作目錄就在這裡），多等幾次
        for attempt in range(20):
            try:
                ws.root.rename(dest)
                return dest
            except PermissionError:
                if attempt == 19:
                    raise ValueError("這篇論文的檔案還被佔用著（可能正在翻譯或生成圖片），等幾秒再刪") from None
                time.sleep(0.25)
        return dest

    def find_by_sha(self, digest: str) -> Workspace | None:
        return self.ws(digest[:12])


def _year(date: str) -> str:
    m = re.search(r"(19|20)\d{2}", date or "")
    return m.group(0) if m else ""


def _pdf_title(path: Path) -> str:
    try:
        import pypdf
        t = (pypdf.PdfReader(str(path)).metadata or {}).get("/Title", "") or ""
        return str(t).strip()
    except Exception:  # noqa: BLE001
        return ""


def migrate_folder(src: Path, lib: Library) -> Workspace:
    """把舊版技能生成的“xxx-共讀”目錄搬進文獻庫。"""
    src = Path(src)
    data = (src / "source.pdf").read_bytes()
    pid = sha256_bytes(data)[:12]
    dest = lib.root / pid
    if not dest.exists():
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns("server.json", "*.html", "開啟共讀.cmd", ".write.lock"))
    ws = Workspace(dest)
    if not ws.item_path.exists():
        write_json_atomic(ws.item_path, {"added": now_iso(), "tags": [], "status": "reading", "starred": False})
    reader = read_json(ws.reader_path, {}) or {}
    reader.setdefault("paper_note", {})
    write_json_atomic(ws.reader_path, reader)
    return ws



def _link(meta: dict) -> str:
    """論文主頁連結：填了就用；否則由 arXiv 編號或 DOI 推出來。"""
    if meta.get("url"):
        return meta["url"]
    m = sources.ARXIV_RE.search(meta.get("arxiv") or meta.get("source") or "")
    if m and (meta.get("arxiv") or re.fullmatch(r"\d{4}\.\d{4,5}(v\d+)?\.pdf", meta.get("source") or "")):
        aid = re.sub(r"v\d+$", "", m.group(1))  # f-string 裡不能有反斜槓（Python 3.10/3.11）
        return f"https://arxiv.org/abs/{aid}"
    return f"https://doi.org/{meta['doi']}" if meta.get("doi") else ""

if __name__ == "__main__":  # 除錯用：列印庫摘要
    import sys
    print(json.dumps(Library(Path(sys.argv[1])).list(), ensure_ascii=False, indent=1))
