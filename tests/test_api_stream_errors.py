"""流式 API：不把推理文本或中途失敗的回答當成最終答案。"""
import io
import json
import threading
import unittest
import urllib.error
from email.utils import formatdate
from unittest.mock import patch

from easyread import openai_api
from easyread.engines import Cancelled, EngineError


def sse(events, done=False):
    data = b"".join(("data: " + json.dumps(e) + "\n\n").encode() for e in events)
    return io.BytesIO(data + (b"data: [DONE]\n\n" if done else b""))


class APIStreamErrorsTest(unittest.TestCase):
    def run_stream(self, response, api="chat"):
        options = {"base_url": "http://example.invalid/v1", "model": "fake", "api": api}
        with patch.object(openai_api, "_open", return_value=response):
            return "".join(openai_api.stream(options, "問題", threading.Event()))

    def test_think_tags_at_every_chunk_boundary(self):
        text = "前文<think>不應顯示</think>回答<think>第二次思考</think>後文"
        expected = "前文回答後文"
        for split in range(len(text) + 1):
            with self.subTest(split=split):
                self.assertEqual("".join(openai_api._strip_think(iter([text[:split], text[split:]]))), expected)
        self.assertEqual("".join(openai_api._strip_think(iter(text))), expected)

    def test_unclosed_think_is_hidden_but_plain_angles_survive(self):
        for chunks, expected in [(["答", "<think>私密", "內容"], "答"), (["x <", " y", "<thi"], "x < y<thi")]:
            self.assertEqual("".join(openai_api._strip_think(iter(chunks))), expected)

    def test_chat_terminal_errors_and_unexpected_eof(self):
        first = {"choices": [{"delta": {"content": "部分回答"}}]}
        for end, message in [({"choices": [{"finish_reason": "length"}]}, "截斷"),
                             ({"choices": [{"finish_reason": "content_filter"}]}, "過濾"),
                             ({"error": {"message": "quota exceeded"}}, "quota exceeded"),
                             (None, "提前結束")]:
            response = sse([first] + ([end] if end else []), done=bool(end))
            with self.subTest(end=end), self.assertRaisesRegex(EngineError, message):
                self.run_stream(response)
            self.assertTrue(response.closed)

    def test_responses_terminal_errors_and_unexpected_eof(self):
        first = {"type": "response.output_text.delta", "delta": "部分回答"}
        for end, message in [({"type": "response.incomplete", "response": {"incomplete_details": {"reason": "max_output_tokens"}}}, "截斷"),
                             ({"type": "response.incomplete", "response": {"incomplete_details": {"reason": "content_filter"}}}, "未完成"),
                             ({"type": "response.failed", "response": {"error": {"message": "upstream failed"}}}, "upstream failed"),
                             ({"type": "error", "message": "bad request"}, "bad request"),
                             (None, "提前結束")]:
            response = sse([first] + ([end] if end else []), done=bool(end))
            with self.subTest(end=end), self.assertRaisesRegex(EngineError, message):
                self.run_stream(response, "responses")
            self.assertTrue(response.closed)

    def test_valid_completion_markers(self):
        for api, events, done in [
            ("chat", [{"choices": [{"delta": {"content": "好"}}]}], True),
            ("chat", [{"choices": [{"delta": {"content": "好"}, "finish_reason": "stop"}]}], False),
            ("responses", [{"type": "response.output_text.delta", "delta": "好"}, {"type": "response.completed"}], False),
        ]:
            response = sse(events, done)
            self.assertEqual(self.run_stream(response, api), "好")
            self.assertTrue(response.closed)

    def test_multiline_sse_data_and_comments(self):
        response = io.BytesIO(b': ping\r\nevent: message\r\ndata: {"choices": [\r\ndata: {"delta": {"content": "ok"}}]}\r\n\r\ndata: [DONE]\r\n\r\n')
        self.assertEqual(self.run_stream(response), "ok")

    def test_relay_framing_without_blank_lines(self):
        delta = b'data: {"choices": [{"delta": {"content": "ok"}}]}'
        stop = b'data: {"choices": [{"delta": {}, "finish_reason": "stop"}]}'
        for name, payload in [("事件之間只隔一個換行", delta + b"\n" + stop + b"\ndata: [DONE]\n"),
                              ("最後一條後面沒有空行就斷開", delta + b"\n\n" + stop + b"\n"),
                              ("最後一條連換行都沒有", delta + b"\n\n" + stop)]:
            with self.subTest(name):
                self.assertEqual(self.run_stream(io.BytesIO(payload)), "ok")

    def test_invalid_sse_does_not_finish_successfully(self):
        for payload in [b"data: broken\n\n", b"data: null\n\n"]:
            with self.assertRaises(EngineError):
                self.run_stream(io.BytesIO(payload + b"data: [DONE]\n\n"))

    def test_already_cancelled_stream_does_not_call_api(self):
        cancel = threading.Event()
        cancel.set()
        with patch.object(openai_api, "_open") as opened, self.assertRaises(Cancelled):
            list(openai_api.stream({}, "q", cancel))
        opened.assert_not_called()

    def test_retry_after_date_invalid_and_seconds(self):
        now = 1700000000
        for header, wait in [(formatdate(now + 12, usegmt=True), 12), ("invalid", 10), ("nan", 10), ("7", 7), ("0", 0)]:
            error = urllib.error.HTTPError("http://example.invalid", 429, "limited", {"Retry-After": header}, None)
            response = io.BytesIO(json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode())
            with self.subTest(header=header), patch.object(openai_api, "_open", side_effect=[error, response]), \
                    patch.object(openai_api, "_sleep") as sleep, patch.object(openai_api.time, "time", return_value=now), \
                    patch.object(openai_api.random, "uniform", return_value=1):
                self.assertEqual(openai_api.complete({"model": "fake"}, "q", []), "ok")
                sleep.assert_called_once_with(wait, None)

    def test_failed_response_reports_error_without_output(self):
        with self.assertRaisesRegex(EngineError, "failure reason"):
            openai_api._responses_text({"status": "failed", "error": "failure reason"})
