import unittest

from easyread.pdfwork import _page_locs as page_locs
from easyread.text_regions import locate_prose


def stream(*lines):
    """Keep PDF drawing order separate from the printed column coordinates."""
    chars, text, indices = [], [], []
    for content, x, y in lines:
        for i, ch in enumerate(content):
            chars.append([ch, x + i * .003, y, x + (i + 1) * .003, y + .012])
            if ch.isalnum():
                text.append(ch.lower())
                indices.append(len(chars) - 1)
    return ''.join(text), indices, chars


class TextRegionsTest(unittest.TestCase):
    def test_cross_page_tail_does_not_swallow_figure_labels_or_footer(self):
        head = 'This paragraph starts near the bottom of the first printed page.'
        tail = 'The same paragraph continues above the next figure on the following page.'
        pages = {
            1: stream((head, .52, .85), ('Copyright publisher year 2023', .1, .95)),
            2: stream((tail, .08, .08), ('Attack technique chart labels unrelated to prose', .08, .3)),
        }
        loc = locate_prose(head + ' ' + tail, 1, pages.get)
        self.assertEqual([r['page'] for r in loc['regions']], [1, 2])
        self.assertLess(loc['regions'][0]['box'][3], .9)
        continuation = page_locs({'para': loc}, 2)
        self.assertEqual(len(continuation), 1)
        self.assertLess(continuation[0]['box'][3], .1)

    def test_cross_column_runs_keep_reading_order_and_leave_gutter_empty(self):
        left = 'A paragraph begins at the bottom of the left column with these words.'
        right = 'It continues at the top of the right column and completes its meaning.'
        pages = {1: stream((left, .08, .85), (right, .52, .08))}
        loc = locate_prose(left + ' ' + right, 1, pages.get)
        boxes = [r['box'] for r in loc['regions']]
        self.assertEqual(len(boxes), 2)
        self.assertLess(boxes[0][2], .5)
        self.assertGreater(boxes[1][0], .5)
        self.assertGreater(boxes[0][1], boxes[1][1])

    def test_unmatched_paragraph_does_not_invent_a_region(self):
        page = stream(('Unrelated printed content that belongs to another paragraph.', .08, .1))
        self.assertIsNone(locate_prose('A completely different paragraph without enough evidence on this page.',
                                      1, {1: page}.get))


if __name__ == '__main__':
    unittest.main()
