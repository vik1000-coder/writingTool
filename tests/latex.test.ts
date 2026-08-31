import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatex, cursorContext, resolveIncludes } from '../src/core/latex';

test('LaTeX parser retains offsets, nested headings, starred sections and ignores comments/verbatim', () => {
  const text = '% \\section{Not real}\n\\section[Short]{Results with \\emph{care}}\n\\label{sec:results}\nFirst 20\\% result. \\citep[p. 7]{smith2024,jones2025}\n\n\\subsection*{Cost}\nRuntime.\n\\begin{verbatim}\n\\section{fake}\n\\end{verbatim}\n\\input{methods}\n';
  const ast = parseLatex('paper/main.tex', text);
  assert.deepEqual(ast.headings.map(h => h.title), ['Results with \\emph{care}', 'Cost']);
  assert.deepEqual(ast.citations.map(c => c.key), ['smith2024', 'jones2025']);
  assert.equal(ast.labels[0].name, 'sec:results');
  assert.equal(text.slice(ast.headings[0].start, ast.headings[0].end), '\\section[Short]{Results with \\emph{care}}');
  assert.equal(ast.includes[0].path, 'methods');
  const context = cursorContext(text, text.indexOf(' result.') + 8, ast);
  assert.equal(context.headings[0].title, ast.headings[0].title);
  assert.match(context.paragraph, /First 20/);
  assert.ok(!context.paragraph.includes('Runtime'));
});

test('cursor at paragraph boundary and after trailing newline remains bounded', () => {
  const text = '\\section{Results}\nAlpha.\n\nBeta.';
  assert.match(cursorContext(text, text.length, parseLatex('x.tex', text)).paragraph, /Beta/);
  assert.equal(cursorContext('', 0, parseLatex('x.tex', '')).paragraph, '');
});

test('multi-file expansion follows TeX root lookup, reports missing files, avoids cycles and traversal', () => {
  const files = new Map([['paper/main.tex', '\\input{parts/result}\\include{absent}'], ['paper/parts/result.tex', '\\input{main}\\section{Results}\\input{../../outside}']]);
  const project = resolveIncludes('paper/main.tex', files);
  assert.deepEqual(project.paths, ['paper/main.tex', 'paper/parts/result.tex']);
  assert.ok(project.warnings.some(w => /cycle/i.test(w)));
  assert.ok(project.warnings.some(w => /absent/.test(w)));
});
