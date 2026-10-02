import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from easyread import pdfwork
from easyread.store import write_json_atomic


def chars(text, x, y, width=0.40, per_line=40):
    advance = width / per_line
    return [[letter, round(x + i % per_line * advance, 4), round(y + i // per_line * 0.02, 4),
             round(x + (i % per_line + 0.9) * advance, 4), round(y + i // per_line * 0.02 + 0.014, 4)]
            for i, letter in enumerate(text)]


def loc(box, boxes=None):
    result = {"page": 1, "src": "text", "box": list(box)}
    if boxes:
        result["boxes"] = [list(b) for b in boxes]
    return result


class MultiregionLayoutTest(unittest.TestCase):
    def test_locate_keeps_both_halves_of_a_column_crossing_paragraph(self):
        left = "A paragraph begins in the lower left column and keeps its original reading order. " * 4
        right = "It continues at the top of the right column, ending before the next paragraph. " * 2
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "extract").mkdir()
            write_json_atomic(root / "paper.json", {"blocks": [{"id": "cross", "page": 1, "type": "para", "en": left + right}]})
            write_json_atomic(root / "extract/page-001.chars.json", chars(left, 0.08, 0.60) + chars(right, 0.52, 0.10))
            result = pdfwork.locate(root)["cross"]
            self.assertEqual(result["src"], "text")
            self.assertEqual(len(result["boxes"]), 2)
            l, r = result["boxes"]
            self.assertLess(l[2], r[0])
            self.assertGreater(l[1], r[3])
            self.assertEqual(result["box"], [l[0], r[1], r[2], l[3]])
            self.assertEqual(json.loads((root / "layout.json").read_text())["cross"], result)

    def test_single_column_and_three_columns(self):
        text = "This is a full line followed by several more lines of the same paragraph. " * 2
        for columns in (1, 3):
            with self.subTest(columns=columns):
                selected = sum((chars(text, 0.08 + i * 0.30, 0.12, width=0.22) for i in range(columns)), [])
                boxes = pdfwork._boxes(selected, list(range(len(selected))), 0, len(selected) - 1)
                self.assertEqual(len(boxes), columns)
                for i, box in enumerate(boxes):
                    self.assertAlmostEqual(box[0], 0.08 + i * 0.30)
                    self.assertLess(box[2], 0.31 + i * 0.30)

    def test_clamping_one_fragment_preserves_the_other_column(self):
        layout = {
            "cross": loc([0.08, 0.10, 0.92, 0.90], [[0.08, 0.60, 0.48, 0.90], [0.52, 0.10, 0.92, 0.50]]),
            "next": loc([0.52, 0.40, 0.92, 0.80]),
        }
        pdfwork._clamp_overlaps(layout)
        self.assertEqual(layout["cross"]["boxes"][0], [0.08, 0.60, 0.48, 0.90])
        self.assertEqual(layout["cross"]["boxes"][1], [0.52, 0.10, 0.92, 0.398])
        self.assertEqual(layout["cross"]["box"], [0.08, 0.10, 0.92, 0.90])

    def base(self):
        return {
            "left": loc([0.08, 0.05, 0.48, 0.10]),
            "cross": loc([0.08, 0.10, 0.92, 0.90], [[0.08, 0.60, 0.48, 0.90], [0.52, 0.10, 0.92, 0.30]]),
            "right": loc([0.52, 0.75, 0.92, 0.90]),
        }

    def test_formula_after_crossing_paragraph_stays_in_its_final_column(self):
        layout = self.base()
        blocks = [{"id": "cross", "page": 1}, {"id": "formula", "page": 1, "type": "math"}, {"id": "right", "page": 1}]
        pdfwork._fill_gaps(blocks, layout)
        self.assertEqual(layout["formula"]["box"], [0.52, 0.30, 0.92, 0.75])

    def test_caption_extends_from_its_column_fragment(self):
        layout = self.base()
        layout["fig"] = loc([0.53, 0.65, 0.90, 0.70], [[0.53, 0.65, 0.65, 0.70], [0.70, 0.65, 0.90, 0.70]])
        pdfwork._extend_captioned([{"id": "fig", "type": "figure"}], layout)
        self.assertEqual(layout["fig"]["box"], [0.52, 0.305, 0.92, 0.70])
        self.assertNotIn("boxes", layout["fig"])

    def test_existing_paper_recalculates_once_without_changing_translation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "extract").mkdir()
            paper = {"blocks": [{"id": "p", "page": 1, "type": "para", "en": "Original paragraph", "zh": "已有譯文"}]}
            write_json_atomic(root / "paper.json", paper)
            write_json_atomic(root / "reader.json", {"notes": {"n1": {"body": "保留的筆記"}}})
            write_json_atomic(root / "layout.json", {"p": loc([0.08, 0.10, 0.92, 0.90])})
            (root / "extract/locate.version").write_text("2")
            write_json_atomic(root / "extract/page-001.chars.json", chars("Original paragraph", 0.08, 0.10))
            before = {name: (root / name).read_bytes() for name in ("paper.json", "reader.json")}
            with patch.object(pdfwork, "locate", wraps=pdfwork.locate) as locate:
                pdfwork.refresh_layout(root)
                pdfwork.refresh_layout(root)
                locate.assert_called_once_with(root)
            self.assertIn("p", json.loads((root / "layout.json").read_text()))
            self.assertEqual(before, {name: (root / name).read_bytes() for name in before})


if __name__ == "__main__":
    unittest.main()
