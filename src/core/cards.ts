import type { Artifact, ResolvedSuggestion } from "./types";

export interface SourceCard {
  artifact: Artifact;
  summary: string;
  relevance: string;
}

// Titles and quotations are local facts. Model notes are explicitly labelled
// interpretations and can only attach to already resolved evidence.
export function sourceCards(
  result: ResolvedSuggestion,
  artifacts: Artifact[],
): SourceCard[] {
  return result.evidence
    .filter((a) => a.kind !== "tex" && a.kind !== "outline")
    .map((a) => {
      const bib =
        a.kind === "pdf"
          ? artifacts.find(
              (b) =>
                b.kind === "bib" &&
                (b.metadata.pdf_path === a.path ||
                  (typeof a.metadata.citation_key === "string" &&
                    b.metadata.key === a.metadata.citation_key)),
            )
          : undefined;
      const note = result.suggestion.source_notes?.find(
        (n) => n.artifact_id === a.id,
      );
      return {
        artifact: { ...a, title: bib?.title ?? a.title },
        summary: note?.summary || "No AI summary supplied.",
        relevance:
          note?.relevance ||
          "Selected for this suggestion; check the source before using it.",
      };
    });
}
