import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'python'))
from research_indexer import Index, parse_bibtex
import research_indexer


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.index = Index(self.root)

    def tearDown(self):
        self.index.close()
        self.temp.cleanup()

    def write(self, name, text):
        p = self.root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding='utf-8')
        return p

    def test_freshness_digest_cache_avoids_repeat_reads_but_rechecks_rewrites_and_deletion(self):
        p = self.write('results/data.csv', 'ess\n42\n')
        self.index.scan()
        with patch('research_indexer.digest', wraps=research_indexer.digest) as hashed:
            for _ in range(5):
                self.assertIsNotNone(self.index.get('result:results/data.csv'))
            self.assertLessEqual(hashed.call_count, 1)
            stamp = p.stat()
            p.write_text('ess\n99\n')
            os.utime(p, ns=(stamp.st_atime_ns,stamp.st_mtime_ns))
            self.assertIsNone(self.index.get('result:results/data.csv'), 'Same-size rewrite with restored mtime must still invalidate')
            p.unlink()
            self.assertIsNone(self.index.get('result:results/data.csv'))

    def test_csv_exact_rows_statistics_bom_and_quoted_fields(self):
        self.write('data/sweep.csv', '\ufeffmethod,ess,note\na,42,"quoted, value"\nb,7,"two\nlines"\n')
        report = self.index.scan()
        self.assertEqual(report['indexed'], 1)
        summary = self.index.get('result:data/sweep.csv')
        self.assertEqual(summary['metadata']['dimensions'], {'rows': 2, 'columns': 3})
        self.assertEqual(summary['metadata']['statistics']['ess']['mean'], 24.5)
        sliced = self.index.result_slice('data/sweep.csv', [2], ['ess', 'note'])
        self.assertEqual(sliced['metadata']['rows'][0], {'ess': 7, 'note': 'two\nlines'})
        self.assertEqual(sliced['locator']['rows'], [2])
        self.assertEqual(sliced['hash'], summary['hash'])
        self.assertRaises(ValueError, self.index.result_slice, 'data/sweep.csv', [3], ['ess'])
        self.assertRaises(ValueError, self.index.result_slice, 'data/sweep.csv', [1], ['invented'])

    def test_incremental_index_invalidates_changed_deleted_and_corrupt_results(self):
        p = self.write('results/metrics.json', '{"ess": 42, "run": {"accuracy": 0.5}}')
        self.index.scan()
        previous = self.index.get('result:results/metrics.json')
        self.assertEqual(self.index.scan()['unchanged'], 1)
        p.write_text('{"ess": 7}')
        self.assertIsNone(self.index.get(previous['id']))
        self.index.scan([str(p)])
        self.assertNotEqual(previous['hash'], self.index.get(previous['id'])['hash'])
        p.write_text('{bad json')
        report = self.index.scan([str(p)])
        self.assertTrue(report['warnings'])
        self.assertIsNone(self.index.get(previous['id']))
        p.unlink()
        self.index.scan([str(p)])
        self.assertFalse(self.index.search('', ['result']))

    def test_paths_symlinks_ignores_and_configured_arbitrary_layout(self):
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.write('.gitignore', 'private/\n')
        self.write('private/secret.json', '{"secret":1}')
        self.write('.env.json', '{"token":"secret"}')
        self.write('odd/place/manuscript.tex', '\\section{Actual Results}\nBody.')
        outside = Path(self.temp.name).parent / (self.root.name + '-outside.json')
        outside.write_text('{"secret":2}')
        try:
            (self.root / 'leak.json').symlink_to(outside)
            self.index.scan()
            values = self.index.search('', None, 100)
            self.assertTrue(any(a['path'] == 'odd/place/manuscript.tex' for a in values))
            self.assertFalse(any('secret' in a['text'] for a in values))
            self.assertRaises(ValueError, self.index.safe_path, '../outside')
        finally:
            outside.unlink()

    def test_bibtex_nested_braces_strings_metadata_duplicate_keys(self):
        text = '@string{venue = "Journal of Tests"}\n@article{smith2024, title={A {Nested} \\emph{Title}}, author="Smith, A. and Jones, B.", year=2024, journal=venue, doi={10.0/test}, file={papers/smith.pdf}}'
        entries = parse_bibtex(text)
        self.assertEqual(entries[0]['key'], 'smith2024')
        self.assertEqual(entries[0]['journal'], 'Journal of Tests')
        self.assertEqual(entries[0]['year'], '2024')
        self.assertIn('{Nested}', entries[0]['title'])
        self.assertRaises(ValueError, parse_bibtex, text + '\n@book{smith2024,title={duplicate}}')

    def test_code_notebook_figures_and_confirmed_lineage_without_execution(self):
        self.write('code/plot.py', 'import pandas as pd\n\ndef make_plot():\n    """Compare ESS."""\n    d = pd.read_csv("results/sweep.csv")\n    savefig("figures/sweep.svg")\n')
        self.write('results/sweep.csv', 'ess\n42\n')
        self.write('figures/sweep.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
        self.write('notes/check.ipynb', json.dumps({'cells': [{'cell_type': 'code', 'source': ['def check():\n', '    return 1\n'], 'outputs': [{'text': 'SECRET OUTPUT'}]}]}))
        self.index.scan()
        code = self.index.search('make_plot', ['code'])
        self.assertTrue(code)
        self.assertIn('Compare ESS', code[0]['text'])
        self.assertFalse(any('SECRET OUTPUT' in a['text'] for a in self.index.search('', ['code'])))
        relations = self.index.graph()
        self.assertTrue(any(r['target'] == 'figure:figures/sweep.svg' for r in relations))
        edge = {'source': code[0]['id'], 'target': 'figure:figures/sweep.svg', 'relation': 'generates', 'confirmed': True}
        self.index.update_state('relation', edge)
        self.index.scan()
        self.assertTrue(any(r['confirmed'] for r in self.index.graph()))
        self.write('code/plot.py', 'def make_plot():\n    savefig("figures/sweep.svg")\n')
        self.index.scan()
        self.assertFalse(any(r['confirmed'] for r in self.index.graph()), 'Changed artifacts require renewed confirmation')

    def test_optional_outline_no_persistent_outline_and_state_survives_rebuild(self):
        self.write('paper/main.tex', '\\section{Results}\n\\subsection{Cost}\nDiscuss cost.')
        self.index.scan()
        outline = self.index.search('', ['outline'])
        self.assertEqual(len(outline), 2)
        self.assertTrue(all(a['metadata']['ephemeral'] for a in outline))
        self.assertFalse((self.root / 'outline.md').exists())
        self.index.update_state('pin', {'id': outline[0]['id']})
        self.index.close()
        (self.root / '.research-copilot/index.sqlite').unlink()
        self.index = Index(self.root)
        self.index.scan()
        self.assertIn(outline[0]['id'], self.index.state()['pins'])

    def test_large_preview_bounded_and_search_returns_relevant_slices(self):
        self.write('results/data.csv', 'method,ess\n' + ''.join(f'{"unique" if n == 90 else "other"},{n}\n' for n in range(100)))
        self.index.scan()
        summary = self.index.get('result:results/data.csv')
        self.assertLessEqual(len(summary['metadata']['preview']), 10)
        found = self.index.search('unique', ['result'])
        self.assertTrue(any(91 in a['locator'].get('rows', []) for a in found))
        self.assertTrue(all(len(a['metadata'].get('rows', [])) <= 25 for a in found))

    def test_search_ranks_before_limiting_candidates(self):
        self.write('results/data.csv', 'method,ess\n' + 'other,1\n' * 99999 + 'needle,42\n')
        self.index.scan()
        found = self.index.search('method needle', ['result'], 1)
        self.assertIn(100000, found[0]['locator'].get('rows', []), 'A relevant late slice must outrank common early matches')

    @unittest.skipUnless(Index.has_yaml(), 'Optional YAML dependency is not installed')
    def test_configuration_changes_reclassify_unchanged_files_and_exclude_old_records(self):
        self.write('plans/argument.md', '# A deliberate outline\n- Explain the comparison.\n')
        self.write('results/sweep.csv', 'ess\n42\n')
        self.index.scan()
        self.assertFalse(self.index.search('', ['outline']))
        self.write('.research-copilot/project.yaml', 'outline:\n  path: plans/argument.md\nexclude:\n  - results/**\n')
        self.index.scan()
        self.assertTrue(self.index.search('', ['outline']))
        self.assertFalse(self.index.search('', ['result']))
        self.assertTrue((self.root / '.research-copilot/.gitignore').exists())

    def test_sensitive_filenames_and_bibliography_keys_are_not_usable_for_injection(self):
        self.write('config/service-account.json', '{"private_key":"secret"}')
        self.write('config/credentials.yaml', 'password: secret')
        self.index.scan()
        self.assertFalse(any('secret' in a['text'] for a in self.index.search('', None, 100)))
        self.assertRaises(ValueError, parse_bibtex, '@misc{evil%key,title={unsafe}}')

    def test_plain_text_manuscripts_are_indexed_and_bounded_spans_support_both_formats(self):
        self.write('paper/main.tex', '\\section{Results}\nExact manuscript text.')
        self.write('paper/draft.txt', '# Results\nPlain manuscript text.\n\n# Discussion\nA limitation.')
        self.write('secret.md', 'secret')
        self.index.scan()
        result = self.index.dispatch('read_tex_span', {'path': 'paper/main.tex', 'start': 18, 'end': 23})
        self.assertEqual(result['text'], 'Exact')
        plain = self.index.get('tex:paper/draft.txt')
        self.assertEqual(plain['metadata']['format'], 'plaintext')
        self.assertEqual([a['title'] for a in self.index.search('', ['outline']) if a['path'].endswith('.txt')], ['Discussion', 'Results'])
        span = self.index.dispatch('read_tex_span', {'path': 'paper/draft.txt', 'start': 10, 'end': 15})
        self.assertEqual(span['text'], 'Plain')
        self.assertRaises(ValueError, self.index.dispatch, 'read_tex_span', {'path': 'secret.md', 'start': 0, 'end': 6})

    def test_figure_registry_records_caption_label_first_reference_and_lineage(self):
        self.write('paper/main.tex', '\\section{Results}\nSee \\ref{fig:comparison}.\n\\begin{figure}\n\\includegraphics{../figures/comparison.svg}\n\\caption{Comparison of ESS}\n\\label{fig:comparison}\n\\end{figure}')
        self.write('figures/comparison.svg', '<svg/>')
        self.write('results/comparison.csv', 'ess\n42\n')
        self.write('code/plot.py', 'def plot():\n    read_csv("results/comparison.csv")\n    savefig("figures/comparison.svg")\n')
        self.index.scan()
        figure = self.index.get('figure:figures/comparison.svg')
        self.assertEqual(figure['metadata']['caption'], 'Comparison of ESS')
        self.assertEqual(figure['metadata']['label'], 'fig:comparison')
        self.assertEqual(figure['metadata']['first_reference']['path'], 'paper/main.tex')
        self.assertEqual(figure['metadata']['source_data'], ['result:results/comparison.csv'])
        self.assertEqual(figure['metadata']['generated_by'], ['code:code/plot.py#plot'])


if __name__ == '__main__':
    unittest.main()
