import http.server
import socket
import threading
import unittest
import ssl
import urllib.error
from unittest.mock import patch

from easyread import netcheck


def _api(url):
    return {"engine": "openai", "openai": {"base_url": url}}


class NetcheckTest(unittest.TestCase):
    def setUp(self):
        netcheck._ok.clear()

    def test_reachable_when_any_http_response(self):
        srv = http.server.HTTPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)  # 什麼都 501
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            self.assertIsNone(netcheck.problem(_api(f"http://127.0.0.1:{srv.server_port}/v1")))
        finally:
            srv.shutdown()

    def test_unreachable_local_says_open_it(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        msg = netcheck.problem(_api(f"http://127.0.0.1:{port}/v1"), timeout=2)
        self.assertIn("先把它開啟", msg)
        self.assertTrue(netcheck.offline(msg))

    def test_overseas_preset_mentions_vpn(self):
        t = netcheck.target({"engine": "openai", "openai": {"preset": "gemini", "base_url": "https://x.example/v1"}})
        self.assertTrue(t["vpn"])
        self.assertFalse(netcheck.target(_api("https://api.deepseek.com/v1"))["vpn"])

    def test_explain_adds_hint_only_for_network_errors(self):
        cfg = {"engine": "codex"}
        self.assertIn("梯子", netcheck.explain(cfg, "stream disconnected before completion"))
        self.assertIn("節點", netcheck.explain(cfg, "unsupported_country_region_territory"))
        self.assertEqual(netcheck.explain(cfg, "模型輸出裡沒有 JSON"), "模型輸出裡沒有 JSON")

    def test_certificate_failure_is_not_reported_as_vpn_problem(self):
        err = urllib.error.URLError(ssl.SSLCertVerificationError("CERTIFICATE_VERIFY_FAILED"))
        with patch("easyread.netcheck.http.urlopen", side_effect=err) as request:
            message = netcheck.problem({"engine": "codex"})
        self.assertIn("證書校驗失敗", message)
        self.assertNotIn("梯子", message)
        self.assertTrue(netcheck.offline(message))
        self.assertEqual(request.call_count, 1)


if __name__ == "__main__":
    unittest.main()
