import type { Artifact, ResolvedSuggestion } from "./types";

export interface SourceCard {
  artifact: Artifact;
  summary: string;
  relevance: string;
  details: string;
}

const shortened = (value: string, max = 350) =>
  value.length > max ? value.slice(0, max - 1) + "…" : value;

function sourceDetails(card: Omit<SourceCard, "details">) {
  const { artifact, summary, relevance } = card;
  return [
    `Source · ${artifact.title}`,
    `Location · ${artifact.path}${artifact.locator.page ? ` · p. ${artifact.locator.page}` : ""}`,
    `Summary · AI interpretation\n${shortened(summary)}`,
    `Why suggested here · AI interpretation\n${shortened(relevance)}`,
    ...(artifact.kind === "bib"
      ? ["Citation candidate · exact full text has not been selected"]
      : []),
  ].join("\n");
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
      const card = {
        artifact: { ...a, title: bib?.title ?? a.title },
        summary: note?.summary || "No AI summary supplied.",
        relevance:
          note?.relevance ||
          "Selected for this suggestion; check the source before using it.",
      };
      return { ...card, details: sourceDetails(card) };
    });
}

/** Papers are the useful GUIDE shortlist. Prefer a locally selected PDF over
 * duplicate bibliography metadata. Results and other artifacts remain in
 * their own panels instead of being mislabeled as references. */
export function suggestedReferences(sources: SourceCard[], limit = 3) {
  const papers = sources
    .filter((source) => ["pdf", "bib"].includes(source.artifact.kind))
    .sort(
      (a, b) =>
        Number(b.artifact.kind === "pdf") - Number(a.artifact.kind === "pdf"),
    );
  const seen = new Set<string>();
  return papers
    .filter((source) => {
      const metadata = source.artifact.metadata,
        identity = String(
          metadata.citation_key ?? metadata.key ?? source.artifact.id,
        );
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, Math.max(0, limit));
}
