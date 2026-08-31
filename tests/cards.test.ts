import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceCards } from "../src/core/cards";
import { validateSuggestion, resolveSuggestion } from "../src/core/integrity";
import type { Artifact } from "../src/core/types";
const pdf: Artifact = {
  id: "pdf:source#1",
  kind: "pdf",
  path: "refs/source.pdf",
  title: "source — p. 1",
  text: "Exact original passage.\nSecond line.",
  hash: "h",
  locator: { page: 1 },
  metadata: { citation_key: "key" },
};
const bib: Artifact = {
  ...pdf,
  id: "bib:key",
  kind: "bib",
  path: "refs/library.bib",
  title: "A real paper title",
  text: "Bibliography only",
  metadata: { key: "key", pdf_path: pdf.path },
};
const response = {
  mode: "guide",
  title: "Compare approaches",
  text: "Discuss the limitation.",
  insert_text: "",
  evidence_ids: [pdf.id],
  outline_ids: [],
  citation_keys: [],
  claims: [],
  proposal: null,
  edit: null,
  source_notes: [
    {
      artifact_id: pdf.id,
      summary: "The paper compares approaches.",
      relevance: "Provides a limitation for this paragraph.",
    },
  ],
};
test("source cards join local paper titles, separate AI notes from exact quotes, and reject invented source IDs", () => {
  const suggestion = validateSuggestion(response, "guide");
  const cards = sourceCards(resolveSuggestion(suggestion, [pdf, bib]), [
    pdf,
    bib,
  ]);
  assert.equal(cards[0].artifact.title, bib.title);
  assert.equal(cards[0].artifact.text, pdf.text);
  assert.equal(cards[0].summary, response.source_notes[0].summary);
  assert.equal(cards[0].relevance, response.source_notes[0].relevance);
  assert.equal(sourceCards(resolveSuggestion(suggestion, []), []).length, 0);
  assert.throws(() =>
    validateSuggestion(
      {
        ...response,
        source_notes: [
          { ...response.source_notes[0], summary: "x".repeat(2001) },
        ],
      },
      "guide",
    ),
  );
  assert.throws(
    () =>
      validateSuggestion(
        {
          ...response,
          source_notes: [
            { ...response.source_notes[0], artifact_id: "invented" },
          ],
        },
        "guide",
      ),
    /evidence/,
  );
});
test("bibliography-only and legacy responses never invent a quotation or summary", () => {
  const suggestion = validateSuggestion(
    { ...response, evidence_ids: [bib.id], source_notes: undefined },
    "guide",
  );
  const cards = sourceCards(resolveSuggestion(suggestion, [bib]), [bib]);
  assert.equal(cards[0].summary, "No AI summary supplied.");
  assert.equal(cards[0].artifact.kind, "bib");
});
