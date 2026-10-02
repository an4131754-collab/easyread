"""背景任務：匯入後的渲染與整篇翻譯（一條佇列，狀態落在每篇的 job.json，重啟後接著做），
以及“讓模型回答我的問題 / 重譯這段”這類小任務（另一條佇列，不用等整篇翻譯）。"""
from __future__ import annotations

import queue
import threading
import time
from uuid import uuid4

from . import chat_models, config, translate, usage
from .engines import Cancelled, EngineError
from .library import Library
from .log import log
from .store import Workspace, now_iso


def engine_for(cfg: dict, model: str | None) -> dict:
    """匯入時選了“問 AI”名單裡的模型就用它，否則用設定裡的翻譯引擎。名單裡已經沒有這個模型了，也用翻譯引擎。"""
    m = next((x for x in chat_models.models(cfg) if x.get("id") == model), None) if model else None
    if not m:
        return cfg
    out, _ = chat_models.engine_cfg(cfg, model)
    o = cfg.get("openai") or {}
    if m["engine"] == "openai" and m.get("preset") == o.get("preset") and (m.get("model") or o.get("model")) == o.get("model"):
        out["openai"]["vision"] = o.get("vision", False)  # 和翻譯引擎是同一個模型：沿用“模型能看圖”
    return out


class Jobs:
    def __init__(self, lib: Library):
        self.lib = lib
        self.bulk: queue.Queue[str] = queue.Queue()
        self.small: queue.Queue[dict] = queue.Queue()
        self.cancels: dict[str, threading.Event] = {}
        self.recent: list[dict] = []  # 小任務的狀態，給頁面輪詢
        self.lock = threading.Lock()
        self._resume()
        for target in (self._bulk_loop, self._small_loop):
            threading.Thread(target=target, daemon=True).start()

    # ---------- 整篇 ----------
    def _write(self, ws: Workspace, **fields):
        def apply(job):
            job.update(fields)
            job["updated"] = now_iso()
        ws.update("job", apply)

    def enqueue(self, ws: Workspace, pages: list[int] | None = None, translate_after: bool = True, scope: str | None = None,
                read: bool = False, model: str = ""):
        """pages=None：按 scope（all / body / range:A-B / first:N）翻譯還沒譯的頁。
        read：只讀原文，用模型把頁整理成段落、公式、表格，不翻譯；之後再翻譯時就地補中文。
        model：用“問 AI”名單裡的哪個模型（匯入時選的）；空著用設定裡的翻譯引擎。"""
        def apply(job):
            if job.get("state") in ("queued", "running"):
                raise ValueError("這篇論文已有任務在排隊或執行，請等它結束，或先取消再重試。")
            job.update(type="read" if read and translate_after else "translate" if translate_after else "prepare",
                       state="queued", message="排隊中", pages=pages, scope=scope or "all", translate=translate_after, read=read, model=model or "",
                       done=0, total=0, error="", failed={}, updated=now_iso(), usage={})
        with self.lock:
            ws.update("job", apply)
            self.bulk.put(ws.id)

    def cancel(self, pid: str):
        with self.lock:
            ev = self.cancels.get(pid)
            if ev:
                ev.set()
            ws = self.lib.ws(pid)
            if ws and (ws.load("job") or {}).get("state") == "queued":
                self._write(ws, state="cancelled", message="已取消")

    def _resume(self):
        for ws in self.lib.all():
            job = ws.load("job") or {}
            if job.get("state") in ("queued", "running"):
                self._write(ws, state="queued", message="排隊中（服務重啟後繼續）")
                self.bulk.put(ws.id)

    def _bulk_loop(self):
        while True:
            pid = self.bulk.get()
            with self.lock:
                ws = self.lib.ws(pid)
                if not ws:
                    continue
                job = ws.load("job") or {}
                if job.get("state") != "queued":
                    continue
                cancel = self.cancels[pid] = threading.Event()
                self._write(ws, state="running", message="正在開始任務")
            try:
                self._run_bulk(ws, job, cancel)
            except Cancelled:
                self._write(ws, state="cancelled", message="已取消，已譯的部分保留")
            except Exception as e:  # noqa: BLE001
                msg = str(e) if isinstance(e, (EngineError, KeyError, ValueError)) else f"{type(e).__name__}: {e}"
                self._write(ws, state="error", message="出錯了", error=msg[:800])
                log.exception("背景任務出錯 %s", pid)
                try:
                    translate.journal(ws, f"出錯停止：{msg[:500]}")
                except OSError:
                    pass
            finally:
                with self.lock:
                    self.cancels.pop(pid, None)

    def _run_bulk(self, ws: Workspace, job: dict, cancel: threading.Event):
        cfg = engine_for(config.load(), job.get("model"))
        if cancel.is_set():
            raise Cancelled()
        if not ws.load("paper").get("meta", {}).get("pages"):
            self._write(ws, state="running", message="正在渲染原頁、抽取文字")
            translate.prepare(ws)
        if cancel.is_set():
            raise Cancelled()
        read = bool(job.get("read"))
        if not job.get("translate") or cfg.get("engine") == "none":
            self._write(ws, state="done", message="已匯入" + ("（沒有可用的模型，先放原頁）" if read else "（未開啟自動翻譯）" if job.get("translate") else ""))
            return
        paper = ws.load("paper")
        all_pages = [p["n"] for p in paper["meta"]["pages"]]
        tr = paper.get("translation", {})
        # 只讀原文：跳過已經整理過（或已經譯過）的頁；翻譯：跳過已經有譯文的頁，只有原文的頁會補譯文
        skip = set(tr.get("done_pages", [])) if read else set(tr.get("done_pages", [])) - set(tr.get("en_pages", []))
        wanted = job.get("pages") or translate.scope_pages(ws, job.get("scope")) or all_pages
        pages = wanted if job.get("pages") else [n for n in wanted if n not in skip]
        if not pages:
            self._write(ws, state="done", message="選定範圍已" + ("整理完" if read else "譯完"))
            return

        meter = usage.Meter(cfg.get("engine") or "")

        def report(done, total, message):
            if cancel.is_set():
                raise Cancelled()
            self._write(ws, state="running", done=done, total=total, message=message, usage=meter.snapshot())

        started = time.time()
        try:
            failed = translate.translate_pages(ws, cfg, pages, cancel, report, meter, read)
        finally:  # 取消、出錯也把已經花掉的記上
            run = meter.snapshot()
            if run["calls"]:
                ws.update("job", lambda j: j.update(usage=run, usage_total=usage.merge(j.get("usage_total"), run)))
        minutes = max(1, round((time.time() - started) / 60))
        if failed:
            first = next(iter(failed.values()))
            self._write(ws, state="partial", failed={str(k): v for k, v in failed.items()}, error=first,
                        message=(f"{len(pages) - len(failed)} 頁好了，" if len(failed) < len(pages) else "") + f"{len(failed)} 頁沒" + ("整理" if read else "譯") + "成功")
        else:
            self._write(ws, state="done", failed={}, error="",
                        message=("原文整理完成" if read else "翻譯完成") + f"（{len(pages)} 頁，用時約 {minutes} 分鐘）")

    # ---------- 小任務 ----------
    def submit_small(self, kind: str, pid: str, **kw) -> dict:
        job = {"id": "j" + uuid4().hex, "kind": kind, "pid": pid, "state": "queued", "message": "排隊中",
               "at": now_iso(), **kw}
        with self.lock:
            self.recent = ([job] + self.recent)[:50]
        self.small.put(job)
        return job

    def small_status(self, pid: str | None = None) -> list[dict]:
        with self.lock:
            return [dict(j) for j in self.recent if not pid or j["pid"] == pid]

    def busy(self) -> bool:
        """還有整篇翻譯或小任務沒做完（關頁自動退出時要等它們）。"""
        if self.cancels or not self.bulk.empty() or not self.small.empty():
            return True
        with self.lock:
            return any(j["state"] in ("queued", "running") for j in self.recent)

    def _small_loop(self):
        while True:
            job = self.small.get()
            ws = self.lib.ws(job["pid"])
            if not ws:
                job["state"], job["message"] = "error", "文獻已移除，無法執行任務"
                continue
            job["state"], job["message"] = "running", "模型思考中"
            try:
                cfg = config.load()
                if job["kind"] == "answer":
                    translate.answer(ws, cfg, job["note"], None)
                elif job["kind"] == "retranslate":
                    translate.retranslate(ws, cfg, job["key"], job.get("hint", ""), None)
                job["state"], job["message"] = "done", "完成"
            except Exception as e:  # noqa: BLE001
                job["state"], job["message"] = "error", str(e)[:500]
                log.exception("小任務出錯 %s", job.get("kind"))
