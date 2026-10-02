"""關掉頁面後自動退出：WebSocket 握手和斷開、等待時間、有背景任務時不退。  python -m unittest tests.test_presence"""
import base64
import os
import socket
import tempfile
import threading
import time
import unittest

from easyread import launch, presence, server


def _ws_connect(port: int, origin: str | None = None) -> tuple[socket.socket, bytes]:
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    head = (f"GET /api/presence HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n" + (f"Origin: {origin}\r\n" if origin else "") + "\r\n")
    s.sendall(head.encode())
    return s, s.recv(1024)


class PresenceRuleTest(unittest.TestCase):
    def make(self, busy=False):
        self.busy = busy
        return presence.Presence(lambda: self.busy, lambda: None, enabled=False, grace=10, first_wait=100)

    def test_waits_longer_before_first_page(self):
        p = self.make()
        t0 = p.idle_since
        self.assertFalse(p.should_stop(t0 + 50))
        self.assertTrue(p.should_stop(t0 + 101))

    def test_grace_after_last_page_closes(self):
        p = self.make()
        p.enter(); p.enter()
        self.assertFalse(p.should_stop(1000))
        p.leave()
        self.assertFalse(p.should_stop(1001))  # 還有一個頁面
        p.leave()
        self.assertFalse(p.should_stop(1002))  # 剛關，開始計時
        p.enter()  # 重新整理：新頁面連上來
        self.assertFalse(p.should_stop(1020))
        p.leave()
        self.assertFalse(p.should_stop(1021))
        self.assertTrue(p.should_stop(1032))

    def test_busy_blocks_exit(self):
        p = self.make(busy=True)
        p.enter(); p.leave()
        self.assertFalse(p.should_stop(1000))
        self.assertFalse(p.should_stop(5000))
        self.busy = False  # 任務做完，從這時起再等 grace
        self.assertFalse(p.should_stop(5001))
        self.assertTrue(p.should_stop(5012))


class ServerExitTest(unittest.TestCase):
    def setUp(self):
        os.environ["EASYREAD_LIBRARY"] = tempfile.mkdtemp()
        self.app = server.App(server.config.load())
        server.Handler.app = self.app
        self.httpd = launch._Server(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.stopped = threading.Event()

        def stop():
            self.stopped.set()
            self.httpd.shutdown()
        self.app.presence = presence.Presence(self.app.jobs.busy, stop, enabled=True, grace=0.5, first_wait=30, tick=0.1)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        if not self.stopped.is_set():
            self.app.presence.enabled = False
            self.httpd.shutdown()
        self.httpd.server_close()
        os.environ.pop("EASYREAD_LIBRARY", None)

    def test_exits_after_last_page_closes(self):
        a, resp_a = _ws_connect(self.port, f"http://127.0.0.1:{self.port}")
        b, _ = _ws_connect(self.port)
        self.assertIn(b"101", resp_a.split(b"\r\n")[0])
        time.sleep(0.3)
        self.assertEqual(self.app.presence.pages, 2)
        a.sendall(bytes([0x88, 0x80]) + os.urandom(4))  # 正常關閉幀（帶掩碼、無內容）
        self.assertEqual(a.recv(16)[:1], b"\x88")  # 服務回了關閉幀
        a.close()
        time.sleep(1.0)
        self.assertFalse(self.stopped.is_set())  # 還有一個頁面開著
        b.close()  # 直接斷開（瀏覽器被殺掉）
        self.assertTrue(self.stopped.wait(3))

    def test_other_site_rejected(self):
        s, resp = _ws_connect(self.port, "http://evil.example")
        s.close()
        self.assertIn(b"403", resp.split(b"\r\n")[0])

    def test_keep_turns_off_auto_exit(self):
        import json
        import urllib.request
        url = f"http://127.0.0.1:{self.port}"
        token = json.loads(urllib.request.urlopen(url + "/api/library").read())["token"]
        urllib.request.urlopen(urllib.request.Request(url + "/api/presence/keep", data=b"{}", headers={"X-Token": token}))
        a, _ = _ws_connect(self.port)
        a.close()
        self.assertFalse(self.stopped.wait(1.5))


if __name__ == "__main__":
    unittest.main()
