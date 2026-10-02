"""命令列。給人用，也給對話裡的 agent 用（它在對話裡翻譯、追加討論時走這些命令）。

  easyread serve [--open] [--port N] [--exit-on-close]   啟動（或複用已在跑的）服務
  easyread list                           列出文獻庫
  easyread import 論文.pdf|arXiv編號 [--no-translate]
  easyread translate ID [--pages 3-5]     排隊翻譯（需要服務在跑；否則直接前臺譯）
  easyread status ID                      譯文進度、使用者改過的譯文、筆記、待回答的問題
  easyread blocks ID --from 批次.json [--done 4-6] [--replace]
  easyread discuss ID --from 討論.json | --delete 討論ID
  easyread check ID                       檢查塊、引用、TeX
  easyread locate ID                      重新計算原頁高亮位置
  easyread export ID                      匯出單檔案離線 HTML
  easyread demo ID --out docs/demo        做成網站上的線上演示（圖片另存、帶問 AI 記錄）
  easyread merge ID --from 匯出.json       把離線版頁面匯出的修改並回文獻庫
  easyread migrate 舊的“xxx-共讀”目錄      把舊版技能生成的目錄搬進文獻庫
ID 可以寫開頭幾位，能唯一確定就行。
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import urllib.request
from pathlib import Path

from . import config, paperdata, pdfwork
from .checks import check
from .library import Library, migrate_folder
from .store import read_json, text_hash


def out(s=""):
    sys.stdout.write(s + "\n")


def lib() -> Library:
    return Library(config.library_dir())


def find(pid: str):
    matches = [ws for ws in lib().all() if ws.id.startswith(pid)]
    if len(matches) != 1:
        sys.exit(f"找不到唯一的論文：{pid}（匹配 {len(matches)} 篇）")
    return matches[0]


def running_server() -> str | None:
    info = read_json(config.SERVER_INFO, {}) or {}
    if not info.get("url"):
        return None
    try:
        urllib.request.urlopen(info["url"] + "/api/config", timeout=1.5)
        return info["url"]
    except Exception:  # noqa: BLE001
        return None


def cmd_serve(a):
    url = None if (a.port is not None or config.temp_library()) else running_server()
    if url:
        out(f"服務已在執行：{url}")
        if not a.exit_on_close:  # 要常駐的服務：那個服務若是 start.cmd 起的、關頁會退出，讓它改成常駐
            try:
                token = json.loads(urllib.request.urlopen(url + "/api/library").read())["token"]
                urllib.request.urlopen(urllib.request.Request(url + "/api/presence/keep", data=b"{}", headers={"X-Token": token}))
            except Exception:  # noqa: BLE001
                pass
        if a.open:
            import webbrowser
            webbrowser.open(url)
        return
    from .launch import serve
    serve(a.port, a.open, exit_on_close=a.exit_on_close)


def cmd_list(a):
    for s in lib().list():
        job = s.get("job") or {}
        out(f"{s['id']}  {s['title_zh'] or s['title_en']}  [{s['done_pages']}/{s['pages']} 頁] {job.get('state', '')} {job.get('message', '')}")


def cmd_import(a):
    L = lib()
    src = a.source
    if Path(src).exists():
        ws, fresh = L.create_from_pdf(Path(src).read_bytes(), Path(src).name)
    else:
        data, name, meta = L.fetch(src)
        ws, fresh = L.create_from_pdf(data, name, meta)
    if not fresh and ws.load("paper").get("meta", {}).get("pages"):
        out(f"已在庫裡：{ws.id}")
        return
    from .translate import prepare
    prepare(ws)
    out(f"{'已匯入' if fresh else '已重新準備'}：{ws.id}（{ws.root}）")
    if not a.no_translate:
        cmd_translate(argparse.Namespace(id=ws.id, pages=None))


def cmd_translate(a):
    ws = find(a.id)
    url = running_server()
    pages = paperdata.parse_pages(a.pages) if a.pages else None
    if url:
        try:
            token = json.loads(urllib.request.urlopen(url + "/api/library").read())["token"]
            req = urllib.request.Request(f"{url}/api/p/{ws.id}/translate", data=json.dumps({"pages": pages}).encode(),
                                         headers={"X-Token": token, "Content-Type": "application/json"})
            urllib.request.urlopen(req)
            out("已交給服務排隊翻譯，進度在文獻庫頁面上看。")
            return
        except OSError:  # 服務剛好在退出：就在這裡譯
            pass
    from .translate import translate_pages
    cfg = config.load()
    paper = ws.load("paper")
    done = set(paper.get("translation", {}).get("done_pages", []))
    pages = pages or [p["n"] for p in paper["meta"]["pages"] if p["n"] not in done]
    failed = translate_pages(ws, cfg, pages, threading.Event(), lambda d, t, m: out(f"[{d}/{t}] {m}"))
    if failed:
        out(f"沒譯成功的頁：{sorted(failed)}，原因見 {ws.root / 'job.log'}")


def cmd_status(a):
    ws = find(a.id)
    paper, reader, disc = ws.load("paper"), ws.load("reader"), ws.load("discussion")
    blocks = {b["id"]: b for b in paper.get("blocks", []) if b.get("id")}
    tr = paper.get("translation", {})
    out(f"# {paper.get('meta', {}).get('title_zh') or paper.get('meta', {}).get('title_en')}  ({ws.id})")
    out(f"目錄：{ws.root}")
    out(f"譯文範圍：{tr.get('scope')}；已完成頁 {tr.get('done_pages')}")
    job = ws.load("job") or {}
    if job:
        out(f"背景任務：{job.get('state')} {job.get('message')} {job.get('error', '')}")
    edits = {k: v for k, v in reader.get("edits", {}).items() if v.get("zh") is not None}
    out(f"\n## 使用者改過的譯文（{len(edits)}）")
    for key, e in edits.items():
        bid, _, field = key.partition("#")
        b = blocks.get(bid, {})
        agent = b.get("caption_zh") if field == "caption" else (b.get("items", [{}] * 99)[int(field)].get("zh") if field.isdigit() else b.get("zh", ""))
        stale = " [譯者稿在使用者修改後又變過]" if e.get("base") and e["base"] != text_hash(agent) else ""
        out(f"- {key}{stale}\n  使用者：{e['zh']}\n  譯者：{agent}")
    notes = [n for n in reader.get("notes", {}).values() if not n.get("deleted")]
    replied = {e.get("reply_to") for e in disc.get("entries", []) if e.get("reply_to")}
    out(f"\n## 使用者筆記與劃線（{len(notes)}）")
    for n in sorted(notes, key=lambda n: n.get("created", "")):
        flag = (" [已回覆]" if n["id"] in replied else " [待回答]") if n.get("kind") == "question" else ""
        quote = f"「{n['quote']}」" if n.get("quote") else ""
        out(f"- {n['id']} · {n.get('kind')}{flag} · 塊 {n.get('anchor')} {quote}\n  {(n.get('body') or '').strip()}")
    pn = (reader.get("paper_note") or {}).get("body")
    if pn:
        out(f"\n## 論文筆記\n{pn}")
    out(f"\n## 討論條目：{len(disc.get('entries', []))}")


def cmd_blocks(a):
    ws = find(a.id)
    data = json.loads(Path(a.from_file).read_text(encoding="utf-8"))
    replace = paperdata.parse_pages(a.done) if a.replace and a.done else None
    r = paperdata.merge_blocks(ws, data, done=a.done, replace_pages=replace)
    out(f"paper.json：新增 {r['new']} 塊，替換 {r['updated']} 塊；已完成頁 {r['done_pages']}")


def cmd_discuss(a):
    ws = find(a.id)
    if a.delete:
        out(f"刪除 {paperdata.delete_discussion(ws, a.delete)} 條")
        return
    items = json.loads(Path(a.from_file).read_text(encoding="utf-8"))
    n_new, n_upd = paperdata.add_discussion(ws, items)
    out(f"討論：新增 {n_new} 條，更新 {n_upd} 條。頁面幾秒內自動出現。")


def cmd_check(a):
    r = check(find(a.id))
    out(f"塊 {r['blocks']} 個；公式 {r['tex']} 處；未完成頁 {r['missing_pages'] or '無'}")
    if r["problems"]:
        out("問題：\n" + "\n".join(f"- {p}" for p in r["problems"]))
        sys.exit(1)
    out("檢查通過")


def cmd_locate(a):
    layout = pdfwork.locate(find(a.id).root)
    out(f"定位 {len(layout)} 個塊")


def cmd_export(a):
    from .build import build
    out(str(build(find(a.id))))


def cmd_demo(a):
    from .site import build_demo
    out(str(build_demo(find(a.id), Path(a.out), credit=a.credit or "")))


def cmd_merge(a):
    data = json.loads(Path(a.from_file).read_text(encoding="utf-8"))
    ops = data.get("ops") if isinstance(data, dict) else data
    r = find(a.id).apply_reader_ops(ops or [], client="merge")
    out(f"併入 {len(r['applied'])} 個操作")


def cmd_migrate(a):
    ws = migrate_folder(Path(a.folder), lib())
    out(f"已搬入文獻庫：{ws.id}（{ws.root}）")


def main(argv=None):
    if sys.stdout is None:  # pythonw 啟動時沒有控制台
        import os
        sys.stdout = sys.stderr = open(os.devnull, "w", encoding="utf-8")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="easyread", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("serve"); p.add_argument("--open", action="store_true"); p.add_argument("--port", type=int)
    p.add_argument("--exit-on-close", action="store_true", help="頁面都關了、背景任務做完後自動退出（start.cmd / start.sh 用）")
    p.set_defaults(fn=cmd_serve)
    p = sub.add_parser("list"); p.set_defaults(fn=cmd_list)
    p = sub.add_parser("import"); p.add_argument("source"); p.add_argument("--no-translate", action="store_true"); p.set_defaults(fn=cmd_import)
    p = sub.add_parser("translate"); p.add_argument("id"); p.add_argument("--pages"); p.set_defaults(fn=cmd_translate)
    for name, fn in (("status", cmd_status), ("check", cmd_check), ("locate", cmd_locate), ("export", cmd_export)):
        p = sub.add_parser(name); p.add_argument("id"); p.set_defaults(fn=fn)
    p = sub.add_parser("blocks"); p.add_argument("id"); p.add_argument("--from", dest="from_file", required=True)
    p.add_argument("--done"); p.add_argument("--replace", action="store_true"); p.set_defaults(fn=cmd_blocks)
    p = sub.add_parser("discuss"); p.add_argument("id"); p.add_argument("--from", dest="from_file"); p.add_argument("--delete")
    p.set_defaults(fn=cmd_discuss)
    p = sub.add_parser("merge"); p.add_argument("id"); p.add_argument("--from", dest="from_file", required=True); p.set_defaults(fn=cmd_merge)
    p = sub.add_parser("demo"); p.add_argument("id"); p.add_argument("--out", default="docs/demo"); p.add_argument("--credit", help="署名和許可說明")
    p.set_defaults(fn=cmd_demo)
    p = sub.add_parser("migrate"); p.add_argument("folder"); p.set_defaults(fn=cmd_migrate)
    a = ap.parse_args(argv)
    if not a.cmd:  # 直接執行 easyread：啟動並開啟瀏覽器
        a = ap.parse_args(["serve", "--open"])
    if a.cmd == "discuss" and not (a.from_file or a.delete):
        ap.error("discuss 需要 --from 或 --delete")
    a.fn(a)
