"""Local PDFium extraction and rendering; optional dependencies, no OCR/services."""
import base64
import io
import re


def capabilities():
    try:
        import pypdfium2
        from PIL import Image
        return {'pdf': True, 'pdf_engine': str(pypdfium2.PYPDFIUM_INFO), 'renderer': Image.__name__}
    except ImportError:
        return {'pdf': False, 'pdf_error': 'PDF support requires pypdfium2 and Pillow. Run the documented local setup.'}


def extract(path, max_pages=500):
    import pypdfium2 as pdfium
    blocks = []
    with pdfium.PdfDocument(path) as doc:
        if len(doc) > max_pages:
            raise ValueError(f'PDF exceeds {max_pages} pages; use a smaller source PDF')
        for pageno in range(len(doc)):
            page = doc[pageno]
            try:
                textpage = page.get_textpage()
                try:
                    count = textpage.count_chars()
                    if count > 200000:
                        raise ValueError(f'PDF page {pageno + 1} exceeds extraction limit')
                    # Work in PDFium character indices, not Python string offsets: supplementary
                    # Unicode characters and generated separators need not map one-to-one.
                    start, block_id = 0, 0
                    while start < count:
                        length = min(1000, count - start)
                        passage = textpage.get_text_range(start, length)
                        # End at a newline where possible, while preserving the exact source text.
                        if length == 1000:
                            for delta in range(length, max(0, length - 200), -1):
                                if '\n' in textpage.get_text_range(start + delta - 1, 1):
                                    length = delta
                                    passage = textpage.get_text_range(start, length)
                                    break
                        rects = [list(textpage.get_rect(i)) for i in range(textpage.count_rects(start, length))]
                        if passage.strip() and rects:
                            left = min(r[0] for r in rects)
                            bottom = min(r[1] for r in rects)
                            right = max(r[2] for r in rects)
                            top = max(r[3] for r in rects)
                            blocks.append({'page': pageno + 1, 'block': block_id, 'text': passage, 'bbox': [left, bottom, right, top], 'rects': rects, 'char_start': start, 'char_end': start + length, 'page_width': page.get_width(), 'page_height': page.get_height(), 'coordinate_system': 'pdf-bottom-left'})
                            block_id += 1
                        start += length
                finally:
                    textpage.close()
            finally:
                page.close()
    return blocks


def render(path, page_number, scale=1.4, rects=None):
    import pypdfium2 as pdfium
    from PIL import ImageDraw
    with pdfium.PdfDocument(path) as doc:
        if not isinstance(page_number, int) or page_number < 1 or page_number > len(doc):
            raise ValueError('Page is outside this PDF')
        page = doc[page_number - 1]
        try:
            scale = max(.5, min(2., float(scale)))
            if page.get_width() * page.get_height() * scale * scale > 12000000:
                scale = (12000000 / (page.get_width() * page.get_height())) ** .5
            bitmap = page.render(scale=scale)
            try:
                image = bitmap.to_pil().convert('RGBA')
                draw = ImageDraw.Draw(image, 'RGBA')
                device_rects = []
                # PDFium's page-to-device transform handles crop boxes and page rotation.
                import ctypes
                for rect in (rects or [])[:2000]:
                    points = []
                    for x, y in ((rect[0], rect[1]), (rect[2], rect[3])):
                        dx, dy = ctypes.c_int(), ctypes.c_int()
                        ok = pdfium.raw.FPDF_PageToDevice(page, 0, 0, image.width, image.height, 0, x, y, ctypes.byref(dx), ctypes.byref(dy))
                        if ok:
                            points.append((dx.value, dy.value))
                    if len(points) == 2:
                        x1, x2 = sorted([p[0] for p in points])
                        y1, y2 = sorted([p[1] for p in points])
                        draw.rectangle((x1, y1, x2, y2), fill=(255, 211, 72, 80), outline=(211, 153, 0, 200))
                        device_rects.append([x1, y1, x2, y2])
                output = io.BytesIO()
                image.save(output, format='PNG')
                return {'image': base64.b64encode(output.getvalue()).decode(), 'page': page_number, 'pages': len(doc), 'width': image.width, 'height': image.height, 'highlight_rects': device_rects}
            finally:
                bitmap.close()
        finally:
            page.close()
