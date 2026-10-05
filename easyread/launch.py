"""啟動本地服務：只監聽 127.0.0.1，記下地址給命令列複用；start.cmd / start.sh 啟動時頁面都關了就退出。"""
from __future__ import annotations

import os
import threading
import webbrowser
from http.server import ThreadingHTTPServer

from . import __version__, config, detect, reader_files
from .log import log, setup as setup_log
from .presence import Presence
from .server import App, Handler
from .store import now_iso, read_json, write_json_atomic


class _Server(ThreadingHTTPServer):
    # Windows 上 SO_REUSEADDR 會讓兩個程序同時佔住 8765，瀏覽器隨機連到其中一個（比如舊版本）
    allow_reuse_address = os.name != "nt"
    daemon_threads = True  # 更新關閉時，不被閒置連線或頁面的 WebSocket 卡住。


def serve(port: int | None = None, open_browser: bool = False, path: str = "/", exit_on_close: bool = False):
    """exit_on_close：start.cmd / start.sh 啟動時為真，頁面都關了、背景任務也做完了就退出。"""
    setup_log(config.LOG_PATH)
    cfg = config.load()
    app = App(cfg)
    Handler.app = app
    detect.warm(cfg)
    port = cfg["port"] if port is None else port
    try:
        httpd = _Server(("127.0.0.1", port), Handler)
    except OSError:
        httpd = _Server(("127.0.0.1", 0), Handler)
    url = f"http://127.0.0.1:{httpd.server_address[1]}"
    app.presence = Presence(lambda: app.jobs.busy() or reader_files.busy() or app.active_posts > 0, httpd.shutdown, exit_on_close)
    if not config.temp_library():
        write_json_atomic(config.SERVER_INFO, {"url": url, "pid": os.getpid(), "started": now_iso()})
    log.info("EasyRead %s 已啟動：%s  文獻庫：%s", __version__, url, app.lib.root)
    print(f"EasyRead 已啟動：{url}  文獻庫：{app.lib.root}", flush=True)
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url + path)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        if not config.temp_library() and (read_json(config.SERVER_INFO, {}) or {}).get("pid") == os.getpid():
            config.SERVER_INFO.unlink(missing_ok=True)  # 下次 easyread 命令不會去連一個已經關掉的服務
