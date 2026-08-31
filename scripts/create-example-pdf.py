from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests/python'))
from pdf_fixture import make_pdf
root = Path(__file__).resolve().parents[1]
folder = root / 'examples/bridge-study/references/pdfs'
folder.mkdir(parents=True, exist_ok=True)
fixtures = {
    'fixture2026.pdf': [
        'Synthetic demonstration source. Not a scientific publication.',
        'At strong constraints, direct ESS was 7; progressive ESS was 42.',
    ],
    'tradeoff2026.pdf': [
        'Synthetic companion source. Not a scientific publication.',
        'When comparing sampling under stronger constraints, report runtime and robustness tradeoffs.',
    ],
}
for name, pages in fixtures.items():
    target = folder / name
    target.write_bytes(make_pdf(pages))
    print(target)
