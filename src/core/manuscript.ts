import path from "node:path";
import { parseLatex, type LatexAst } from "./latex";

export const isManuscriptPath = (file: string) =>
  [".tex", ".txt"].includes(path.extname(file).toLowerCase());

export const citationText = (file: string, key: string) =>
  path.extname(file).toLowerCase() === ".tex" ? `\\cite{${key}}` : `[${key}]`;

/** Plain text stays deliberately simple: Markdown-style or underlined headings
 * provide section context, while all other text is treated as prose. */
export function parseManuscript(file: string, source: string): LatexAst {
  if (path.extname(file).toLowerCase() === ".tex")
    return parseLatex(file, source);
  const ast: LatexAst = {
    path: file,
    headings: [],
    includes: [],
    citations: [],
    labels: [],
    references: [],
    figures: [],
  };
  const candidates: {
    start: number;
    end: number;
    title: string;
    level: number;
  }[] = [];
  for (const match of source.matchAll(/^(#{1,6})[ \t]+(.+?)[ \t]*$/gm))
    candidates.push({
      start: match.index!,
      end: match.index! + match[0].length,
      title: match[2].trim(),
      level: match[1].length,
    });
  for (const match of source.matchAll(/^([^#\n][^\n]*)\n(=+|-+)[ \t]*$/gm))
    if (!candidates.some((heading) => heading.start === match.index))
      candidates.push({
        start: match.index!,
        end: match.index! + match[0].length,
        title: match[1].trim(),
        level: match[2][0] === "=" ? 1 : 2,
      });
  const occurrences = new Map<string, number>();
  for (const heading of candidates.sort((a, b) => a.start - b.start)) {
    if (!heading.title) continue;
    const slug =
      heading.title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, "") || "section";
    const count = (occurrences.get(slug) ?? 0) + 1;
    occurrences.set(slug, count);
    ast.headings.push({
      ...heading,
      id: `tex:${file}#${slug}${count > 1 ? `-${count}` : ""}`,
    });
  }
  return ast;
}
