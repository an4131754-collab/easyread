"""AI reply reference provenance and persistence; no paid model calls."""
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from easyread import chat, chat_store
from easyread.server import Handler
from easyread.store import Workspace, write_json_atomic


class ReplyReferenceTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.ws = Workspace(Path(tmp.name))
        write_json_atomic(self.ws.paper_path, {"meta": {"title_en": "Paper"}, "blocks": [
            {"id": "p1", "type": "para", "role": "abstract", "en": "Paper abstract", "zh": "論文摘要"},
            {"id": "h1", "type": "heading", "en": "Results", "zh": "結果"},
            {"id": "p2", "type": "para", "en": "Original paper paragraph", "zh": "正在閱讀的論文段落"},
        ]})
        self.answer = chat_store.append(self.ws, "t1", {"content": "原來的問題", "anchor": "p2"}, "AI 回答有兩個不同觀點。", "fake", "Test model")
        self.second = chat_store.append(self.ws, "t1", {"content": "另一個問題"}, "第二個 AI 回答的內容。", "fake", "Test model")

    def ref(self, mid=None, quote="兩個不同觀點"):
        return {"source": "assistant", "message": mid or self.answer["id"], "quote": quote, "model": "spoofed model"}

    def request(self, refs):
        handler = object.__new__(Handler)
        handler.wfile = io.BytesIO()
        handler.send_response = handler.send_header = handler.end_headers = lambda *args: None
        model = {"id": "fake", "engine": "codex", "model": "fake"}
        with patch("easyread.server.config.load", return_value={}), patch("easyread.server.chat_models.engine_cfg", return_value=({"engine": "codex"}, model)), patch("easyread.server.chat_models.label", return_value="Test model"), patch("easyread.server.chat.stream", return_value=iter(["追問答案"])) as stream:
            handler._chat(self.ws, {"thread": "t1", "text": "比較這兩個片段", "refs": refs})
        return stream.call_args.args[1]

    def test_reply_and_paper_refs_survive_request_and_reload(self):
        refs = [{"anchor": "p2", "quote": ""}, self.ref(), self.ref(self.second["id"], "第二個 AI 回答")]
        prompt = self.request(refs)
        for text in ["論文摘要", "讀者正在讀的章節", "正在閱讀的論文段落", "AI 回答", "不是論文原文", "兩個不同觀點", "第二個 AI 回答", "之前的對話", "原來的問題"]:
            self.assertIn(text, prompt)
        self.assertNotIn("spoofed model", prompt)
        saved = chat_store.get(Workspace(self.ws.root), "t1")["messages"][-2]
        self.assertEqual(saved["anchor"], "p2")
        self.assertEqual(saved["quote"], "")
        self.assertEqual(saved["refs"][1]["message"], self.answer["id"])
        self.assertEqual(saved["refs"][1]["model"], "Test model")
        self.assertEqual(saved["refs"][2]["quote"], "第二個 AI 回答")
        follow_up = self.request([])
        self.assertIn("讀者當時引用的 AI 回答片段", follow_up)
        self.assertIn("兩個不同觀點", follow_up)

    def test_ai_only_ref_is_not_treated_as_paper_quote(self):
        prompt = self.request([self.ref()])
        self.assertIn("讀者引用的 AI 回答", prompt)
        self.assertNotIn("讀者選中的原話：", prompt)
        saved = chat_store.get(self.ws, "t1")["messages"][-2]
        self.assertIsNone(saved["anchor"])
        self.assertEqual(saved["quote"], "")

    def test_missing_other_thread_user_and_unfinished_refs_are_rejected(self):
        foreign = chat_store.append(self.ws, "t2", {"content": "other"}, "foreign answer", "fake", "Fake")
        pending = chat_store.append(self.ws, "t1", {"content": "pending"}, "partial", "fake", "Fake", pending=True)
        failed = chat_store.append(self.ws, "t1", {"content": "failed"}, "partial", "fake", "Fake", pending=True)
        chat_store.finish(self.ws, "t1", failed["id"], "partial", error="offline")
        for mid in ["missing", foreign["id"], pending["id"], failed["id"]]:
            with self.subTest(mid=mid), self.assertRaises(ValueError):
                chat.normalize_refs([self.ref(mid)], chat_store.get(self.ws, "t1"))
        with self.assertRaises(ValueError):
            chat.normalize_refs([self.ref()], None)

    def test_duplicates_size_and_legacy_paper_refs(self):
        thread = chat_store.get(self.ws, "t1")
        self.assertEqual(len(chat.normalize_refs([self.ref(), self.ref()], thread)), 1)
        self.assertEqual(chat.normalize_refs([{"anchor": "p2", "quote": "原文"}], thread), [{"anchor": "p2", "quote": "原文"}])
        for invalid in [[self.ref(quote="")], [self.ref(quote="x" * 1001)], [self.ref()] * 14, {}]:
            with self.subTest(invalid=str(invalid)[:30]), self.assertRaises(ValueError):
                chat.normalize_refs(invalid, thread)

    def test_unmarked_notes_keep_quote_without_colour_classification(self):
        write_json_atomic(self.ws.root / "reader.json", {"notes": {"note": {
            "id": "note", "anchor": "p2", "kind": "note", "color": "blue", "quote": "原文片段", "body": "保留筆記", "unmarked": True
        }}})
        self.assertIn("無顏色筆記", chat._marks_summary(self.ws))
        self.assertNotIn("藍色", chat._marks_summary(self.ws))
        self.assertNotIn("保留筆記", chat._marks(self.ws, {"藍"}))
        self.assertIn("保留筆記", chat._marks(self.ws, {"無顏色"}))


if __name__ == "__main__":
    unittest.main()
