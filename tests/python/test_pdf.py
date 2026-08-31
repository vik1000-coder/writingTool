import base64
import io
import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))
import pdf_engine
from research_indexer import Index
from pdf_fixture import make_pdf


@unittest.skipUnless(pdf_engine.capabilities()['pdf'], 'Optional PDF dependencies are not installed')
class PdfTests(unittest.TestCase):
    def test_exact_passage_page_and_highlight_pixels(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture2026.pdf'
            path.write_bytes(make_pdf(['Synthetic introduction.', 'Direct ESS was 7; progressive ESS was 42.']))
            index = Index(directory)
            try:
                report = index.scan()
                self.assertEqual(report['warnings'], [])
                passages = index.search('progressive', ['pdf'])
                self.assertEqual(len(passages), 1)
                source = passages[0]
                self.assertEqual(source['text'], 'Direct ESS was 7; progressive ESS was 42.')
                self.assertEqual(source['locator']['page'], 2)
                self.assertEqual(source['locator']['char_start'], 0)
                rendered = index.render_pdf(source['id'])
                self.assertEqual(rendered['page'], 2)
                self.assertTrue(rendered['highlight_rects'])
                image = Image.open(io.BytesIO(base64.b64decode(rendered['image'])))
                x1, y1, x2, y2 = rendered['highlight_rects'][0]
                self.assertGreaterEqual(min(x1, y1), 0)
                self.assertLessEqual(x2, image.width)
                self.assertLessEqual(y2, image.height)
                self.assertNotEqual(image.getpixel((x1, y1)), (255, 255, 255, 255))
                self.assertEqual(image.getpixel((x1, y1))[3], 255, 'Highlight must blend over, not replace, source-page pixels')
                region = image.crop((x1, y1, x2, y2)).convert('RGB')
                pixels = region.tobytes()
                self.assertTrue(any(max(pixels[i:i+3]) < 170 for i in range(0, len(pixels), 3)), 'Original dark text must remain visible under the highlight')
                other = index.render_pdf(source['id'], 1)
                self.assertEqual(other['highlight_rects'], [])
                self.assertEqual(other['text'], '')
                path.write_bytes(make_pdf(['Changed source.']))
                self.assertRaises(ValueError, index.render_pdf, source['id'])
            finally:
                index.close()

    def test_rotation_and_scanned_pdf_are_not_fabricated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rotated.pdf'
            path.write_bytes(make_pdf(['Rotated passage.'], rotation=90))
            blocks = pdf_engine.extract(path)
            rendered = pdf_engine.render(path, 1, rects=blocks[0]['rects'])
            self.assertGreater(rendered['width'], rendered['height'])
            for x1, y1, x2, y2 in rendered['highlight_rects']:
                self.assertTrue(0 <= x1 < x2 <= rendered['width'])
                self.assertTrue(0 <= y1 < y2 <= rendered['height'])
            path.write_bytes(make_pdf(['']))
            with IndexContext(directory) as index:
                self.assertTrue(index.scan()['warnings'])
                self.assertEqual(index.search('', ['pdf']), [])


class IndexContext:
    def __init__(self, root): self.index = Index(root)
    def __enter__(self): return self.index
    def __exit__(self, *_): self.index.close()
