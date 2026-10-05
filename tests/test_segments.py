"""分段並行：怎麼切段、交界怎麼告诉模型、術語冲突怎麼统一。  python -m unittest tests.test_segments"""
import json
import shutil
import threading
import unittest
from unittest import mock

from easyread import config, engines, prompts, segments, translate
from tests.test_translate import make_ws


def write_pages(ws, texts: dict):
    for n, t in texts.items():
        (ws.root / "extract" / f"page-{n:03d}.txt").write_text(t, encoding="utf-8")


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.ws = make_ws(14)

    def tearDown(self):
        shutil.rmtree(self.ws.root, ignore_errors=True)

    def test_workers_auto_and_explicit(self):
        self.assertEqual(segments.workers(0, 15), 4)
        self.assertEqual(segments.workers(None, 2), 1)
        self.assertEqual(segments.workers("x", 100), segments.AUTO_MAX)
        self.assertEqual(segments.workers(1, 15), 1)
        self.assertEqual(segments.workers(99, 15), 8)

    def test_single_lane_keeps_order(self):
        self.assertEqual(segments.plan([1, 2, 3, 4], 2, 1, self.ws.root), [[1, 2, 3, 4]])
        self.assertEqual(segments.plan([], 2, 4, self.ws.root), [])

    def test_slowest_lane_not_longer_than_needed(self):
        pages = list(range(1, 15))  # 7 批，4 段時最慢一段 2 批
        plan = segments.plan(pages, 2, 4, self.ws.root)
        self.assertEqual([p for seg in plan for p in seg], pages)
        self.assertTrue(all(len(seg) <= 4 for seg in plan), plan)

    def test_fewer_lanes_when_same_speed(self):
        plan = segments.plan(list(range(1, 11)), 2, 4, self.ws.root)  # 5 批：3 段（2,2,1 批）就和 4 段一樣快
        self.assertEqual(len(plan), 3, plan)

    def test_cut_moves_to_clean_seam(self):
        # 第 4 頁斷在句子中間，第 5 頁從新章節開始：有餘量時切在 4|5，不切在 3|4
        write_pages(self.ws, {3: "This is the end of the sentence.", 4: "this continues the sentence and stops in the", 5: "3 Method\nWe do things."})
        plan = segments.plan(list(range(1, 9)), 2, 2, self.ws.root)  # 4 批 2 段，每段最多 4 頁
        self.assertEqual(plan, [[1, 2, 3, 4], [5, 6, 7, 8]])
        write_pages(self.ws, {4: "We are done with this part here.", 5: "lower case continuation of the paragraph"})
        self.assertEqual(segments.seam_cost(self.ws.root, 4, 5), 3.0)
        self.assertEqual(segments.seam_cost(self.ws.root, 2, 5), 0.0)  # 中間隔著不譯的頁

    def test_footnote_and_leading_table_ignored(self):
        # 腳注末尾的句號不算句子寫完；下一頁先排的表格和題注不算開頭（f8eeac73f437 第 8|9 頁就是這樣漏了半段）
        write_pages(self.ws, {4: "3) SAIL-PIW Wang et al. (2023) preserves historical knowledge\n1https://example.org/data/.\n8",
                              5: "Table 1 Main results on three datasets.\nReplay 0.0616 0.0386\n4) PISA models continual recommendation through updates"})
        self.assertEqual(segments.seam_cost(self.ws.root, 4, 5), 2.0)

    def test_page_numbers_ignored(self):
        write_pages(self.ws, {4: "The end of the whole section here.\n4\n", 5: "2.1 Setup\nText"})
        self.assertEqual(segments.seam_cost(self.ws.root, 4, 5), 0.0)




class SkipHeadTest(unittest.TestCase):
    def setUp(self):
        self.ws = make_ws(8)
        self.patches = [mock.patch.object(translate.pdfwork, "locate", lambda root: None),
                        mock.patch.object(translate, "tex_problems", lambda tex: [])]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.ws.root, ignore_errors=True)

    def run_job(self, cfg, pages, gl=lambda page: []):
        seen = {}
        lock = threading.Lock()

        def run(cfg, prompt, cwd, images=None, cancel=None, meter=None):
            page = int(prompt.split("這次只處理第 ")[1].split(" ")[0].split(",")[0])
            with lock:
                seen[page] = prompt
            return json.dumps({"glossary": gl(page), "blocks": [{"id": f"p{page}-1", "type": "para", "page": page,
                                                                  "en": "error bar", "zh": "誤差棒" if page > 4 else "誤差線"}]}, ensure_ascii=False)
        with mock.patch.object(engines, "run", run):
            self.assertEqual(translate.translate_pages(self.ws, cfg, pages, threading.Event(), lambda *a: None), {})
        return seen

    def test_lane_start_told_to_skip_continuation(self):
        cfg = {"engine": "openai", "batch_pages": 2, "concurrency": 2, "openai": {"vision": False}}
        seen = self.run_job(cfg, list(range(1, 9)))
        self.assertEqual(sorted(seen), [1, 3, 5, 7])
        self.assertIn("第 4 頁由另一批負責", seen[5])  # 第二段開頭
        for p in (1, 3, 7):
            self.assertNotIn("由另一批負責", seen[p])
        self.assertIn("上一批最後一段", seen[7])  # 段內照舊接上一批
        self.assertNotIn("另外用", seen[1])  # openai 不看圖：不提相鄰頁

    def test_seam_batches_peek_neighbour_image(self):
        cfg = {"engine": "claude", "batch_pages": 2, "concurrency": 2, "claude": {}}
        with mock.patch.object(translate.pdfwork, "engine_image", lambda root, n: root / f"page-{n}.jpg"), \
                mock.patch.object(translate.netcheck, "problem", lambda cfg: None):
            seen = self.run_job(cfg, list(range(1, 9)))
        self.assertIn("extract/page-005.jpg 的開頭", seen[3])  # 前一段最後一批看下一頁開頭
        self.assertIn("extract/page-004.jpg 的末尾", seen[5])  # 後一段第一批看上一頁末尾
        self.assertNotIn("另外用", seen[1])
        self.assertNotIn("另外用", seen[7])

    def test_serial_and_range_never_skip(self):
        cfg = {"engine": "openai", "batch_pages": 2, "concurrency": 1, "openai": {"vision": False}}
        seen = self.run_job(cfg, [5, 6, 7, 8])  # 第 4 頁不在這次范围裡：頁首續文要譯
        self.assertTrue(all("由另一批負責" not in p for p in seen.values()))

    def test_parallel_translation_does_not_rewrite_existing_terminology(self):
        cfg = {"engine": "openai", "batch_pages": 2, "concurrency": 1, "openai": {"vision": False}}
        self.run_job(cfg, list(range(1, 9)), gl=lambda page: [{"en": "error bar", "zh": "誤差棒" if page > 4 else "誤差線"}])
        paper = self.ws.load("paper")
        self.assertEqual({b["zh"] for b in paper["blocks"]}, {"誤差線", "誤差棒"})
        self.assertNotIn("術語統一", (self.ws.root / "job.log").read_text(encoding="utf-8"))

    def test_only_one_references_block(self):
        cfg = {"engine": "openai", "batch_pages": 2, "concurrency": 2, "openai": {"vision": False}}

        def run(cfg, prompt, cwd, images=None, cancel=None, meter=None):
            page = int(prompt.split("這次只處理第 ")[1].split(" ")[0].split(",")[0])
            blocks = [{"id": "refs", "type": "references", "page": page, "en": "References", "zh": "參考文獻"}] if page >= 3 else \
                [{"id": f"p{page}-1", "type": "para", "page": page, "en": "x", "zh": "譯文"}]
            return json.dumps({"blocks": blocks, "references": [{"id": str(page), "text": f"ref {page}"}]})
        with mock.patch.object(engines, "run", run):
            translate.translate_pages(self.ws, cfg, list(range(1, 9)), threading.Event(), lambda *a: None)
        paper = self.ws.load("paper")
        refs = [b for b in paper["blocks"] if b["type"] == "references"]
        self.assertEqual([b["page"] for b in refs], [3])  # 兩段各起了一個，留頁碼早的
        self.assertEqual(refs[0]["id"], "refs")  # 晚並進來的更早那塊接過原來的 id，掛在上面的筆記不丟
        self.assertEqual(len(paper["references"]), 4)

    def test_prev_paragraph_skips_footnote_and_flags_unfinished(self):
        def add(*blocks):
            self.ws.update("paper", lambda p: p["blocks"].extend(blocks))
        add({"id": "p4-7", "type": "para", "page": 4, "en": "3) SAIL-PIW preserves knowledge."},
            {"id": "p4-8", "type": "para", "page": 4, "en": "$^1$https://example.org/data/."})
        ctx = prompts._context(self.ws, [5, 6])
        self.assertIn("p4-7", ctx)  # 腳注排在最後也不拿它當上一段
        self.assertIn("不要再輸出這段續文", ctx)
        add({"id": "p4-9", "type": "para", "page": 4, "en": "Then the eval will need to contain at least"})
        ctx = prompts._context(self.ws, [5, 6])
        self.assertIn("停在了半句", ctx)  # 上一批沒補完：續文要由這批譯
        self.assertNotIn("不要再輸出這段續文", ctx)

    def test_prev_followed_by_math_or_ending_in_math_is_finished(self):
        add = lambda *bs: self.ws.update("paper", lambda p: p["blocks"].extend(bs))  # noqa: E731
        add({"id": "p4-1", "type": "para", "page": 4, "en": "Combining, we have"}, {"id": "eq3", "type": "math", "page": 4, "tex": "x"})
        self.assertNotIn("停在了半句", prompts._context(self.ws, [5, 6]))  # 後面跟著公式：那段已经結束
        add({"id": "p4-2", "type": "para", "page": 4, "en": "so the value is $x=1.$"})
        self.assertNotIn("停在了半句", prompts._context(self.ws, [5, 6]))
        add({"id": "p4-3", "type": "heading", "page": 4, "en": "3 Method"})
        self.assertNotIn("停在了半句", prompts._context(self.ws, [5, 6]))

    def test_fill_prompt_has_no_continuation_rules(self):
        from easyread import prompts_en
        self.ws.update("paper", lambda p: p["blocks"].append({"id": "p4-1", "type": "para", "page": 4, "en": "stops in the"}))
        text = prompts_en.fill(self.ws, [5], {"p5-1": "x"})
        self.assertNotIn("停在了半句", text)
        self.assertNotIn("上一批最後一段", text)

    def test_prev_paragraph_only_from_adjacent_pages(self):
        self.ws.update("paper", lambda p: p["blocks"].append({"id": "p1-1", "type": "para", "page": 1, "en": "far away"}))
        self.assertNotIn("far away", prompts._context(self.ws, [5, 6]))
        self.assertIn("far away", prompts._context(self.ws, [2, 3]))


class ConfigMigrationTest(unittest.TestCase):
    def test_old_one_means_auto_until_saved(self):
        import tempfile
        from pathlib import Path
        d = Path(tempfile.mkdtemp(prefix="easyread-cfg-"))
        try:
            with mock.patch.object(config, "CONFIG_PATH", d / "config.json"):
                (d / "config.json").write_text(json.dumps({"concurrency": 1}), encoding="utf-8")
                self.assertEqual(config.load()["concurrency"], 0)
                config.save({"port": 9000})  # 存別的設定也不會把舊的 1 固化下來
                self.assertEqual(config.load()["concurrency"], 0)
                config.save({"concurrency": 1})  # 新設定頁裡自己選的 1 保留
                self.assertEqual(config.load()["concurrency"], 1)
                (d / "config.json").write_text(json.dumps({"concurrency": 3}), encoding="utf-8")
                self.assertEqual(config.load()["concurrency"], 3)
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
