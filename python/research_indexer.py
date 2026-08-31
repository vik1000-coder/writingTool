#!/usr/bin/env python3
"""Research Copilot's single local JSONL helper. Never executes project code."""
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile

from parsers import parse_bibtex, code_nodes, data_rows, tex_commands
import pdf_engine

SUFFIXES = {'.tex', '.bib', '.md', '.pdf', '.py', '.ipynb', '.csv', '.json', '.yaml', '.yml', '.png', '.svg'}
SKIP_DIRS = {'.git', '.research-copilot', '.venv', 'venv', 'node_modules', '__pycache__', '.vscode', '.idea', 'dist', 'build', '.next', '.pytest_cache'}
MAX_BYTES = 20 * 1024 * 1024
EMPTY_STATE = {'pins': [], 'excluded': [], 'relations': [], 'sections': {}}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def matches(name, pattern):
    """Workspace-relative globs, including braces and zero directories for **/."""
    brace = re.search(r'\{([^{}]+)\}', pattern)
    if brace:
        return any(matches(name, pattern[:brace.start()] + part + pattern[brace.end():]) for part in brace[1].split(','))
    if fnmatch.fnmatchcase(name, pattern):
        return True
    return '**/' in pattern and matches(name, pattern.replace('**/', '', 1))


class Index:
    def __init__(self, root):
        self.root = Path(root).resolve(strict=True)
        self.local = self.root / '.research-copilot'
        if self.local.is_symlink():
            raise ValueError('Index directory must not be a symlink')
        self.local.mkdir(exist_ok=True)
        ignore = self.local / '.gitignore'
        if not ignore.exists():
            try:
                with ignore.open('x', encoding='utf-8') as f:
                    f.write('index.sqlite*\nlogs/\n')
            except FileExistsError:
                pass
        self.db_path = self.local / 'index.sqlite'
        if self.db_path.is_symlink():
            raise ValueError('Index database must not be a symlink')
        self.db = sqlite3.connect(self.db_path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA busy_timeout=5000')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, hash TEXT NOT NULL, error TEXT);
            CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS artifacts_path ON artifacts(path);
            CREATE INDEX IF NOT EXISTS artifacts_kind ON artifacts(kind);
            CREATE TABLE IF NOT EXISTS edges(source TEXT NOT NULL, target TEXT NOT NULL, relation TEXT NOT NULL, PRIMARY KEY(source,target,relation));
            CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ''')
        self.config = {}
        self.load_config()

    def close(self):
        self.db.close()

    def safe_path(self, name):
        p = Path(name)
        if '..' in p.parts or '\\' in str(name) or '\0' in str(name):
            raise ValueError('Path traversal is not allowed')
        resolved = (self.root / p).resolve()
        if not resolved.is_relative_to(self.root):
            raise ValueError('Path must stay within the selected workspace')
        return resolved

    def relative(self, name):
        return self.safe_path(name).relative_to(self.root).as_posix()

    def load_config(self):
        config_path = self.local / 'project.yaml'
        self.config = {}
        if config_path.exists():
            self.safe_path(config_path)
            if config_path.stat().st_size > 100000:
                raise ValueError('Project configuration is too large')
            try:
                import yaml
            except ImportError as e:
                raise ValueError('project.yaml requires PyYAML; install requirements.txt into your chosen Python environment') from e
            self.config = yaml.safe_load(config_path.read_text('utf-8')) or {}
            if not isinstance(self.config, dict):
                raise ValueError('project.yaml must contain a mapping')
            for key in ('bibliography', 'reference_pdfs', 'code', 'results', 'figures', 'exclude'):
                if key in self.config and (not isinstance(self.config[key], list) or not all(isinstance(v, str) for v in self.config[key])):
                    raise ValueError(f'{key} must be a list of file paths/globs')
            for key in ('paper', 'outline'):
                if key in self.config and not isinstance(self.config[key], dict):
                    raise ValueError(f'{key} must be a mapping')

    def eligible(self, name):
        p = Path(name)
        if p.suffix.lower() not in SUFFIXES or any(part in SKIP_DIRS for part in p.parts):
            return False
        if any(part.startswith('.') for part in p.parts) or p.name.lower() in {'package.json', 'package-lock.json', 'tsconfig.json'} or re.search(r'(?:^|[-_.])(auth|credentials?|secrets?|passwords?|tokens?|service[-_]account|private[-_]key)(?:[-_.]|$)', p.name.lower()):
            return False
        if any(matches(name, pattern) for pattern in self.config.get('exclude', [])):
            return False
        # Explicit role globs scope that type instead of silently scanning unmatched files.
        role = {'.bib': 'bibliography', '.py': 'code', '.ipynb': 'code', '.csv': 'results', '.json': 'results', '.png': 'figures', '.svg': 'figures'}.get(p.suffix.lower())
        if role in self.config and not any(matches(name, pattern) for pattern in self.config[role]):
            return False
        return True

    def discover(self):
        try:
            result = subprocess.run(['git', '-C', str(self.root), 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], capture_output=True, timeout=10, check=True)
            names = list(dict.fromkeys(result.stdout.decode('utf-8').split('\0')))
        except (OSError, subprocess.SubprocessError, UnicodeError):
            names = []
            for folder, dirs, files in os.walk(self.root, followlinks=False):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
                names.extend((Path(folder) / f).relative_to(self.root).as_posix() for f in files)
        found = []
        for name in sorted(names):
            if not self.eligible(name):
                continue
            try:
                p = self.safe_path(name)
                # In-repo symlinks are skipped too, avoiding duplicate aliases and surprise context.
                if p.is_file() and not (self.root / name).is_symlink():
                    found.append(name)
            except (ValueError, OSError):
                continue
        if len(found) > 5000:
            raise ValueError('More than 5,000 supported files. Narrow project.yaml globs/exclusions.')
        return found

    def put(self, a):
        existing = self.db.execute('SELECT path FROM artifacts WHERE id=?', (a['id'],)).fetchone()
        if existing and existing[0] != a['path']:
            raise ValueError(f'Duplicate artifact ID {a["id"]} in {existing[0]} and {a["path"]}')
        self.db.execute('INSERT OR REPLACE INTO artifacts VALUES(?,?,?,?,?,?)', (a['id'], a['path'], a['kind'], a['title'], a['text'], dumps(a)))

    def artifacts(self, name, raw, file_hash):
        suffix = Path(name).suffix.lower()
        def artifact(kind, anchor='', title=None, text='', locator=None, metadata=None, id=None):
            return {'id': id or f'{kind}:{name}{anchor}', 'kind': kind, 'path': name, 'title': title or Path(name).name, 'text': text, 'hash': file_hash, 'locator': locator or {}, 'metadata': metadata or {}}
        if suffix in ('.png', '.svg'):
            yield artifact('figure', metadata={'status': 'existing'})
            return
        if suffix == '.pdf':
            is_figure = any(part.lower() in ('figures', 'figs', 'plots') for part in Path(name).parts) or any(matches(name, p) for p in self.config.get('figures', []))
            if is_figure:
                yield artifact('figure', metadata={'status': 'existing'})
                return
            if 'reference_pdfs' in self.config and not any(matches(name, p) for p in self.config['reference_pdfs']):
                return
            if (self.root / name).with_suffix('.tex').exists():
                return  # compiled manuscript is not literature evidence
            blocks = pdf_engine.extract(self.safe_path(name))
            if not blocks:
                raise ValueError('No extractable PDF text (possibly scanned). OCR is not performed; full-text evidence is unverified.')
            for block in blocks:
                yield artifact('pdf', f'#page-{block["page"]}-block-{block["block"]}', f'{Path(name).stem} — p. {block["page"]}', block['text'], {k: v for k, v in block.items() if k != 'text'}, {'citation_key': Path(name).stem})
            return
        source = raw.decode('utf-8-sig')
        if suffix == '.bib':
            for entry in parse_bibtex(source):
                yield artifact('bib', title=entry.get('title', entry['key']), text=' '.join(str(v) for v in entry.values()), metadata=entry, id=f'bib:{entry["key"]}')
        elif suffix in ('.csv', '.json'):
            columns, rows, schema, stats = data_rows(name, source)
            meta = {'dimensions': {'rows': len(rows), 'columns': len(columns)}, 'schema': schema, 'statistics': stats, 'preview': rows[:10]}
            yield artifact('result', title=Path(name).name, text=f'{name}\nColumns: {", ".join(columns)}\n{dumps(meta)}', locator={'columns': columns}, metadata=meta)
            for start in range(0, len(rows), 25):
                chunk = rows[start:start + 25]
                yield artifact('result', f'#rows-{start + 1}-{start + len(chunk)}', f'{Path(name).name} · rows {start + 1}–{start + len(chunk)}', dumps(chunk), {'rows': list(range(start + 1, start + len(chunk) + 1)), 'columns': columns}, {'rows': chunk})
        elif suffix in ('.py', '.ipynb'):
            cells = [(None, source)]
            if suffix == '.ipynb':
                notebook = json.loads(source)
                cells = [(i + 1, ''.join(c.get('source', []))) for i, c in enumerate(notebook.get('cells', [])) if c.get('cell_type') == 'code']
            for cell, code in cells:
                # IPython magics aren't Python AST; remove them as data, never run them.
                if cell:
                    code = '\n'.join('' if line.lstrip().startswith(('%', '!')) else line for line in code.splitlines())
                for item in code_nodes(code):
                    yield artifact('code', f'#{"cell-" + str(cell) + "-" if cell else ""}{item["name"]}', item['name'], item.pop('text'), {'line': item['line'], 'cell': cell}, item)
        elif suffix == '.tex':
            commands = list(tex_commands(source))
            headings = [(cmd, arg, start, end) for cmd, arg, start, end in commands if cmd in ('part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph')]
            yield artifact('tex', title=Path(name).name, text=source[:6000], metadata={'includes': [arg for cmd, arg, _, _ in commands if cmd in ('input', 'include', 'subfile')], 'citations': [k.strip() for cmd, arg, _, _ in commands if 'cite' in cmd for k in arg.split(',')], 'references': [{'label': arg, 'start': start, 'line': source[:start].count('\n') + 1} for cmd, arg, start, _ in commands if cmd in ('ref', 'autoref', 'cref', 'Cref', 'pageref')], 'headings': [h[1] for h in headings]})
            seen = {}
            for index, (cmd, title, start, end) in enumerate(headings):
                slug = re.sub(r'[^\w]+', '-', title.lower()).strip('-') or 'section'
                seen[slug] = seen.get(slug, 0) + 1
                anchor = slug + (f'-{seen[slug]}' if seen[slug] > 1 else '')
                section_end = headings[index + 1][2] if index + 1 < len(headings) else len(source)
                yield artifact('tex', f'#{anchor}', title, source[start:section_end][:6000], {'start': start, 'end': section_end, 'line': source[:start].count('\n') + 1}, {'level': cmd})
                yield artifact('outline', f'#{anchor}', title, title, {'start': start, 'end': end}, {'ephemeral': True, 'level': cmd})
            for env in re.finditer(r'\\begin\{(figure\*?|table\*?)\}([\s\S]*?)\\end\{\1\}', source):
                sub = list(tex_commands(env[2]))
                caption = next((a for c, a, _, _ in sub if c == 'caption'), '')
                label = next((a for c, a, _, _ in sub if c == 'label'), '')
                kind = 'table' if env[1].startswith('table') else 'figure'
                yield artifact(kind, f'#{label or "float-" + str(env.start())}', caption or label or kind.title(), env[0], {'start': env.start(), 'end': env.end()}, {'caption': caption, 'label': label, 'graphics': [a for c, a, _, _ in sub if c == 'includegraphics'], 'status': 'in-manuscript'})
        elif suffix in ('.md', '.yaml', '.yml'):
            configured = self.config.get('outline', {}).get('path')
            is_outline = name == configured or (not configured and 'outline' in Path(name).stem.lower())
            if is_outline and suffix in ('.yaml', '.yml'):
                import yaml
                outline = yaml.safe_load(source)
                nodes = outline if isinstance(outline, list) else outline.get('nodes', [outline]) if isinstance(outline, dict) else []
                for i, node in enumerate(nodes):
                    if not isinstance(node, dict):
                        raise ValueError('Outline nodes must be mappings')
                    yield artifact('outline', f'#node-{i + 1}', node.get('title', f'Outline item {i + 1}'), dumps(node), metadata={**node, 'ephemeral': False})
            elif is_outline:
                for i, m in enumerate(re.finditer(r'(?m)^(?:#{1,6}\s+|\s*[-*+]\s+)(.+)$', source)):
                    end = source.find('\n#', m.end())
                    yield artifact('outline', f'#node-{i + 1}', m[1], source[m.start():end if end >= 0 else len(source)][:4000], {'line': source[:m.start()].count('\n') + 1}, {'ephemeral': False, 'status': 'complete' if '[x]' in m[1].lower() else 'incomplete'})
                if not source.strip():
                    return
                if not re.search(r'(?m)^(?:#|\s*[-*+])', source):
                    yield artifact('outline', title='Outline', text=source[:6000], metadata={'ephemeral': False})
            else:
                yield artifact('note', text=source[:6000])

    def scan(self, paths=None):
        self.load_config()
        config_hash = digest(dumps({'config': self.config, 'index_format': 1}).encode())
        old_config = self.db.execute('SELECT value FROM metadata WHERE key=\'config_hash\'').fetchone()
        configuration_changed = not old_config or old_config[0] != config_hash
        if configuration_changed:
            paths = None
        discovered = set(self.discover())
        existing = {r[0]: (r[1], r[2]) for r in self.db.execute('SELECT path,hash,error FROM files')}
        # Always reconcile deleted/newly excluded files, including changes to .gitignore/config.
        removed = set(existing) - discovered
        requested = discovered if paths is None else {self.relative(p) for p in paths if self.safe_path(p).is_relative_to(self.root)} & discovered
        indexed = unchanged = 0
        warnings = []
        with self.db:
            for name in removed:
                self.db.execute('DELETE FROM artifacts WHERE path=?', (name,))
                self.db.execute('DELETE FROM files WHERE path=?', (name,))
            for name in sorted(requested):
                p = self.safe_path(name)
                file_hash = ''
                try:
                    if p.stat().st_size > MAX_BYTES:
                        raise ValueError('File exceeds 20 MiB indexing limit')
                    raw = p.read_bytes()
                    file_hash = digest(raw)
                    if not configuration_changed and existing.get(name) == (file_hash, None):
                        unchanged += 1
                        continue
                    self.db.execute('DELETE FROM artifacts WHERE path=?', (name,))
                    # Materialize before insertion, so parser failure never leaves partial evidence.
                    parsed = list(self.artifacts(name, raw, file_hash))
                    for a in parsed:
                        self.put(a)
                    self.db.execute('INSERT OR REPLACE INTO files VALUES(?,?,NULL)', (name, file_hash))
                    indexed += 1
                except (Exception,) as e:
                    self.db.execute('DELETE FROM artifacts WHERE path=?', (name,))
                    self.db.execute('INSERT OR REPLACE INTO files VALUES(?,?,?)', (name, file_hash, str(e)))
                    warnings.append(f'{name}: {e}')
            self.link()
            self.db.execute('INSERT OR REPLACE INTO metadata VALUES(\'config_hash\',?)', (config_hash,))
        warnings.extend(f'{name}: {error}' for name, error in self.db.execute('SELECT path,error FROM files WHERE error IS NOT NULL') if f'{name}: {error}' not in warnings)
        return {'indexed': indexed, 'unchanged': unchanged, 'removed': len(removed), 'count': self.db.execute('SELECT count(*) FROM artifacts').fetchone()[0], 'warnings': warnings, 'capabilities': {**pdf_engine.capabilities(), 'yaml': self.has_yaml()}, 'config': self.config}

    @staticmethod
    def has_yaml():
        try:
            import yaml
            return True
        except ImportError:
            return False

    def current(self, a):
        try:
            p = self.safe_path(a['path'])
            return p.is_file() and p.stat().st_size <= MAX_BYTES and digest(p.read_bytes()) == a['hash']
        except (ValueError, OSError):
            return False

    def get(self, id, fresh=True):
        row = self.db.execute('SELECT data FROM artifacts WHERE id=?', (id,)).fetchone()
        a = json.loads(row[0]) if row else None
        return a if a and (not fresh or self.current(a)) else None

    def search(self, query='', kinds=None, limit=30):
        limit = max(1, min(int(limit), 100))
        terms = list(dict.fromkeys(re.findall(r'[\w-]{2,}', str(query).lower())))[:20]
        conditions, args = [], []
        if kinds:
            conditions.append('kind IN (' + ','.join('?' for _ in kinds) + ')')
            args.extend(kinds)
        if terms:
            conditions.append('(' + ' OR '.join('(lower(title) LIKE ? ESCAPE \'\\\' OR lower(text) LIKE ? ESCAPE \'\\\' OR lower(path) LIKE ? ESCAPE \'\\\')' for _ in terms) + ')')
            for term in terms:
                like = '%' + term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
                args.extend([like, like, like])
        # Rank every matching row in SQLite before selecting a bounded result set.
        # A pre-ranking LIMIT silently loses highly relevant late CSV/PDF blocks.
        ranks, rank_args = [], []
        for term in terms:
            ranks.append('(5*(instr(lower(title),?)>0)+2*(instr(lower(path),?)>0)+(instr(lower(text),?)>0))')
            rank_args.extend([term, term, term])
        confirmed = set()
        for edge in self.state()['relations']:
            source, target = self.get(edge['source'], fresh=False), self.get(edge['target'], fresh=False)
            if source and target and source['hash'] == edge.get('source_hash') and target['hash'] == edge.get('target_hash'):
                confirmed.update([source['id'], target['id']])
        if confirmed:
            ranks.append('5*(id IN (' + ','.join('?' for _ in confirmed) + '))')
            rank_args.extend(sorted(confirmed))
        rank = '+'.join(ranks) or '0.0'
        sql = 'SELECT data FROM artifacts' + (' WHERE ' + ' AND '.join(conditions) if conditions else '') + f' ORDER BY ({rank}) DESC, id'
        records = self.db.execute(sql, args + rank_args)
        # Validate once per source file, not once per row slice or PDF block.
        fresh, output = {}, []
        for row in records:
            a = json.loads(row[0])
            identity = (a['path'], a['hash'])
            if identity not in fresh:
                fresh[identity] = self.current(a)
            if fresh[identity]:
                output.append(a)
                if len(output) >= limit:
                    break
        if kinds == ['outline'] and any(not a['metadata'].get('ephemeral') for a in output):
            output = [a for a in output if not a['metadata'].get('ephemeral')]
        return output

    def result_slice(self, name, rows, columns):
        name = self.relative(name)
        summary = self.get(f'result:{name}')
        if not summary:
            raise ValueError('Result is missing or stale; refresh the index')
        if not rows or len(rows) > 25 or len(set(rows)) != len(rows) or not columns or len(columns) > 30:
            raise ValueError('Select 1–25 unique rows and 1–30 columns')
        if any(not isinstance(r, int) or r < 1 or r > summary['metadata']['dimensions']['rows'] for r in rows) or any(c not in summary['locator']['columns'] for c in columns):
            raise ValueError('Invalid result row or column')
        selected = []
        for row in rows:
            begin = ((row - 1) // 25) * 25 + 1
            end = min(begin + 24, summary['metadata']['dimensions']['rows'])
            chunk = self.get(f'result:{name}#rows-{begin}-{end}')
            if not chunk:
                raise ValueError('Result changed during retrieval; refresh')
            selected.append({c: chunk['metadata']['rows'][row - begin][c] for c in columns})
        id = f'result:{name}#slice-{digest(dumps([rows, columns]).encode())[:12]}'
        result = {**summary, 'id': id, 'title': f'{Path(name).name} · selected rows', 'text': dumps(selected), 'locator': {'rows': rows, 'columns': columns}, 'metadata': {'rows': selected}}
        with self.db:
            self.put(result)
        return result

    def state(self):
        p = self.local / 'state.json'
        if not p.exists():
            return json.loads(dumps(EMPTY_STATE))
        self.safe_path(p)
        if p.stat().st_size > 1000000:
            raise ValueError('Local state is too large')
        value = json.loads(p.read_text('utf-8'))
        if not isinstance(value, dict):
            raise ValueError('Invalid state.json')
        return {**json.loads(dumps(EMPTY_STATE)), **value}

    def update_state(self, action, payload):
        state = self.state()
        if action in ('pin', 'exclude'):
            id = payload['id']
            key = 'pins' if action == 'pin' else 'excluded'
            if id in state[key]:
                state[key].remove(id)
            elif self.get(id):
                if len(state[key]) >= 100:
                    raise ValueError('At most 100 context controls are allowed')
                state[key].append(id)
            else:
                raise ValueError('Unknown artifact')
        elif action == 'relation':
            source, target = self.get(payload['source']), self.get(payload['target'])
            if not source or not target:
                raise ValueError('Relationships require two current artifacts')
            if payload['relation'] not in ('supports', 'generates', 'reads', 'illustrates', 'cites'):
                raise ValueError('Unknown relationship type')
            edge = {k: payload[k] for k in ('source', 'target', 'relation')}
            state['relations'] = [r for r in state['relations'] if (r['source'], r['target'], r['relation']) != (edge['source'], edge['target'], edge['relation'])]
            state['relations'].append({**edge, 'confirmed': True, 'source_hash': source['hash'], 'target_hash': target['hash']})
        elif action == 'section':
            id, summary = payload['id'], payload['summary']
            if not isinstance(summary, str) or len(summary) > 2000 or len(id) > 1000:
                raise ValueError('Section goal exceeds limit')
            evidence = payload.get('evidence', [])
            if any(not self.get(id) for id in evidence):
                raise ValueError('Unknown section evidence')
            state['sections'][id] = {'summary': summary, 'evidence': evidence}
        else:
            raise ValueError('Unknown state action')
        self.safe_path(self.local / 'state.json')
        with tempfile.NamedTemporaryFile('w', dir=self.local, delete=False, encoding='utf-8') as f:
            json.dump(state, f, indent=2, ensure_ascii=False, allow_nan=False)
            temp = f.name
        os.replace(temp, self.local / 'state.json')
        return state

    def link(self):
        self.db.execute('DELETE FROM edges')
        records = [json.loads(r[0]) for r in self.db.execute('SELECT data FROM artifacts WHERE kind IN (\'code\',\'figure\',\'table\',\'bib\',\'tex\')')]
        file_artifacts = {a['path']: a for a in records if a['kind'] == 'figure' and '#' not in a['id']}
        for a in file_artifacts.values():
            a['metadata'] = {'status': 'existing'}
        results = {r[0]: r[1] for r in self.db.execute('SELECT path,id FROM artifacts WHERE kind=\'result\' AND instr(id,\'#\')=0')}
        def link(source, target, relation):
            self.db.execute('INSERT OR IGNORE INTO edges VALUES(?,?,?)', (source, target, relation))
        pdfs = {r[0] for r in self.db.execute('SELECT DISTINCT path FROM artifacts WHERE kind=\'pdf\'')}
        for a in records:
            if a['kind'] == 'code':
                for ref in a['metadata'].get('paths', []):
                    # Exact path or unique basename only; ambiguity is not evidence.
                    candidates = [name for name in [*file_artifacts, *results] if name == ref or Path(name).name == Path(ref).name]
                    if len(candidates) == 1:
                        target = candidates[0]
                        link(a['id'], file_artifacts[target]['id'] if target in file_artifacts else results[target], 'generates' if target in file_artifacts else 'reads')
            elif a['kind'] == 'bib':
                file = a['metadata'].get('file', '')
                candidates = [p for p in pdfs if Path(p).stem == a['metadata']['key'] or (file and (p == file or p == str(Path(a['path']).parent / file)))]
                a['metadata'].pop('pdf_path', None)
                if len(candidates) == 1:
                    a['metadata']['pdf_path'] = candidates[0]
                    for row in self.db.execute('SELECT id FROM artifacts WHERE path=?', (candidates[0],)).fetchall():
                        link(row[0], a['id'], 'supports')
                self.put(a)
            elif a['kind'] == 'tex':
                for key in a['metadata'].get('citations', []):
                    if self.db.execute('SELECT 1 FROM artifacts WHERE id=?', ('bib:' + key,)).fetchone():
                        link(a['id'], 'bib:' + key, 'cites')
            elif a['kind'] in ('figure', 'table'):
                for ref in a['metadata'].get('graphics', []):
                    candidates = [f for p, f in file_artifacts.items() if p == ref or str(Path(p).with_suffix('')) == ref or Path(p).stem == Path(ref).stem]
                    if len(candidates) == 1:
                        asset = candidates[0]
                        link(asset['id'], a['id'], 'illustrates')
                        label = a['metadata'].get('label')
                        first = next(({'path': tex['path'], **ref} for tex in records if tex['kind'] == 'tex' for ref in tex['metadata'].get('references', []) if ref['label'] == label), None)
                        asset['metadata'].update({'caption': a['metadata'].get('caption'), 'label': label, 'first_reference': first, 'status': 'in-manuscript'})
        for a in file_artifacts.values():
            generators = [r[0] for r in self.db.execute('SELECT source FROM edges WHERE target=? AND relation=\'generates\'', (a['id'],))]
            data = list(dict.fromkeys(r[0] for code in generators for r in self.db.execute('SELECT target FROM edges WHERE source=? AND relation=\'reads\'', (code,))))
            a['metadata'].update({'generated_by': generators, 'source_data': data, 'lineage_confidence': 'inferred'})
            self.put(a)

    def graph(self):
        confirmed = self.state()['relations']
        records = [{'source': s, 'target': t, 'relation': r, 'confirmed': False} for s, t, r in self.db.execute('SELECT source,target,relation FROM edges')]
        combined = {(r['source'], r['target'], r['relation']): r for r in records + confirmed}
        output, artifacts = [], {}
        for r in combined.values():
            for id in (r['source'], r['target']):
                if id not in artifacts:
                    artifacts[id] = self.get(id)
            source, target = artifacts[r['source']], artifacts[r['target']]
            if source and target:
                current = r.get('source_hash') == source['hash'] and r.get('target_hash') == target['hash']
                output.append({**r, 'confirmed': bool(r['confirmed'] and current)})
        return output

    def render_pdf(self, id, page=None, scale=1.4):
        a = self.get(id)
        if not a or Path(a['path']).suffix.lower() != '.pdf':
            raise ValueError('PDF evidence is missing or stale; refresh the index')
        pageno = page or a['locator'].get('page', 1)
        result = pdf_engine.render(self.safe_path(a['path']), pageno, scale, a['locator'].get('rects', []) if pageno == a['locator'].get('page') else [])
        return {**result, 'text': a['text'] if pageno == a['locator'].get('page') else '', 'path': a['path']}

    def read_tex_span(self, name, start, end):
        name = self.relative(name)
        a = self.get(f'tex:{name}')
        if not a or not isinstance(start, int) or not isinstance(end, int) or not 0 <= start <= end or end - start > 8000:
            raise ValueError('Select a bounded span from an indexed LaTeX manuscript')
        source = self.safe_path(name).read_text('utf-8-sig')
        if end > len(source):
            raise ValueError('Span exceeds manuscript length')
        return {'path': name, 'hash': a['hash'], 'start': start, 'end': end, 'text': source[start:end]}

    def dispatch(self, method, p):
        methods = {
            'scan': lambda: self.scan(p.get('paths')),
            'search_project': lambda: self.search(p.get('query', ''), p.get('kinds'), p.get('limit', 30)),
            'search_references': lambda: self.search(p.get('query', ''), ['bib', 'pdf'], p.get('limit', 30)),
            'search_results': lambda: self.search(p.get('query', ''), ['result'], p.get('limit', 30)),
            'search_code': lambda: self.search(p.get('query', ''), ['code'], p.get('limit', 30)),
            'get': lambda: self.get(p['id']),
            'resolve': lambda: [a for id in p['ids'][:100] if (a := self.get(id))],
            'get_pdf_passage': lambda: self.get(p['id']) if p['id'].startswith('pdf:') else None,
            'get_result_slice': lambda: self.result_slice(p['path'], p['rows'], p['columns']),
            'get_section': lambda: self.get(p['id']),
            'read_tex_span': lambda: self.read_tex_span(p['path'], p['start'], p['end']),
            'get_outline_node': lambda: self.get(p['id']),
            'get_paper_structure': lambda: self.search('', ['outline'], 100),
            'list_figures': lambda: self.search(p.get('query', ''), ['figure', 'table'], 100),
            'state': lambda: self.state(),
            'update_state': lambda: self.update_state(p['action'], p['payload']),
            'graph': lambda: self.graph(),
            'render_pdf': lambda: self.render_pdf(p['id'], p.get('page'), p.get('scale', 1.4)),
        }
        if method not in methods:
            raise ValueError(f'Unknown local operation: {method}')
        return methods[method]()


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: research_indexer.py WORKSPACE')
    index = Index(sys.argv[1])
    try:
        for line in sys.stdin:
            request = {}
            try:
                if len(line) > 1000000:
                    raise ValueError('Request exceeds size limit')
                request = json.loads(line)
                result = index.dispatch(request['method'], request.get('params') or {})
                response = {'id': request['id'], 'result': result}
            except Exception as e:
                response = {'id': request.get('id'), 'error': {'code': -32000, 'message': str(e)}}
            print(dumps(response), flush=True)
    finally:
        index.close()


if __name__ == '__main__':
    main()
