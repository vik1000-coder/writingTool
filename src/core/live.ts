import { hashText } from "./edits";
import { parseLatex } from "./latex";
import type { Artifact } from "./types";

/** Indexed offsets cannot be reused after an unsaved edit shifts the source. */
export function refreshManuscriptArtifact(
  artifact: Artifact,
  text: string,
): Artifact | undefined {
  const hash = hashText(text);
  if (artifact.hash === hash) return artifact;
  // Captions, figure links, and derived outline nodes must be reindexed on save.
  if (artifact.kind !== "tex") return undefined;
  const headings = parseLatex(artifact.path, text).headings;
  let start = 0,
    end = text.length;
  if (artifact.id.includes("#")) {
    const matches = headings.filter(
      (heading) => heading.title === artifact.title,
    );
    if (matches.length !== 1) return undefined;
    const heading = matches[0];
    start = heading.start;
    end =
      headings.find((next) => next.start > start && next.level <= heading.level)
        ?.start ?? text.length;
  }
  end = Math.min(end, start + 6000);
  return {
    ...artifact,
    text: text.slice(start, end),
    hash,
    locator: { start, end, line: text.slice(0, start).split("\n").length },
    metadata: { ...artifact.metadata, live: true },
  };
}
