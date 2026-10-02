"""背景翻譯：一批幾頁交給模型，校驗後並進 paper.json。每批落盤，中斷了下次接著譯。

一批失敗會重試；還是失敗就記下來跳過，接著譯後面的頁，最後在頁面上給“重試失敗的頁”。
"""
from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor

from . import engines, netcheck, pdfwork, prompts, prompts_en, sources
from .checks import block_problems, tex_problems
from .log import log
from .paperdata import add_discussion, fill_zh, merge_blocks, set_block_text
from .store import Workspace, now_iso

_merge_lock = threading.Lock()  # 併發翻譯時，併入 paper.json 和重算原頁定位一次只做一個
# 用量到頂、餘額不足這類錯誤，後面的批次也一定失敗：直接停，剩下的頁記為沒譯，等額度恢復後一鍵重試
_QUOTA = re.compile(r"session limit|usage limit|rate limit reached|insufficient_quota|餘額不足|額度|介面返回 40[12]", re.I)
_REF_LINE = re.compile(r"^\s*(\d+\.?\s*)?(references|bibliography|參考文獻)\s*$", re.I | re.M)


def prepare(ws: Workspace) -> None:
    pages = pdfwork.prepare(ws.root)
    extra = {}
    try:  # 本地拖進來的 PDF：從第一頁的 arXiv 編號或 DOI 補上作者、年份、出處
        first = ws.root / "extract" / "page-001.txt"
        if first.exists():
            extra = sources.enrich(first.read_text(encoding="utf-8", errors="replace"), ws.load("paper").get("meta", {}))
    except Exception:  # noqa: BLE001
        log.exception("補後設資料失敗 %s", ws.id)

    def apply(paper):
        meta = paper.setdefault("meta", {})
        meta.update({"pages": pages, "page_count": len(pages)})
        for k, v in extra.items():
            if not meta.get(k) or (k == "title_en" and meta.get(k) == meta.get("source", "").removesuffix(".pdf")):
                meta[k] = v
    ws.update("paper", apply)


def references_page(ws: Workspace) -> int | None:
    """參考文獻從哪一頁開始（找單獨成行的 References 標題）。找不到返回 None。"""
    n = ws.load("paper").get("meta", {}).get("page_count") or 0
    for p in range(2, n + 1):
        f = ws.root / "extract" / f"page-{p:03d}.txt"
        if f.exists() and _REF_LINE.search(f.read_text(encoding="utf-8", errors="replace")):
            return p
    return None


def scope_pages(ws: Workspace, scope: str | None) -> list[int] | None:
    """翻譯範圍：all 全文；body 到參考文獻那頁為止；range:A-B 第 A 到 B 頁；first:N 前 N 頁（舊寫法）。返回 None 表示全文。"""
    n = ws.load("paper").get("meta", {}).get("page_count") or 0
    if scope == "body":
        ref = references_page(ws)
        return list(range(1, ref + 1)) if ref else None
    if scope and scope.startswith("range:"):
        a, _, b = scope.split(":", 1)[1].partition("-")
        start, end = sorted((int(a or 1), int(b or n)))
        lo, hi = max(1, start), min(n, end)
        if lo > hi:
            raise ValueError(f"指定頁碼超出了論文範圍（共 {n} 頁）")
        return list(range(lo, hi + 1))
    if scope and scope.startswith("first:"):
        k = int(scope.split(":", 1)[1] or 0)
        return list(range(1, min(n, k) + 1)) if k > 0 else None
    return None


def _next_head(ws: Workspace, n: int) -> str:
    p = ws.root / "extract" / f"page-{n:03d}.txt"
    return p.read_text(encoding="utf-8")[:1500] if p.exists() else ""


def _normalize(data: dict, pages: list[int], taken: set[str]) -> dict:
    """補頁碼、去掉和已有塊撞車的 id、丟掉明顯無效的塊。"""
    if isinstance(data, list):
        data = {"blocks": data}
    blocks = []
    for b in data.get("blocks") or []:
        if not isinstance(b, dict) or not b.get("type"):
            continue
        b.setdefault("page", pages[0])
        try:
            b["page"] = int(b["page"])
        except (TypeError, ValueError):
            b["page"] = pages[0]
        bid = re.sub(r"[^A-Za-z0-9_\-]", "-", str(b.get("id") or f"p{b['page']}-{len(blocks) + 1}"))
        base, k = bid, 2
        while bid in taken:
            bid = f"{base}-{k}"
            k += 1
        taken.add(bid)
        b["id"] = bid
        if b["type"] == "figure":
            b.setdefault("src", "")
        blocks.append(b)
    data["blocks"] = blocks
    return data


def _taken(ws: Workspace, batch: list[int]) -> set[str]:
    return {b["id"] for b in ws.load("paper").get("blocks", []) if b.get("page") not in batch}


def _problems(data: dict) -> list[str]:
    problems, tex = block_problems(data["blocks"])
    return problems + tex_problems(tex)


def journal(ws: Workspace, line: str) -> None:
    """每篇論文自己的翻譯記錄 job.log，頁面上“檢視記錄”看的就是它。"""
    with open(ws.root / "job.log", "a", encoding="utf-8") as f:
        f.write(f"{now_iso()[:19].replace('T', ' ')}  {line}\n")


def _fill_batch(ws: Workspace, cfg: dict, batch: list[int], cancel, say, meter=None) -> None:
    """只讀原文整理過的頁：不重排，只給已有的塊補譯文。漏譯的鍵拋錯，重試時只譯剩下的。"""
    items = prompts_en.todo([b for b in ws.load("paper").get("blocks", []) if b.get("page") in batch])
    if not items:
        fill_zh(ws, {}, batch, set())
        return
    text = engines.run(cfg, prompts_en.fill(ws, batch, items), ws.root, None, cancel, meter)
    data = engines.parse_json(text)
    if not isinstance(data, dict) or not isinstance(data.get("zh"), dict):
        raise engines.EngineError("模型輸出的格式不對（缺 zh）")
    fake = [{"id": k, "type": "para", "zh": v} for k, v in data["zh"].items() if isinstance(v, str)]
    problems = _problems({"blocks": fake})
    if problems:
        say(f"第 {batch[0]} 頁起有 {len(problems)} 處公式或格式問題，正在讓模型修正")
        try:
            fixed = engines.parse_json(engines.run(cfg, prompts.repair(prompts.dump(data), problems), ws.root, None, cancel, meter))
            if isinstance(fixed, dict) and isinstance(fixed.get("zh"), dict) and len(fixed["zh"]) >= len(data["zh"]):
                data = fixed
        except engines.EngineError as e:
            journal(ws, f"第 {batch} 頁修正失敗，保留原譯：{e}")
    with _merge_lock:
        missing = fill_zh(ws, data, batch, set(items))
        _save_checks(ws, data.get("checks"), batch)
    if missing:
        raise engines.EngineError(f"漏譯了 {len(missing)} 處（{', '.join(missing[:5])}）")


def _one_batch(ws: Workspace, cfg: dict, batch: list[int], total_pages: int, cancel, say, meter=None, read=False) -> None:
    """read：只讀原文，整理成塊但不翻譯。"""
    mode = engines.image_mode(cfg)
    images = [pdfwork.engine_image(ws.root, n) for n in batch] if mode != "text" else []
    nxt = batch[-1] + 1
    head = _next_head(ws, nxt) if nxt <= total_pages else ""
    prompt = (prompts_en.structure if read else prompts.translate)(ws, batch, mode, head)
    text = engines.run(cfg, prompt, ws.root, images, cancel, meter)
    try:
        data = engines.parse_json(text)
    except engines.EngineError:
        (ws.root / "extract" / f"failed-{batch[0]:03d}.txt").write_text(text, encoding="utf-8")
        raise
    data = _normalize(data, batch, _taken(ws, batch))
    problems = _problems(data)
    if problems:  # 給一次修的機會
        say(f"第 {batch[0]} 頁起有 {len(problems)} 處公式或格式問題，正在讓模型修正")
        try:
            fixed = engines.parse_json(engines.run(cfg, prompts.repair(prompts.dump(data), problems), ws.root, None, cancel, meter))
            fixed = _normalize(fixed, batch, _taken(ws, batch))
            if fixed["blocks"] and len(_problems(fixed)) < len(problems):
                data = fixed
        except engines.EngineError as e:
            journal(ws, f"第 {batch} 頁修正失敗，保留原譯：{e}")
    if not data["blocks"] and not data.get("references"):  # 整頁都是參考文獻時只有 references，沒有新塊，也算譯完
        raise engines.EngineError("模型沒有" + ("整理" if read else "譯") + "出任何內容")
    with _merge_lock:
        data = _normalize(data, batch, _taken(ws, batch))  # 併發時別的批可能剛佔用了同名 id
        merge_blocks(ws, data, done=batch, replace_pages=batch, en_only=read)
        _save_checks(ws, data.get("checks"), batch)
        try:
            pdfwork.locate(ws.root)
        except Exception:  # noqa: BLE001 —— 定位失敗不影響閱讀
            log.exception("locate 失敗 %s", ws.id)


def _save_checks(ws: Workspace, checks, batch: list[int]) -> None:
    """模型發現的原文問題 → 頁邊的“原文核對提示”。重譯這幾頁時，先去掉上次翻譯留下的那幾條。"""
    pages = {b["id"]: b.get("page") for b in ws.load("paper").get("blocks", [])}
    old = [e["id"] for e in ws.load("discussion").get("entries", [])
           if e.get("kind") == "check" and e.get("by") == "translator" and pages.get(e.get("anchor")) in batch]
    if old:
        ws.update("discussion", lambda d: d.__setitem__("entries", [e for e in d["entries"] if e.get("id") not in old]))
    items = [{"kind": "check", "by": "translator", "anchor": c["anchor"], "quote": str(c.get("quote") or "")[:200],
              "title": str(c.get("title") or "")[:80], "body": str(c["body"])}
             for c in (checks or []) if isinstance(c, dict) and c.get("anchor") in pages and str(c.get("body") or "").strip()]
    if items:
        try:
            add_discussion(ws, items)
        except ValueError as e:
            journal(ws, f"核對提示沒存上：{e}")


def _batches(pages: list[int], size: int, en_pages: set[int]) -> list[list[int]]:
    """分批；只讀原文整理過的頁（補譯文）和要從頭譯的頁不混在一批裡。"""
    out: list[list[int]] = []
    for n in pages:
        if out and len(out[-1]) < size and (out[-1][0] in en_pages) == (n in en_pages):
            out[-1].append(n)
        else:
            out.append([n])
    return out


def translate_pages(ws: Workspace, cfg: dict, pages: list[int], cancel, report, meter=None, read=False) -> dict[int, str]:
    """翻譯給定的頁（已完成的頁會重譯並替換；只讀原文整理過的頁就地補譯文）。report(done, total, message)；
    meter 收集 token 用量。read：只讀原文，把頁整理成塊但不翻譯。返回沒做成的頁 {頁碼: 原因}。"""
    paper = ws.load("paper")
    total_pages = paper.get("meta", {}).get("page_count") or 0
    en_pages = set() if read else set(paper.get("translation", {}).get("en_pages", []))
    size = max(1, int(cfg.get("batch_pages") or 2))
    batches = _batches(pages, size, en_pages)
    verb = "正在整理原文" if read else "正在翻譯"
    workers = max(1, min(8, int(cfg.get("concurrency") or 1)))
    state = {"done": 0, "active": set(), "quota": ""}
    failed: dict[int, str] = {}
    lock = threading.Lock()
    bad = netcheck.problem(cfg)
    if bad:
        raise engines.EngineError(bad)
    journal(ws, ("只讀原文（不翻譯）" if read else "") + f"開始：{len(pages)} 頁，{len(batches)} 批，引擎 {engines.ENGINE_NAMES.get(cfg.get('engine'), cfg.get('engine'))}，併發 {workers}")

    def label(batch):
        return f"第 {batch[0]}–{batch[-1]} 頁" if len(batch) > 1 else f"第 {batch[0]} 頁"

    def say(msg=None):
        with lock:
            active = sorted(state["active"])
            text = msg or (verb + "、".join(label(b) for b in active) if active else verb)
            report(state["done"], len(pages), text)

    def work(batch):
        if cancel.is_set():
            return
        if state["quota"]:  # 額度用完了，不再白跑
            with lock:
                state["done"] += len(batch)
                for n in batch:
                    failed[n] = state["quota"]
            return
        with lock:
            state["active"].add(tuple(batch))
        say()
        err = None
        for attempt in range(2):
            try:
                if batch[0] in en_pages:
                    _fill_batch(ws, cfg, batch, cancel, say, meter)
                else:
                    _one_batch(ws, cfg, batch, total_pages, cancel, say, meter, read)
                journal(ws, f"{label(batch)} 完成")
                err = None
                break
            except engines.Cancelled:
                raise
            except Exception as e:  # noqa: BLE001
                err = str(e) if isinstance(e, engines.EngineError) else f"{type(e).__name__}: {e}"
                journal(ws, f"{label(batch)} 第 {attempt + 1} 次失敗：{err[:500]}")
                log.warning("翻譯失敗 %s %s: %s", ws.id, batch, err[:300])
                if cancel.is_set():
                    raise engines.Cancelled()
                if _QUOTA.search(err) or netcheck.offline(err):
                    state["quota"] = err[:300]
                    journal(ws, "額度用完或連不上，停止翻譯剩下的頁")
                    break
        with lock:
            state["active"].discard(tuple(batch))
            state["done"] += len(batch)
            if err:
                for n in batch:
                    failed[n] = err[:300]
        say()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(work, b) for b in batches]
        for f in futures:
            f.result()  # Cancelled 在這裡丟擲去
    if cancel.is_set():
        raise engines.Cancelled()
    journal(ws, "結束" + (f"，{len(failed)} 頁失敗：{sorted(failed)}" if failed else "，全部成功"))
    return failed


def answer(ws: Workspace, cfg: dict, note_id: str, cancel) -> None:
    note = ws.load("reader").get("notes", {}).get(note_id)
    if not note:
        raise KeyError(note_id)
    text = engines.run(cfg, prompts.answer(ws, note), ws.root, None, cancel).strip()
    if not text:
        raise engines.EngineError("模型沒有給出回答")
    add_discussion(ws, [{"reply_to": note_id, "kind": "reply", "body": text, "by": engines.who(cfg)}])


def retranslate(ws: Workspace, cfg: dict, key: str, hint: str, cancel) -> None:
    data = engines.parse_json(engines.run(cfg, prompts.retranslate(ws, key, hint), ws.root, None, cancel))
    zh = (data or {}).get("zh", "").strip() if isinstance(data, dict) else ""
    if not zh:
        raise engines.EngineError("模型沒有給出新譯文")
    set_block_text(ws, key, zh)
