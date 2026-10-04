"""Attachment persistence and follow-up regression tests, without paid model calls."""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from easyread import chat_attachments as files, chat_store, engines
from easyread.server import Handler
from easyread.store import Workspace, write_json_atomic

class AttachmentChatTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ws = Workspace(Path(self.tmp.name))
        write_json_atomic(self.ws.paper_path, {"meta": {}, "blocks": []})
        data = io.BytesIO()
        Image.new("RGB", (2, 2)).save(data, format="PNG")
        self.image = files.save(self.ws, "figure.png", data.getvalue())

    def request(self, body, stream=None, broken=False):
        h = object.__new__(Handler)
        h.wfile = io.BytesIO()
        if broken:
            h.wfile = type("Broken", (), {"write": lambda *a: (_ for _ in ()).throw(BrokenPipeError())})()
        h.send_response = h.send_header = h.end_headers = lambda *a: None
        model = {"id": "test", "engine": "codex", "model": "test"}
        with patch("easyread.server.config.load", return_value={}), patch("easyread.server.chat_models.engine_cfg", return_value=({"engine": "codex"}, model)), patch("easyread.server.chat_models.label", return_value="Test"), patch("easyread.server.chat_models.supports_images", return_value=True), patch("easyread.server.chat.stream", side_effect=stream or (lambda *a: iter(["answer"])) ) as call:
            h._chat(self.ws, body)
        return call

    def test_photo_hidden_prompt_title_and_follow_up_image(self):
        call = self.request({"attachments": [self.image["id"]]})
        t = chat_store.threads(self.ws)[0]
        self.assertEqual(t["title"], "figure.png")
        self.assertEqual(t["messages"][0]["content"], "")
        self.assertIn("請協助分析", call.call_args.args[1])
        call = self.request({"thread": t["id"], "text": "What does the top label mean?"})
        self.assertEqual(call.call_args.args[-1], [files.path(self.ws, self.image)])
        self.assertIn("figure.png", call.call_args.args[1])
        self.assertEqual(len(chat_store.get(self.ws, t["id"])["messages"]), 4)

    def test_provider_failure_preserves_attachment_and_error(self):
        def fail(*a):
            self.assertEqual(len(chat_store.threads(self.ws)[0]["messages"]), 2)
            raise RuntimeError("offline")
        with patch("easyread.server.log.exception"):
            self.request({"attachments": [self.image["id"]]}, fail)
        t = chat_store.threads(self.ws)[0]
        self.assertEqual(t["messages"][0]["attachments"], [self.image])
        self.assertEqual(t["messages"][1]["error"], "offline")
        self.assertNotIn("pending", t["messages"][1])

    def test_disconnect_before_first_token_preserves_turn(self):
        self.request({"attachments": [self.image["id"]]}, broken=True)
        self.assertIn("已停止", chat_store.threads(self.ws)[0]["messages"][1]["error"])

    def test_cancel_preserves_turn(self):
        def cancelled(*a):
            raise engines.Cancelled()
        self.request({"attachments": [self.image["id"]]}, cancelled)
        self.assertIn("已停止", chat_store.threads(self.ws)[0]["messages"][1]["error"])

    def test_finish_does_not_restore_deleted_thread(self):
        msg = chat_store.append(self.ws, "t1", {"content": "q"}, "", "m", "M", pending=True)
        chat_store.delete(self.ws, "t1")
        self.assertEqual(chat_store.finish(self.ws, "t1", msg["id"], "late"), {})
        self.assertEqual(chat_store.threads(self.ws), [])

    def test_history_deduplicates_limits_and_skips_images_for_text_model(self):
        items = [files.save(self.ws, str(i)+".txt", b"hello") for i in range(12)]
        past = [{"attachments": items + [self.image]}]
        picked = files.conversation(self.ws, past, [items[-1]], True)
        self.assertEqual(len(picked), 10)
        self.assertEqual(picked[0], items[-1])
        self.assertEqual(len({x["id"] for x in picked}), 10)
        self.assertEqual(files.conversation(self.ws, [{"attachments": [self.image]}], [], False), [])
        with patch.object(files, "MAX_MESSAGE_BYTES", 7):
            self.assertEqual(len(files.conversation(self.ws, past, [], True)), 1)

    def test_text_follow_up_and_attachment_validation(self):
        text = files.save(self.ws, "note.md", b"Important result")
        self.request({"attachments": [text["id"]]})
        t = chat_store.threads(self.ws)[0]
        call = self.request({"thread": t["id"], "text": "Explain again"})
        self.assertIn("Important result", call.call_args.args[1])
        with self.assertRaises(ValueError):
            files.selected(self.ws, [text["id"]] * 11)
        with self.assertRaises(ValueError):
            files.save(self.ws, "fake.png", b"not an image")
        with self.assertRaises(ValueError):
            files.save(self.ws, "bad.txt", b"\x00")
