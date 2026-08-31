from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests/python'))
from pdf_fixture import make_pdf
root = Path(__file__).resolve().parents[1]
target = root / 'examples/bridge-study/references/pdfs/fixture2026.pdf'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(make_pdf(['Synthetic demonstration source. Not a scientific publication.', 'At strong constraints, direct ESS was 7; progressive ESS was 42.']))
print(target)
