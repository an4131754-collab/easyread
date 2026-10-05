"""Text and coordinates must be limited to the displayed page of a tiled PDF."""
import gc
import json
import tempfile
import unittest
import weakref
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject, NumberObject, RectangleObject

from easyread import pdfwork
from easyread.store import write_json_atomic


def make_pdf(path, *, rotations=(0, 0), crop=False, unicode_text=False):
    writer = PdfWriter()
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                             NameObject('/Subtype'): NameObject('/Type1'),
                             NameObject('/BaseFont'): NameObject('/Helvetica'),
                             NameObject('/Encoding'): NameObject('/WinAnsiEncoding')})
    if unicode_text:
        cmap = DecodedStreamObject()
        cmap.set_data(b'''/CIDInit /ProcSet findresource begin
12 dict begin begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /TestUnicode def /CMapType 2 def
1 begincodespacerange <00> <FF> endcodespacerange
2 beginbfchar <80> <FB01> <81> <D83DDE00> endbfchar
endcmap CMapName currentdict /CMap defineresource pop end end''')
        font[NameObject('/ToUnicode')] = writer._add_object(cmap)
    resources = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
    shared = DecodedStreamObject()
    shared.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Form'),
                   NameObject('/FormType'): NumberObject(1), NameObject('/BBox'): RectangleObject([0, 0, 300, 3000]),
                   NameObject('/Resources'): resources})
    shared.set_data(b'BT /F1 12 Tf 30 2500 Td (FIRST PAGE UNIQUE) Tj ET\n'
                    b'BT /F1 12 Tf 30 500 Td (SECOND PAGE UNIQUE) Tj ET\n'
                    + (b'BT /F1 12 Tf 30 2470 Td <8081> Tj ET\n' if unicode_text else b''))
    shared_ref = writer._add_object(shared)
    for i, rotation in enumerate(rotations):
        page = writer.add_blank_page(width=300, height=300)
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/XObject'): DictionaryObject({NameObject('/Shared'): shared_ref})})
        content = DecodedStreamObject()
        content.set_data(f'q 1 0 0 1 0 {-2250 if i % 2 == 0 else -250} cm /Shared Do Q'.encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(content)
        if crop:
            page.cropbox = RectangleObject([20, 200, 200, 280])
        if rotation:
            page.rotate(rotation)
    writer.write(path)


class TextExtractionTest(unittest.TestCase):
    def test_shared_long_form_is_not_extracted_on_every_tile(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_pdf(root / 'source.pdf', rotations=(0,) * 24)
            self.assertEqual(pdfwork.extract_text(root / 'source.pdf', root / 'extract'), 24)
            for n in range(1, 25):
                text = (root / f'extract/page-{n:03d}.txt').read_text(encoding='utf-8')
                chars = json.loads((root / f'extract/page-{n:03d}.chars.json').read_text(encoding='utf-8'))
                visible, hidden = ('FIRST', 'SECOND') if n % 2 else ('SECOND', 'FIRST')
                self.assertIn(visible, text)
                self.assertNotIn(hidden, text)
                self.assertIn(visible, ''.join(c[0] for c in chars))
                self.assertNotIn(hidden, ''.join(c[0] for c in chars))
                self.assertLess(len(chars), 30)
                self.assertTrue(all(0 <= v <= 1 for c in chars for v in c[1:]))

    def test_crop_origin_and_all_rotations_match_rendered_coordinates(self):
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                make_pdf(root / 'source.pdf', rotations=(rotation,), crop=True)
                pdfwork.extract_text(root / 'source.pdf', root / 'extract')
                text = (root / 'extract/page-001.txt').read_text(encoding='utf-8')
                self.assertIn('FIRST PAGE UNIQUE', text)
                chars = json.loads((root / 'extract/page-001.chars.json').read_text(encoding='utf-8'))
                first = next(c for c in chars if c[0] == 'F')
                # Map its normalized center back to the original cropped page.
                x, y = (first[1] + first[3]) / 2, (first[2] + first[4]) / 2
                if rotation == 90:
                    x, y = y, 1 - x
                elif rotation == 180:
                    x, y = 1 - x, 1 - y
                elif rotation == 270:
                    x, y = 1 - y, x
                self.assertAlmostEqual(x, 0.07, delta=0.025)
                self.assertAlmostEqual(y, 0.32, delta=0.06)
                self.assertTrue(all(0 <= v <= 1 for c in chars for v in c[1:]))
                # Verify the box against the actual rotated/cropped rendering,
                # independently of the coordinate transform used by extraction.
                import pypdfium2
                with closing(pypdfium2.PdfDocument(str(root / 'source.pdf'))) as doc:
                    with closing(doc[0]) as page, closing(page.render(scale=3)) as bitmap, bitmap.to_pil() as image:
                        W, H = image.size
                        area = tuple(round(v * (W if i % 2 == 0 else H)) for i, v in enumerate(first[1:]))
                        with image.crop(area) as part, part.convert('L') as gray:
                            self.assertLess(gray.getextrema()[0], 100)

    def test_unicode_ligature_and_non_bmp_character_keep_their_boxes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_pdf(root / 'source.pdf', rotations=(0,), unicode_text=True)
            pdfwork.extract_text(root / 'source.pdf', root / 'extract')
            text = (root / 'extract/page-001.txt').read_text(encoding='utf-8')
            chars = json.loads((root / 'extract/page-001.chars.json').read_text(encoding='utf-8'))
            self.assertIn('fi\U0001f600', text)  # PDFium expands ligatures in its text view.
            self.assertIn('fi\U0001f600', ''.join(c[0] for c in chars))
            self.assertEqual(sum(c[0] == '\U0001f600' for c in chars), 1)

    def test_partial_glyph_is_clamped_and_off_page_glyph_is_skipped(self):
        self.assertEqual(pdfwork._char_box((-5, 10, 5, 20), (0, 0, 100, 100), 0), [0, 0.8, 0.05, 0.9])
        self.assertIsNone(pdfwork._char_box((10, 101, 20, 110), (0, 0, 100, 100), 0))

    def test_extraction_releases_document_after_write_error(self):
        import pypdfium2
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            make_pdf(root / 'source.pdf', rotations=(0,))
            documents = []
            original = pypdfium2.PdfDocument

            def opened(path):
                doc = original(path)
                documents.append(doc)
                return doc

            with patch.object(pypdfium2, 'PdfDocument', side_effect=opened), \
                    patch.object(Path, 'write_text', side_effect=OSError('disk full')), self.assertRaises(OSError):
                pdfwork.extract_text(root / 'source.pdf', root / 'extract')
            self.assertIsNone(documents[0].raw)
            (root / 'source.pdf').rename(root / 'moved.pdf')


class LayoutMemoryTest(unittest.TestCase):
    def test_long_paper_does_not_retain_every_page_stream(self):
        class Stream:
            def __iter__(self):
                return iter(('hello', list(range(5)), [[c, 0.1 + i * 0.02, 0.1, 0.12 + i * 0.02, 0.2] for i, c in enumerate('hello')]))

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'extract').mkdir()
            write_json_atomic(root / 'paper.json', {'blocks': [{'id': f'p{n}', 'page': n, 'type': 'para', 'en': 'hello'} for n in range(1, 31)]})
            refs = []

            def load(_, n):
                gc.collect()
                self.assertLessEqual(sum(ref() is not None for ref in refs), 2)
                stream = Stream()
                refs.append(weakref.ref(stream))
                return stream

            with patch.object(pdfwork, '_page_stream', side_effect=load):
                result = pdfwork.locate(root)
            self.assertEqual(len(result), 30)


if __name__ == '__main__':
    unittest.main()
