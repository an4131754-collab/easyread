"""關掉頁面後自動退出（只在 start.cmd / start.sh 啟動時開）。

每個文獻庫頁、閱讀頁都連著一條 WebSocket（見 wsock.py）。最後一個頁面關掉後，
等一會兒（重新整理、在文獻庫和閱讀頁之間跳轉時，新頁面幾秒內就會連上來）還是沒有頁面，
並且沒有翻譯、回答問題之類的背景任務在跑，就退出服務。背景任務沒做完時先不退，做完再退。

命令列 `easyread serve`（agent 用的）和桌面版不開這個，服務一直跑。
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable

from .log import log

GRACE = 15        # 最後一個頁面斷開後再等多久
FIRST_WAIT = 120  # 啟動後一直沒有頁面連上來（瀏覽器沒開啟之類），等多久


class Presence:
    def __init__(self, busy: Callable[[], bool], stop: Callable[[], None], enabled: bool,
                 grace: float = GRACE, first_wait: float = FIRST_WAIT, tick: float = 1.0):
        self.busy, self.stop, self.enabled = busy, stop, enabled
        self.grace, self.first_wait, self.tick = grace, first_wait, tick
        self.pages = 0
        self.seen = False  # 有沒有頁面連上來過
        self.lock = threading.Lock()
        self.idle_since: float | None = time.monotonic()
        if enabled:
            threading.Thread(target=self._watch, daemon=True).start()

    def enter(self) -> None:
        with self.lock:
            self.pages += 1
            self.seen = True

    def leave(self) -> None:
        with self.lock:
            self.pages = max(0, self.pages - 1)

    def keep(self) -> None:
        """有人用 `easyread serve` 要一個常駐的服務、卻複用了這個會自動退出的：從此不再自動退出。"""
        if self.enabled:
            log.info("改為常駐，不再在頁面關掉後自動退出")
        self.enabled = False

    def should_stop(self, now: float) -> bool:
        with self.lock:
            idle = self.pages == 0
            wait = self.grace if self.seen else self.first_wait
        if not idle or self.busy():
            self.idle_since = None
            return False
        if self.idle_since is None:
            self.idle_since = now
        return now - self.idle_since >= wait

    def _watch(self) -> None:
        while self.enabled:
            time.sleep(self.tick)
            if self.enabled and self.should_stop(time.monotonic()):
                log.info("頁面都關了，背景沒有任務在跑，退出服務")
                self.stop()
                return
