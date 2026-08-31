import path from "node:path";
export interface Span {
  start: number;
  end: number;
}
export interface Heading extends Span {
  id: string;
  title: string;
  level: number;
}
export interface LatexAst {
  path: string;
  headings: Heading[];
  includes: (Span & { path: string })[];
  citations: (Span & { key: string })[];
  labels: (Span & { name: string })[];
  references: (Span & { name: string })[];
  figures: (Span & { path: string })[];
}

/** Replace ignored syntax with spaces so every source offset remains exact. */
export function maskLatex(text: string): string {
  const chars = text.split("");
  const blank = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "%") continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) backslashes++;
    if (backslashes % 2 === 0) {
      const end = text.indexOf("\n", i);
      blank(i, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end;
    }
  }
  const uncommented = chars.join("");
  const re =
    /\\begin\{(verbatim\*?|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}|\\verb\*?([^\w\s])[^\n]*?\2/g;
  for (const match of uncommented.matchAll(re))
    blank(match.index!, match.index! + match[0].length);
  return chars.join("");
}

function group(
  text: string,
  from: number,
  open: string,
  close: string,
): (Span & { value: string }) | undefined {
  let i = from;
  while (/\s/.test(text[i] ?? "") && i < text.length) i++;
  if (text[i] !== open) return undefined;
  const start = i++;
  let depth = 1;
  for (; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === open) depth++;
    if (text[i] === close) {
      depth--;
      if (depth === 0)
        return { value: text.slice(start + 1, i), start, end: i + 1 };
    }
  }
  return undefined;
}

export function parseLatex(file: string, source: string): LatexAst {
  const text = maskLatex(source);
  const ast: LatexAst = {
    path: file,
    headings: [],
    includes: [],
    citations: [],
    labels: [],
    references: [],
    figures: [],
  };
  const levels: Record<string, number> = {
    part: 0,
    chapter: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
    paragraph: 5,
    subparagraph: 6,
  };
  const re = /\\([a-zA-Z]+)(\*)?/g;
  const occurrences = new Map<string, number>();
  for (const match of text.matchAll(re)) {
    const command = match[1];
    let cursor = match.index! + match[0].length;
    let option;
    while ((option = group(text, cursor, "[", "]"))) cursor = option.end;
    const arg = group(text, cursor, "{", "}");
    if (!arg) continue;
    const span = { start: match.index!, end: arg.end };
    if (Object.hasOwn(levels, command)) {
      const slug =
        arg.value
          .toLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "section";
      const n = occurrences.get(slug) ?? 0;
      occurrences.set(slug, n + 1);
      ast.headings.push({
        ...span,
        level: levels[command],
        title: arg.value,
        id: `tex:${file}#${slug}${n ? `-${n + 1}` : ""}`,
      });
    } else if (
      command === "input" ||
      command === "include" ||
      command === "subfile"
    )
      ast.includes.push({ ...span, path: arg.value });
    else if (
      /^(?:[a-zA-Z]*cite[a-zA-Z]*)$/.test(command) &&
      command !== "nocite"
    ) {
      for (const key of arg.value
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean))
        ast.citations.push({ ...span, key });
    } else if (command === "label")
      ast.labels.push({ ...span, name: arg.value });
    else if (/^(?:ref|eqref|autoref|cref|Cref|pageref)$/.test(command))
      ast.references.push({ ...span, name: arg.value });
    else if (command === "includegraphics")
      ast.figures.push({ ...span, path: arg.value });
  }
  return ast;
}

export function cursorContext(text: string, offset: number, ast: LatexAst) {
  offset = Math.max(0, Math.min(text.length, offset));
  const before = text.slice(0, offset);
  const boundaries = [...before.matchAll(/\n\s*\n/g)];
  const last = boundaries.at(-1);
  const start = last ? last.index! + last[0].length : 0;
  const after = text.slice(offset);
  const next = /\n\s*\n/.exec(after);
  const end = next ? offset + next.index : text.length;
  const headings: Heading[] = [];
  for (const h of ast.headings) {
    if (h.start > offset) break;
    while (headings.length && headings.at(-1)!.level >= h.level) headings.pop();
    headings.push(h);
  }
  return {
    start,
    end,
    paragraph: text.slice(start, end),
    before: before.slice(-4000),
    after: after.slice(0, 1600),
    headings,
  };
}

export function resolveIncludes(
  root: string,
  files: ReadonlyMap<string, string>,
) {
  const paths: string[] = [],
    warnings: string[] = [];
  const active = new Set<string>(),
    seen = new Set<string>();
  const visit = (file: string) => {
    if (active.has(file)) {
      warnings.push(`Include cycle at ${file}`);
      return;
    }
    if (seen.has(file)) return;
    const text = files.get(file);
    if (text === undefined) {
      warnings.push(`Missing manuscript: ${file}`);
      return;
    }
    active.add(file);
    seen.add(file);
    paths.push(file);
    for (const include of parseLatex(file, text).includes) {
      let name = include.path;
      if (!path.posix.extname(name)) name += ".tex";
      const candidates = [
        path.posix.join(path.posix.dirname(root), name),
        path.posix.join(path.posix.dirname(file), name),
      ];
      const target = candidates.find(
        (c) =>
          !c.startsWith("../") && !path.posix.isAbsolute(c) && files.has(c),
      );
      if (target) visit(target);
      else warnings.push(`Unresolved include ${include.path} in ${file}`);
    }
    active.delete(file);
  };
  visit(root);
  return { paths, warnings };
}
