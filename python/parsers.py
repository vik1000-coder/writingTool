"""Bounded, non-executing parsers for local scientific artifacts."""
import ast
import csv
import io
import json
import math
from pathlib import Path
import re
import statistics


def group(text, start, opening='{', closing='}'):
    while start < len(text) and text[start].isspace():
        start += 1
    if start >= len(text) or text[start] != opening:
        return None
    depth, i = 1, start + 1
    while i < len(text):
        if text[i] == '\\':
            i += 2
            continue
        if text[i] == opening:
            depth += 1
        elif text[i] == closing:
            depth -= 1
            if not depth:
                return text[start + 1:i], i + 1
        i += 1
    return None


def parse_bibtex(text):
    entries, strings, keys = [], {}, set()
    i = 0
    while i < len(text):
        match = re.search(r'@(\w+)\s*([({])', text[i:])
        if not match:
            break
        kind = match[1].lower()
        start = i + match.end() - 1
        enclosed = group(text, start, match[2], ')' if match[2] == '(' else '}')
        if not enclosed:
            raise ValueError('Unbalanced BibTeX entry')
        body, i = enclosed
        if kind in ('comment', 'preamble'):
            continue
        key = None
        if kind != 'string':
            if ',' not in body:
                raise ValueError('BibTeX entry has no fields')
            key, body = body.split(',', 1)
            key = key.strip()
            if not re.fullmatch(r'[A-Za-z0-9_:./+@-]+', key) or key in keys:
                raise ValueError(f'Invalid or duplicate BibTeX key: {key}')
            keys.add(key)
        fields, pos = {}, 0
        while pos < len(body):
            field = re.match(r'[\s,]*(\w+)\s*=\s*', body[pos:])
            if not field:
                if body[pos:].strip(' ,\r\n\t'):
                    raise ValueError('Invalid BibTeX field')
                break
            name = field[1].lower()
            pos += field.end()
            parts = []
            while pos < len(body):
                if body[pos] == '{':
                    value = group(body, pos)
                    if not value:
                        raise ValueError('Unbalanced BibTeX value')
                    part, pos = value
                elif body[pos] == '"':
                    pos += 1
                    begin, depth = pos, 0
                    while pos < len(body):
                        if body[pos] == '\\':
                            pos += 2
                            continue
                        if body[pos] == '{':
                            depth += 1
                        elif body[pos] == '}':
                            depth -= 1
                        elif body[pos] == '"' and depth == 0:
                            break
                        pos += 1
                    if pos >= len(body):
                        raise ValueError('Unclosed BibTeX quote')
                    part, pos = body[begin:pos], pos + 1
                else:
                    atom = re.match(r'[^,#\s]+', body[pos:])
                    if not atom:
                        raise ValueError('Empty BibTeX value')
                    part = strings.get(atom[0].lower(), atom[0])
                    pos += atom.end()
                parts.append(part)
                while pos < len(body) and body[pos].isspace():
                    pos += 1
                if pos < len(body) and body[pos] == '#':
                    pos += 1
                    while pos < len(body) and body[pos].isspace():
                        pos += 1
                    continue
                break
            fields[name] = ''.join(parts)
        if kind == 'string':
            strings.update(fields)
        else:
            entries.append({'key': key, 'entry_type': kind, **fields})
    return entries


def mask_tex(text):
    text = re.sub(r'(?<!\\)(?:\\\\)*%[^\n]*', lambda m: ' ' * len(m[0]), text)
    return re.sub(r'\\begin\{(verbatim\*?|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}', lambda m: ''.join('\n' if c == '\n' else ' ' for c in m[0]), text)


def tex_commands(source):
    masked = mask_tex(source)
    for m in re.finditer(r'\\([a-zA-Z]+)\*?', masked):
        cursor = m.end()
        while True:
            opt = group(masked, cursor, '[', ']')
            if not opt:
                break
            cursor = opt[1]
        arg = group(masked, cursor)
        if arg:
            yield m[1], arg[0], m.start(), arg[1]


def value(cell):
    if cell is None or cell == '':
        return None
    if isinstance(cell, (dict, list)):
        return json.dumps(cell, ensure_ascii=False, allow_nan=False)
    if isinstance(cell, bool):
        return cell
    if isinstance(cell, (int, float)):
        return cell if math.isfinite(cell) else None
    if re.fullmatch(r'[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?', cell.strip()):
        number = float(cell)
        if math.isfinite(number):
            return int(cell) if re.fullmatch(r'[-+]?\d+', cell.strip()) else number
    return cell


def data_rows(path, source, max_rows=100000):
    suffix = Path(path).suffix.lower()
    if suffix == '.csv':
        reader = csv.DictReader(io.StringIO(source.lstrip('\ufeff')))
        columns = reader.fieldnames or []
        if not columns or len(set(columns)) != len(columns) or any(not c for c in columns):
            raise ValueError('CSV requires nonempty, unique column names')
        rows = []
        for raw in reader:
            if len(rows) >= max_rows:
                raise ValueError(f'Dataset exceeds {max_rows:,} rows; configure a smaller research data export')
            if None in raw or any(v is None for v in raw.values()):
                raise ValueError('CSV row does not match header dimensions')
            rows.append({k: value(v) for k, v in raw.items()})
    else:
        obj = json.loads(source, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON value')))
        if isinstance(obj, dict) and len(obj) == 1 and isinstance(next(iter(obj.values())), list):
            obj = next(iter(obj.values()))
        if isinstance(obj, dict):
            flattened = []
            def flatten(item, prefix=''):
                for k, v in item.items():
                    key = f'{prefix}.{k}' if prefix else k
                    if isinstance(v, dict):
                        flatten(v, key)
                    else:
                        flattened.append({'metric': key, 'value': value(v)})
            flatten(obj)
            obj = flattened
        if not isinstance(obj, list):
            obj = [{'value': obj}]
        if len(obj) > max_rows:
            raise ValueError(f'Dataset exceeds {max_rows:,} rows')
        rows = [{str(k): value(v) for k, v in r.items()} if isinstance(r, dict) else {'value': value(r)} for r in obj]
        columns = list(dict.fromkeys(k for r in rows for k in r))
        rows = [{k: r.get(k) for k in columns} for r in rows]
    if len(columns) > 200:
        raise ValueError('Dataset exceeds 200 columns; select a narrower export')
    if any(len(str(cell)) > 5000 for row in rows for cell in row.values()):
        raise ValueError('Result cell exceeds 5,000 characters')
    schema, stats = {}, {}
    for col in columns:
        cells = [r[col] for r in rows if r[col] is not None]
        numeric = [c for c in cells if isinstance(c, (int, float)) and not isinstance(c, bool)]
        schema[col] = 'number' if cells and len(cells) == len(numeric) else 'boolean' if cells and all(isinstance(c, bool) for c in cells) else 'string' if cells and all(isinstance(c, str) for c in cells) else 'mixed' if cells else 'null'
        if numeric:
            stats[col] = {'count': len(numeric), 'missing': len(rows) - len(cells), 'min': min(numeric), 'max': max(numeric), 'mean': statistics.fmean(numeric), 'median': statistics.median(numeric)}
    return columns, rows, schema, stats


def code_nodes(source):
    tree = ast.parse(source)
    imports = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
    lines = source.splitlines()
    items = []
    def walk(node, parents=()):
        for child in ast.iter_child_nodes(node):
            scope = parents
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                scope = (*parents, child.name)
                paths = [n.value for n in ast.walk(child) if isinstance(n, ast.Constant) and isinstance(n.value, str) and re.search(r'\.(csv|json|pdf|png|svg|parquet)$', n.value)]
                items.append({'name': '.'.join(scope), 'line': child.lineno, 'end_line': child.end_lineno, 'docstring': ast.get_docstring(child), 'imports': imports, 'paths': paths, 'text': '\n'.join(lines[child.lineno - 1:child.end_lineno])[:8000]})
            walk(child, scope)
    walk(tree)
    if not items:
        items.append({'name': 'module', 'line': 1, 'text': source[:8000], 'imports': imports, 'paths': [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and re.search(r'\.(csv|json|pdf|png|svg|parquet)$', n.value)]})
    return items
