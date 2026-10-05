import unittest

from easyread import float_order


def blk(bid, page, kind="para"):
    return {"id": bid, "page": page, "type": kind}


def at(page, box, src="text"):
    return {"page": page, "box": list(box), "src": src}


class FloatOrderTest(unittest.TestCase):
    def test_figure_at_page_top_moves_before_the_paragraph_that_cites_it(self):
        blocks = [blk("p2-9", 2), blk("p3-1", 3), blk("fig1", 3, "figure"), blk("s3-1", 3, "heading")]
        layout = {"p2-9": at(2, [0.17, 0.84, 0.82, 0.91]), "p3-1": at(3, [0.17, 0.55, 0.82, 0.59]),
                  "fig1": at(3, [0.15, 0.08, 0.85, 0.52], "graphic"), "s3-1": at(3, [0.17, 0.61, 0.41, 0.62])}
        self.assertEqual(float_order.order(blocks, layout), ["p2-9", "fig1", "p3-1", "s3-1"])

    def test_table_moved_into_a_later_section_comes_back(self):
        blocks = [blk("p5-8", 5), blk("s3-5", 6, "heading"), blk("p6-1", 6), blk("s4", 6, "heading"),
                  blk("p6-8", 6), blk("tab1", 6, "table"), blk("p7-1", 7)]
        layout = {"p5-8": at(5, [0.17, 0.8, 0.82, 0.9]), "s3-5": at(6, [0.17, 0.2, 0.4, 0.21]),
                  "p6-1": at(6, [0.17, 0.3, 0.82, 0.37]), "s4": at(6, [0.17, 0.5, 0.4, 0.51]),
                  "p6-8": at(6, [0.17, 0.8, 0.82, 0.9]), "tab1": at(6, [0.15, 0.08, 0.85, 0.13], "caption"),
                  "p7-1": at(7, [0.17, 0.1, 0.82, 0.2])}
        self.assertEqual(float_order.order(blocks, layout)[:3], ["p5-8", "tab1", "s3-5"])

    def test_right_column_figure_waits_for_the_left_column(self):
        blocks = [blk("l1", 1), blk("l2", 1), blk("r1", 1), blk("fig", 1, "figure"), blk("r2", 1)]
        layout = {"l1": at(1, [0.08, 0.1, 0.48, 0.4]), "l2": at(1, [0.08, 0.5, 0.48, 0.9]),
                  "r1": at(1, [0.52, 0.1, 0.92, 0.3]), "fig": at(1, [0.52, 0.35, 0.92, 0.6], "graphic"),
                  "r2": at(1, [0.52, 0.65, 0.92, 0.9])}
        self.assertIsNone(float_order.order(blocks, layout))

    def test_equation_under_a_page_top_table_stays_below_it(self):
        # 公式這一步還沒定位框：表上方沒空當、下方有，表要排在公式前面
        blocks = [blk("p2-9", 2), blk("eq", 3, "math"), blk("tab2", 3, "table"), blk("p3-1", 3)]
        layout = {"p2-9": at(2, [0.13, 0.8, 0.87, 0.9]), "tab2": at(3, [0.13, 0.08, 0.87, 0.27], "caption"),
                  "p3-1": at(3, [0.13, 0.34, 0.87, 0.38])}
        self.assertEqual(float_order.order(blocks, layout), ["p2-9", "tab2", "eq", "p3-1"])

    def test_equation_above_a_page_bottom_figure_stays_above_it(self):
        blocks = [blk("p1", 1), blk("eq", 1, "math"), blk("p2", 2), blk("fig", 1, "figure")]
        layout = {"p1": at(1, [0.13, 0.1, 0.87, 0.5]), "fig": at(1, [0.13, 0.62, 0.87, 0.9], "graphic"),
                  "p2": at(2, [0.13, 0.1, 0.87, 0.3])}
        self.assertEqual(float_order.order(blocks, layout), ["p1", "eq", "fig", "p2"])

    def test_unlocated_figure_stays_put(self):
        blocks = [blk("p1", 1), blk("fig", 1, "figure"), blk("p2", 1)]
        layout = {"p1": at(1, [0.1, 0.5, 0.9, 0.6]), "p2": at(1, [0.1, 0.7, 0.9, 0.8])}
        self.assertIsNone(float_order.order(blocks, layout))

    def test_apply_keeps_blocks_added_after_ordering(self):
        paper = {"blocks": [blk("a", 1), blk("fig", 1, "figure"), blk("new", 2)]}
        float_order.apply(paper, ["fig", "a"])
        self.assertEqual([b["id"] for b in paper["blocks"]], ["fig", "a", "new"])


if __name__ == "__main__":
    unittest.main()
