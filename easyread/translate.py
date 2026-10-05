"""背景翻譯：一批幾頁交給模型，校驗後並進 paper.json。每批落盤，中斷了下次接著譯。

一批失敗會重試；還是失敗就記下來跳過，接著譯後面的頁，最後在頁面上給“重試失敗的頁”。
"""
from __future__ import annotations

import re
import threading
from concurrent.futures import ThreadPoolExecutor

from . import continuation, engines, front_context, netcheck, pdfwork, prompts, prompts_en, segments, sources
from .figures import normalize_figure, prepare_figures
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
        meta.update({"pages": pages, "page_count": len(pages), "pdf_layout_version": pdfwork.LOCATE_VERSION})
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


def _next_head(ws: Workspace, n: int, whole: bool = False) -> str:
    """下一頁開頭的抽取文字。whole：整頁都給（不能看圖的引擎在分段交界處，續文可能排在表格、圖注後面）。"""
    p = ws.root / "extract" / f"page-{n:03d}.txt"
    if not p.exists():
        return ""
    text = p.read_text(encoding="utf-8")
    return text if whole else text[:1500]


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
            normalize_figure(b)  # 截圖要等合並鎖裡 id 最終去重之後，見 prepare_figures
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


def _fill_batch(ws: Workspace, cfg: dict, batch: list[int], cancel, say, meter=None, wait=False) -> None:
    """只讀原文整理過的頁：不重排，只給已有的塊補譯文。漏譯的鍵拋錯，重試時只譯剩下的。
    沒有塊的頁（整頁是上一段的續文）要等那段有了譯文才算譯完；wait：上一頁還在別的段裡譯，先放著等全部譯完再核對。"""
    blocks = [b for b in ws.load("paper").get("blocks", []) if b.get("page") in batch]
    empty = [n for n in batch if not any(b.get("page") == n for b in blocks)]
    items = prompts_en.todo(blocks)
    if not items:
        with _merge_lock:
            fill_zh(ws, {}, [n for n in batch if n not in empty], set())
            continuation.fill_empty(ws, empty, wait)
        return
    text = engines.run(cfg, prompts_en.fill(ws, batch, items), ws.root, None, cancel, meter)
    data = engines.parse_json(text)
    if not isinstance(data, dict) or not isinstance(data.get("zh"), dict):
        raise engines.EngineError('模型輸出的格式不對（缺 zh）')
    fake = [{"id": k, "type": "para", "zh": v} for k, v in data["zh"].items() if isinstance(v, str)]
    problems = _problems({"blocks": fake})
    if problems:
        say('第 {page} 頁起有 {n} 處公式或格式問題，正在讓模型修正'.format(page=batch[0], n=len(problems)))
        try:
            fixed = engines.parse_json(engines.run(cfg, prompts.repair(prompts.dump(data), problems), ws.root, None, cancel, meter))
            if isinstance(fixed, dict) and isinstance(fixed.get("zh"), dict) and len(fixed["zh"]) >= len(data["zh"]):
                data = fixed
        except engines.EngineError as e:
            journal(ws, '第 {pages} 頁修正失敗，保留原譯：{err}'.format(pages=batch, err=e))
    with _merge_lock:
        missing = fill_zh(ws, data, [n for n in batch if n not in empty], set(items))
        _save_checks(ws, data.get("checks"), batch)
        if not missing:
            continuation.fill_empty(ws, empty, wait)
    if missing:
        raise engines.EngineError('漏譯了 {n} 處（{ids}）'.format(n=len(missing), ids=', '.join(missing[:5])))


def _one_batch(ws: Workspace, cfg: dict, batch: list[int], total_pages: int, cancel, say, meter=None, read=False,
               skip_head=False, peek=(), front=False, wait=False) -> None:
    """read：只讀原文，整理成塊但不翻譯。skip_head：上一頁由另一段同時在譯，頁首續文歸它。
    peek：分段交界處順便看一眼的相鄰頁（見 prompts.peek_note）。front：帶上前文參考（每段第一批，見 front_context）。
    wait：上一頁還沒譯好，模型返回空時先放著，等全部譯完再核對是不是續文。"""
    mode = engines.image_mode(cfg)
    images = [pdfwork.engine_image(ws.root, n) for n in sorted({*batch, *peek})] if mode != "text" else []
    nxt = batch[-1] + 1
    # 分段交界、引擎不能看圖：前一段最後一批拿下一頁全文補完跨頁那段（後一段第一批會跳過頁首續文，這裡補不全就丟了）
    head = _next_head(ws, nxt, whole=mode == "text" and nxt in peek) if nxt <= total_pages else ""
    if read:
        prompt = prompts_en.structure(ws, batch, mode, head, skip_head, peek)
    else:
        prompt = prompts.translate(ws, batch, mode, head, skip_head, peek, front_context.build(ws.root, batch[0]) if front else "")
    text = engines.run(cfg, prompt, ws.root, images, cancel, meter)
    try:
        data = engines.parse_json(text)
    except engines.EngineError:
        (ws.root / "extract" / f"failed-{batch[0]:03d}.txt").write_text(text, encoding="utf-8")
        raise
    data = _normalize(data, batch, _taken(ws, batch))
    problems = _problems(data)
    if problems:  # 給一次修的機會
        say('第 {page} 頁起有 {n} 處公式或格式問題，正在讓模型修正'.format(page=batch[0], n=len(problems)))
        try:
            fixed = engines.parse_json(engines.run(cfg, prompts.repair(prompts.dump(data), problems), ws.root, None, cancel, meter))
            fixed = _normalize(fixed, batch, _taken(ws, batch))
            if fixed["blocks"] and len(_problems(fixed)) < len(problems):
                data = fixed
        except engines.EngineError as e:
            journal(ws, '第 {pages} 頁修正失敗，保留原譯：{err}'.format(pages=batch, err=e))
    with _merge_lock:
        # 整頁都是參考文獻時只有 references，沒有新塊，也算譯完；整批都是跨頁續文、已经並進上一段時也不用重複輸出
        if not data["blocks"] and not data.get("references") and not continuation.covered(ws, batch, read):
            if wait:
                raise continuation.WaitPrev(batch, read, lambda: merge_blocks(ws, {"blocks": []}, done=batch, replace_pages=batch, en_only=read))
            raise engines.EngineError('模型沒有整理出任何內容' if read else '模型沒有譯出任何內容')
        data = _normalize(data, batch, _taken(ws, batch))  # 並行時別的批可能刚占用了同名 id
        prepare_figures(ws.root, data["blocks"], total_pages)
        drop = _one_references(ws, data, batch)
        merge_blocks(ws, data, done=batch, replace_pages=batch, en_only=read, drop_ids=drop)
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
    """分批：只把連續的頁放一批（續傳時中間隔著已譯的頁，跨頁續文對不上）；只讀原文整理過的頁（補譯文）和要從頭譯的頁不混在一批裡。"""
    out: list[list[int]] = []
    for n in pages:
        if out and n == out[-1][-1] + 1 and len(out[-1]) < size and (out[-1][0] in en_pages) == (n in en_pages):
            out[-1].append(n)
        else:
            out.append([n])
    return out


def translate_pages(ws: Workspace, cfg: dict, pages: list[int], cancel, report, meter=None, read=False) -> dict[int, str]:
    """翻譯給定的頁（已完成的頁會重譯並替換；只讀原文整理過的頁就地補譯文）。report(done, total, message)；
    meter 收集 token 用量。read：只讀原文，把頁整理成塊但不翻譯。返回沒做成的頁 {頁碼: 原因}。"""
    cfg = engines.for_translation(cfg)  # 本機 CLI 不加載使用者的 MCP、多餘的工具定義（問 AI 不走這裡）
    paper = ws.load("paper")
    total_pages = paper.get("meta", {}).get("page_count") or 0
    en_pages = set() if read else set(paper.get("translation", {}).get("en_pages", []))
    size = max(1, int(cfg.get("batch_pages") or 2))
    # 分段並行：切成幾段連續的頁同時譯，段內一批接一批（見 segments.py）
    k = segments.workers(cfg.get("concurrency"), len(_batches(pages, size, en_pages)))
    lanes = [_batches(seg, size, en_pages) for seg in segments.plan(pages, size, k, ws.root)]
    batches = [b for lane in lanes for b in lane]
    verb = '正在整理原文' if read else '正在翻譯'
    workers = max(1, len(lanes))
    job_pages = set(pages)
    had = set(paper.get("translation", {}).get("done_pages", [])) - en_pages  # 開譯前已经有譯文的頁
    lane_of = {n: i for i, lane in enumerate(lanes) for b in lane for n in b}
    state = {"done": 0, "active": set(), "quota": "", "ok": set(), "later": []}  # ok：這次已经做成的頁；later：等全部譯完再核對的續文
    failed: dict[int, str] = {}
    lock = threading.Lock()
    bad = netcheck.problem(cfg)
    if bad:
        raise engines.EngineError(bad)
    journal(ws, ('只讀原文（不翻譯）' if read else "") + '開始：{pages} 頁，{batches} 批，引擎 {engine}，並行 {workers}'.format(pages=len(pages), batches=len(batches), engine=engines.engine_name(cfg.get('engine')), workers=workers))

    def label(batch):
        return '第 {a}–{b} 頁'.format(a=batch[0], b=batch[-1]) if len(batch) > 1 else '第 {page} 頁'.format(page=batch[0])

    if workers > 1:
        journal(ws, '分 {n} 段同時譯：{ranges}'.format(n=workers, ranges='、'.join((label(sorted({lane[0][0], lane[-1][-1]})) for lane in lanes))))

    def say(msg=None):
        with lock:
            active = sorted(state["active"])
            text = msg or (verb + '、'.join(label(b) for b in active) if active else verb)
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
            p = batch[0] - 1  # 上一頁這次也要譯、還沒譯好（在別的段裡同時譯）：跨頁那段歸它，這批跳過頁首續文
            skip_head = p in job_pages and p not in state["ok"] and p not in en_pages
            # 交界兩邊都看一眼相鄰頁的原頁圖：後一段第一批看上一頁末尾，前一段最後一批看下一頁開頭
            q = batch[-1] + 1
            # 下一頁存在、不在本段（別的段在譯，或者斷點續傳時已经譯過、跳過了頁首續文）：本批負責把跨頁那段補完整
            owner = q <= total_pages and lane_of.get(q) != lane_of[batch[-1]] and q not in en_pages
            peek = ([p] if skip_head else []) + ([q] if owner else [])
            # 每段第一批、上一頁還沒有譯文（同時在別的段裡譯，或從沒譯過）：給原文的前文參考
            front = batch is lanes[lane_of[batch[0]]][0] and batch[0] > 1 and (p not in had or skip_head)
            wait = p in job_pages and p not in state["ok"]  # 上一頁這次也要譯、還沒做成：返回空時現在核對不了續文
        say()
        err = None
        for attempt in range(2):
            try:
                if batch[0] in en_pages:
                    _fill_batch(ws, cfg, batch, cancel, say, meter, wait)
                else:
                    _one_batch(ws, cfg, batch, total_pages, cancel, say, meter, read, skip_head, peek, front, wait)
                with lock:
                    state["ok"].update(batch)
                journal(ws, '{pages} 完成'.format(pages=label(batch)))
                err = None
                break
            except continuation.WaitPrev as e:
                with lock:
                    state["ok"].update(n for n in batch if n not in e.pages)
                    # 核對不上時再譯一次（相當於失敗重試，只是挪到最後）：那時上一頁已经譯完，不用再跳過頁首續文
                    # 補譯文的頁不用：沒有塊要譯，只等所屬段落有譯文
                    retry = None if batch[0] in en_pages else (
                        lambda: _one_batch(ws, cfg, batch, total_pages, cancel, say, meter, read, False, [q] if owner else [], False))
                    state["later"].append((e, retry))
                journal(ws, '{pages} 沒有新內容，等上一頁譯完再核對是不是上一段的續文'.format(pages=label(e.pages)))
                err = None
                break
            except engines.Cancelled:
                raise
            except Exception as e:  # noqa: BLE001
                err = str(e) if isinstance(e, engines.EngineError) else f"{type(e).__name__}: {e}"
                journal(ws, '{pages} 第 {n} 次失敗：{err}'.format(pages=label(batch), n=attempt + 1, err=err[:500]))
                log.warning("翻譯失敗 %s %s: %s", ws.id, batch, err[:300])
                if cancel.is_set():
                    raise engines.Cancelled()
                if _QUOTA.search(err) or netcheck.offline(err):
                    state["quota"] = err[:300]
                    journal(ws, '額度用完或連不上，停止翻譯剩下的頁')
                    break
        with lock:
            state["active"].discard(tuple(batch))
            state["done"] += len(batch)
            if err:
                for n in batch:
                    failed[n] = err[:300]
        say()

    def run_lane(lane):
        for batch in lane:
            if cancel.is_set():
                return
            work(batch)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(run_lane, lane) for lane in lanes]
        for f in futures:
            f.result()  # Cancelled 在這裡拋出去
    if cancel.is_set():
        raise engines.Cancelled()
    for e, retry in sorted(state["later"], key=lambda x: x[0].pages[0]):  # 按頁序：連著幾批都是續文時，前一批先記完成
        err = continuation.settle(ws, e, _merge_lock, None if state["quota"] else retry, lambda m: journal(ws, f"{label(e.pages)} {m}"))
        failed.update(dict.fromkeys(e.pages, err) if err else {})
        state["ok"].update([] if err else e.pages)
        journal(ws, '{pages} 失敗：{err}'.format(pages=label(e.pages), err=err) if err else '{pages} 完成'.format(pages=label(e.pages)))
    journal(ws, '結束，{n} 頁失敗：{pages}'.format(n=len(failed), pages=sorted(failed)) if failed else '結束，全部成功')
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


def _one_references(ws: Workspace, data: dict, batch: list[int]) -> list[str]:
    """全文只留一個“參考文獻”塊（頁面上它會把整張參考文獻表畫出來，兩個就畫兩遍）。
    參考文獻跨了幾批（分段並行時可能兩段各起一個）時留頁碼最早的那個；這批的更早，就接過已有那塊的 id
    （掛在上面的筆記還掛得住），返回要在合並時一並刪掉的舊塊 id。在合並鎖裡調。"""
    mine = [b for b in data["blocks"] if b.get("type") == "references"]
    if not mine:
        return []
    others = [b for b in ws.load("paper").get("blocks", []) if b.get("type") == "references" and b.get("page") not in batch]
    keep = min(mine, key=lambda b: b.get("page") or 0)
    data["blocks"] = [b for b in data["blocks"] if b.get("type") != "references" or b is keep]
    if not others:
        return []
    if min(b.get("page") or 0 for b in others) <= (keep.get("page") or 0):
        data["blocks"].remove(keep)
        return []
    keep["id"] = others[0]["id"]
    return [b["id"] for b in others]
