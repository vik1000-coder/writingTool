"""Reproducible synthetic local index smoke benchmark; no model or network calls."""
import json
from pathlib import Path
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from research_indexer import Index

with tempfile.TemporaryDirectory(prefix='research-index-benchmark-') as directory:
    root = Path(directory)
    (root / 'results').mkdir()
    (root / 'paper').mkdir()
    (root / 'results/sweep.csv').write_text('method,ess\n' + 'ordinary,1\n' * 99999 + 'needle,42\n')
    for n in range(100):
        (root / f'paper/section-{n}.tex').write_text(f'\\section{{Synthetic section {n}}}\nA local indexing benchmark, not a research result.\n')
    index = Index(root)
    def timed(action):
        start = time.perf_counter()
        result = action()
        return result, round((time.perf_counter() - start) * 1000, 2)
    cold, cold_ms = timed(index.scan)
    warm, warm_ms = timed(index.scan)
    hits, search_ms = timed(lambda: index.search('method needle', ['result'], 1))
    assert 100000 in hits[0]['locator']['rows']
    assert warm['indexed'] == 0
    index.close()
    print(json.dumps({'files': 101, 'csv_rows': 100000, 'artifacts': cold['count'], 'cold_scan_ms': cold_ms, 'unchanged_scan_ms': warm_ms, 'ranked_search_ms': search_ms, 'index_bytes': (root / '.research-copilot/index.sqlite').stat().st_size}, indent=2))
