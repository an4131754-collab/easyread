import tempfile
import unittest
from pathlib import Path

from PIL import Image

from easyread import pdfwork


class PdfworkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.pages = self.tmp / "pages"
        self.pages.mkdir(parents=True)
        # Create a small sample image (800x600)
        self.img_small = self.pages / "page-001.webp"
        im1 = Image.new("RGB", (800, 600), color="white")
        im1.save(self.img_small, "WEBP")
        # Create a large sample image (1800x1200)
        self.img_large = self.pages / "page-002.webp"
        im2 = Image.new("RGB", (1800, 1200), color="white")
        im2.save(self.img_large, "WEBP")

    def test_page_variant_bounds_and_safety(self):
        # Path outside pages/ returns None
        self.assertIsNone(pdfwork.page_variant(self.tmp, "source.pdf", 1000))
        self.assertIsNone(pdfwork.page_variant(self.tmp, "pages/../source.pdf", 1000))
        # Nonexistent page returns None
        self.assertIsNone(pdfwork.page_variant(self.tmp, "pages/page-999.webp", 1000))

    def test_page_variant_small_image_returns_src(self):
        # Small image (width 800) requested with width 1000 returns original src
        res = pdfwork.page_variant(self.tmp, "pages/page-001.webp", 1000)
        self.assertEqual(res, self.img_small.resolve())

    def test_page_variant_large_image_resizes(self):
        # Large image (width 1800) requested with width 1000 is resized and saved to w1000/
        res = pdfwork.page_variant(self.tmp, "pages/page-002.webp", 1000)
        self.assertIsNotNone(res)
        self.assertEqual(res, self.pages / "w1000" / "page-002.webp")
        self.assertTrue(res.exists())
        with Image.open(res) as im:
            self.assertEqual(im.width, 1000)

    def test_warm_variants(self):
        pdfwork.warm_variants(self.tmp, width=1000)
        self.assertTrue((self.pages / "w1000" / "page-002.webp").exists())



def _loc(box, src="text", page=1):
    return {"page": page, "box": list(box), "src": src}


class TwoColumnLayoutTest(unittest.TestCase):
    """雙欄頁：撐框、截重疊、補公式都只看同一欄。"""

    def base(self):
        return {
            "l1": _loc([0.08, 0.10, 0.48, 0.40]),
            "l2": _loc([0.08, 0.45, 0.48, 0.90]),
            "r1": _loc([0.52, 0.10, 0.92, 0.30]),
            "r2": _loc([0.52, 0.75, 0.92, 0.90]),
        }

    def test_caption_extends_within_its_column(self):
        layout = self.base()
        layout["tab"] = _loc([0.53, 0.66, 0.90, 0.70])  # 右欄表格的題注，表格在它上方
        pdfwork._extend_captioned([{"id": "tab", "type": "table"}], layout)
        self.assertEqual(layout["tab"]["box"], [0.52, 0.305, 0.92, 0.70])  # 撐到右欄 r1 下沿，不受左欄影響
        pdfwork._clamp_overlaps(layout)
        self.assertEqual(layout["tab"]["box"][3], 0.70)  # 撐過的框不再被截

    def test_clamp_ignores_other_column(self):
        layout = self.base()
        layout["l1"]["src"] = "head"
        layout["l1"]["box"][3] = 0.50  # 按長度估長了，壓到同欄 l2
        pdfwork._clamp_overlaps(layout)
        self.assertEqual(layout["l1"]["box"][3], 0.448)  # 截到 l2 上沿，而不是右欄 r1 的 0.10
        self.assertEqual(layout["r1"]["box"][3], 0.30)

    def test_formula_gap_stays_in_column(self):
        layout = self.base()
        blocks = [{"id": "r1", "page": 1}, {"id": "eq", "page": 1, "type": "math"}, {"id": "r2", "page": 1}]
        pdfwork._fill_gaps(blocks, layout)
        self.assertEqual(layout["eq"]["box"], [0.52, 0.30, 0.92, 0.75])

    def test_single_column_keeps_full_width(self):
        layout = {"p1": _loc([0.12, 0.10, 0.88, 0.40]), "cap": _loc([0.40, 0.60, 0.60, 0.62])}
        pdfwork._extend_captioned([{"id": "cap", "type": "figure"}], layout)
        self.assertEqual(layout["cap"]["box"], [0.15, 0.405, 0.85, 0.62])


def _chars(lines):
    """每行 (文字, top)，逐字給出字元框。"""
    out = []
    for text, top in lines:
        for k, ch in enumerate(text):
            out.append([ch, 0.1 + k * 0.005, top, 0.105 + k * 0.005, top + 0.012])
    return out


class LocateTest(unittest.TestCase):
    def test_heading_skips_same_label_inside_figure(self):
        import json
        root = Path(tempfile.mkdtemp())
        (root / "extract").mkdir()
        chars = _chars([("Scaled Dot-Product Attention", 0.10), ("Figure 2: Scaled Dot-Product Attention.", 0.40),
                        ("3.2.1 Scaled Dot-Product Attention", 0.45)])
        (root / "extract" / "page-001.chars.json").write_text(json.dumps(chars), encoding="utf-8")
        paper = {"blocks": [{"id": "h", "type": "heading", "page": 1, "num": "3.2.1", "en": "Scaled Dot-Product Attention"}]}
        (root / "paper.json").write_text(json.dumps(paper), encoding="utf-8")
        layout = pdfwork.locate(root)
        self.assertAlmostEqual(layout["h"]["box"][1], 0.45)  # 不是圖裡 0.10 那行同名標籤
        self.assertEqual((root / "extract" / "locate.version").read_text(encoding="utf-8"), pdfwork.LOCATE_VERSION)

    def test_refresh_layout_recomputes_stale(self):
        import json
        root = Path(tempfile.mkdtemp())
        (root / "extract").mkdir()
        (root / "extract" / "page-001.chars.json").write_text(json.dumps(_chars([("Hello world", 0.2)])), encoding="utf-8")
        (root / "paper.json").write_text(json.dumps({"blocks": [{"id": "p", "type": "para", "page": 1, "en": "Hello world"}]}), encoding="utf-8")
        (root / "layout.json").write_text("{}", encoding="utf-8")  # 舊規則算的
        pdfwork.refresh_layout(root)
        self.assertIn("p", json.loads((root / "layout.json").read_text(encoding="utf-8")))


class PdfReleasedTest(unittest.TestCase):
    """用完 PDF 要關掉：不然 Windows 上 source.pdf 一直被佔著，論文移不進回收站。"""

    def test_directory_can_be_moved_after_rendering(self):
        tmp = Path(tempfile.mkdtemp())
        ws = tmp / "ws"
        (ws / "extract").mkdir(parents=True)
        Image.new("RGB", (600, 800), "white").save(ws / "source.pdf", "PDF")
        pdfwork.engine_image(ws, 1)
        pdfwork.render_pages(ws / "source.pdf", ws / "pages")
        pdfwork.extract_text(ws / "source.pdf", ws / "extract")
        ws.rename(tmp / "moved")  # 檔案還開著的話 Windows 上這裡報 PermissionError
        self.assertTrue((tmp / "moved" / "source.pdf").exists())


if __name__ == "__main__":
    unittest.main()
