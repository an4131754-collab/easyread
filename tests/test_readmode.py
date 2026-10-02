"""只讀原文：整理成只有英文的塊，之後翻譯時就地補中文、塊 id 不變。  python -m unittest tests.test_readmode"""
import json
import shutil
import threading
import unittest
from unittest import mock

from easyread import engines, translate
from tests.test_translate import make_ws


def structure_engine(calls: list):
    """只讀原文：每頁一個段落、一個表，只有英文。"""
    def run(cfg, prompt, cwd, images=None, cancel=None, meter=None):
        assert "不要翻譯" in prompt
        page = int(prompt.split("這次只處理第 ")[1].split(" ")[0].split(",")[0])
        calls.append(page)
        return json.dumps({"blocks": [
            {"id": f"p{page}-1", "type": "para", "page": page, "en": f"Text {page}."},
            {"id": f"tab{page}", "type": "table", "page": page, "head": [["Model", "Acc"]], "rows": [["A", "1"]], "caption_en": f"Table {page}: x"},
        ]})
    return run


def fill_engine(calls: list, skip: set = frozenset()):
    """補譯文：把要譯的鍵都譯成“中文 鍵”，skip 裡的鍵故意漏掉。"""
    def run(cfg, prompt, cwd, images=None, cancel=None, meter=None):
        assert "這次只翻譯第" in prompt
        items = json.loads(prompt.split("要翻譯的內容（鍵 → 英文）：\n", 1)[1])
        calls.append(sorted(items))
        zh = {k: ([["模型", "準確率"]] if k.endswith("#head") else "中文 " + k) for k in items if k not in skip}
        return json.dumps({"zh": zh})
    return run


class ReadModeTest(unittest.TestCase):
    def setUp(self):
        self.ws = make_ws(3)
        self.cfg = {"engine": "openai", "batch_pages": 1, "concurrency": 1, "openai": {"vision": False}}
        self.patches = [mock.patch.object(translate.pdfwork, "locate", lambda root: None),
                        mock.patch.object(translate, "tex_problems", lambda tex: [])]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.ws.root, ignore_errors=True)

    def read_all(self):
        with mock.patch.object(engines, "run", structure_engine([])):
            return translate.translate_pages(self.ws, self.cfg, [1, 2, 3], threading.Event(), lambda *a: None, read=True)

    def test_read_marks_en_pages(self):
        self.assertEqual(self.read_all(), {})
        paper = self.ws.load("paper")
        self.assertEqual(paper["translation"]["done_pages"], [1, 2, 3])
        self.assertEqual(paper["translation"]["en_pages"], [1, 2, 3])
        self.assertTrue(all("zh" not in b for b in paper["blocks"]))

    def test_translate_fills_in_place(self):
        self.read_all()
        ids = [b["id"] for b in self.ws.load("paper")["blocks"]]
        calls = []
        with mock.patch.object(engines, "run", fill_engine(calls)):
            failed = translate.translate_pages(self.ws, self.cfg, [1, 2, 3], threading.Event(), lambda *a: None)
        self.assertEqual(failed, {})
        paper = self.ws.load("paper")
        self.assertEqual([b["id"] for b in paper["blocks"]], ids)  # 塊 id 不變，筆記還掛得住
        self.assertEqual(paper["translation"]["en_pages"], [])
        self.assertEqual(paper["translation"]["scope"], "全文")
        p1 = next(b for b in paper["blocks"] if b["id"] == "p1-1")
        tab = next(b for b in paper["blocks"] if b["id"] == "tab1")
        self.assertEqual(p1["zh"], "中文 p1-1")
        self.assertEqual(tab["caption_zh"], "中文 tab1#caption")
        self.assertEqual(tab["head"], [["模型", "準確率"]])
        self.assertEqual(calls[0], ["p1-1", "tab1#caption", "tab1#head"])

    def test_missing_key_retried_only_for_rest(self):
        self.read_all()
        calls = []
        with mock.patch.object(engines, "run", fill_engine(calls, skip={"p2-1"})):
            failed = translate.translate_pages(self.ws, self.cfg, [2], threading.Event(), lambda *a: None)
        self.assertIn(2, failed)  # 兩次都漏，記為沒譯成功
        self.assertEqual(calls[1], ["p2-1"])  # 重試時只問漏掉的那一處
        paper = self.ws.load("paper")
        self.assertEqual(paper["translation"]["en_pages"], [1, 2, 3])
        self.assertEqual(next(b for b in paper["blocks"] if b["id"] == "tab2")["caption_zh"], "中文 tab2#caption")

    def test_mixed_batches_not_combined(self):
        self.assertEqual(translate._batches([1, 2, 3, 4], 2, {2, 3}), [[1], [2, 3], [4]])


if __name__ == "__main__":
    unittest.main()
