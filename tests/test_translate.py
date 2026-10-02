"""翻譯排程：一批失敗會重試，重試還失敗就跳過，別的頁照常譯完。  python -m unittest tests.test_translate"""
import json
import shutil
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from easyread import engines, translate
from easyread.store import Workspace, write_json_atomic


def make_ws(n_pages: int) -> Workspace:
    root = Path(tempfile.mkdtemp(prefix="easyread-test-"))
    (root / "extract").mkdir()
    for n in range(1, n_pages + 1):
        (root / "extract" / f"page-{n:03d}.txt").write_text(f"Text of page {n}.", encoding="utf-8")
    pages = [{"n": n, "w": 600, "h": 800, "img": f"pages/page-{n:03d}.webp"} for n in range(1, n_pages + 1)]
    write_json_atomic(root / "paper.json", {"meta": {"pages": pages, "page_count": n_pages}, "translation": {"done_pages": []},
                                            "glossary": [], "references": [], "blocks": []})
    return Workspace(root)


def fake_engine(fail_pages: set, calls: list):
    def run(cfg, prompt, cwd, images=None, cancel=None, meter=None):
        page = int(prompt.split("這次只處理第 ")[1].split(" ")[0].split(",")[0])
        calls.append(page)
        if page in fail_pages:
            raise engines.EngineError(f"boom {page}")
        return json.dumps({"blocks": [{"id": f"p{page}-1", "type": "para", "page": page, "en": "x", "zh": "譯文"}]})
    return run


class TranslateTest(unittest.TestCase):
    def setUp(self):
        self.ws = make_ws(6)
        self.cfg = {"engine": "openai", "batch_pages": 1, "concurrency": 2, "openai": {"vision": False}}
        self.patches = [mock.patch.object(translate.pdfwork, "locate", lambda root: None),
                        mock.patch.object(translate, "tex_problems", lambda tex: [])]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.ws.root, ignore_errors=True)

    def test_failed_batch_is_retried_then_skipped(self):
        calls = []
        with mock.patch.object(engines, "run", fake_engine({3}, calls)):
            failed = translate.translate_pages(self.ws, self.cfg, [1, 2, 3, 4, 5, 6], threading.Event(), lambda *a: None)
        self.assertEqual(list(failed), [3])
        self.assertEqual(calls.count(3), 2)  # 重試了一次
        paper = self.ws.load("paper")
        self.assertEqual(paper["translation"]["done_pages"], [1, 2, 4, 5, 6])
        self.assertEqual([b["page"] for b in paper["blocks"]], [1, 2, 4, 5, 6])  # 併發也按頁碼排好
        self.assertIn("第 3 頁 第 2 次失敗", (self.ws.root / "job.log").read_text(encoding="utf-8"))

    def test_quota_error_stops_remaining_batches(self):
        calls = []

        def run(cfg, prompt, cwd, images=None, cancel=None, meter=None):
            page = int(prompt.split("這次只處理第 ")[1].split(" ")[0].split(",")[0])
            calls.append(page)
            if page >= 3:
                raise engines.EngineError("Claude Code 出錯：You've hit your session limit")
            return json.dumps({"blocks": [{"id": f"p{page}-1", "type": "para", "page": page, "en": "x", "zh": "y"}]})
        cfg = dict(self.cfg, concurrency=1)
        with mock.patch.object(engines, "run", run):
            failed = translate.translate_pages(self.ws, cfg, [1, 2, 3, 4, 5, 6], threading.Event(), lambda *a: None)
        self.assertEqual(sorted(failed), [3, 4, 5, 6])
        self.assertEqual(calls, [1, 2, 3])  # 額度用完後不再呼叫模型

    def test_cancel_stops(self):
        ev = threading.Event()
        ev.set()
        with mock.patch.object(engines, "run", fake_engine(set(), [])):
            with self.assertRaises(engines.Cancelled):
                translate.translate_pages(self.ws, self.cfg, [1, 2], ev, lambda *a: None)

    def test_scope_body_stops_at_references(self):
        (self.ws.root / "extract" / "page-004.txt").write_text("Conclusion.\nReferences\n[1] A. B.", encoding="utf-8")
        self.assertEqual(translate.scope_pages(self.ws, "body"), [1, 2, 3, 4])
        self.assertEqual(translate.scope_pages(self.ws, "first:2"), [1, 2])
        self.assertIsNone(translate.scope_pages(self.ws, "all"))

    def test_checks_saved_and_replaced_on_retranslate(self):
        self.ws.update("paper", lambda p: p.__setitem__("blocks", [{"id": "tab1", "type": "table", "page": 2}]))
        chk = [{"anchor": "tab1", "title": "兩張表數字對不上", "body": "表 1 寫 87.7%，表 2 寫 86.7%。"}, {"anchor": "nope", "body": "錨點不存在的丟掉"}]
        translate._save_checks(self.ws, chk, [2])
        translate._save_checks(self.ws, chk[:1], [2])  # 重譯同一頁：不重複
        entries = self.ws.load("discussion").get("entries", [])
        self.assertEqual([(e["kind"], e["anchor"]) for e in entries], [("check", "tab1")])

    def test_json_with_code_fence_inside_string(self):
        # 附錄裡的程式碼塊原樣放進譯文：輸出裡有 ``` 圍欄套著 JSON，JSON 字串裡又有 ```python
        text = '```json\n{"blocks": [{"id": "c1", "type": "para", "zh": "程式碼如下：\\n```python\\nloss = -F.logsigmoid(x)\\n```"}]}\n```'
        self.assertEqual(engines.parse_json(text)["blocks"][0]["id"], "c1")



class ScopePagesTest(unittest.TestCase):
    def test_range(self):
        from easyread.translate import scope_pages

        class WS:
            def load(self, name):
                return {"meta": {"page_count": 20}}
        ws = WS()
        self.assertEqual(scope_pages(ws, "range:3-5"), [3, 4, 5])
        self.assertEqual(scope_pages(ws, "range:18-30"), [18, 19, 20])   # 超出總頁數就截到最後一頁
        self.assertEqual(scope_pages(ws, "range:5-3"), [3, 4, 5])        # 填反了也行
        self.assertEqual(scope_pages(ws, "range:30-18"), [18, 19, 20])
        with self.assertRaisesRegex(ValueError, "超出了論文範圍"):
            scope_pages(ws, "range:30-40")
        self.assertEqual(scope_pages(ws, "first:2"), [1, 2])              # 舊寫法還認


if __name__ == "__main__":
    unittest.main()
