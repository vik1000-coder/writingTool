import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSuggestion,
  resolveSuggestion,
  OUTPUT_SCHEMA,
  schemaForMode,
} from "../src/core/integrity";
import { assembleContext } from "../src/core/context";
import { prepareEdit } from "../src/core/edits";
import type { Artifact, Suggestion } from "../src/core/types";
export const response = (extra: Partial<Suggestion> = {}): Suggestion => ({
  mode: "guide",
  title: "Next step",
  text: "Discuss the constraint.",
  insert_text: "",
  evidence_ids: [],
  outline_ids: [],
  citation_keys: [],
  claims: [],
  proposal: null,
  edit: null,
  ...extra,
});
const artifact = (extra: Partial<Artifact>): Artifact => ({
  id: "result:results/run.csv#rows-1-2",
  kind: "result",
  path: "results/run.csv",
  title: "Results",
  text: "ess beta",
  hash: "current-hash",
  locator: { rows: [1, 2], columns: ["ess"] },
  metadata: { rows: [{ ess: 42 }, { ess: 7 }] },
  ...extra,
});
test("compact WRITE output keeps evidence/citation/numeric gates with no research-card overhead", () => {
  assert.deepEqual(Object.keys(schemaForMode("write").properties), [
    "insert_text",
    "evidence_ids",
    "citation_keys",
    "claims",
  ]);
  const compact = {
    insert_text: "with ESS reaching 42.",
    evidence_ids: [artifact({}).id],
    citation_keys: [],
    claims: [
      {
        value: "42",
        artifact_id: artifact({}).id,
        source_hash: "current-hash",
        row: 1,
        column: "ess",
      },
    ],
  };
  const parsed = validateSuggestion(compact, "write");
  assert.equal(parsed.mode, "write");
  assert.equal(resolveSuggestion(parsed, [artifact({})]).insertable, true);
  assert.equal(
    resolveSuggestion(validateSuggestion({ ...compact, claims: [] }, "write"), [
      artifact({}),
    ]).insertable,
    false,
  );
  assert.throws(() => validateSuggestion(compact, "guide"));
});

test("mode contracts reject unexpected prose, giant continuations, unknown modes, and edits outside Chat", () => {
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.throws(() =>
    validateSuggestion(
      response({ insert_text: "Unauthorized prose." }),
      "guide",
    ),
  );
  assert.throws(() =>
    validateSuggestion(
      response({ mode: "write", insert_text: "x".repeat(601) }),
      "write",
    ),
  );
  assert.throws(() =>
    validateSuggestion(
      response({ edit: { path: "x.tex", original: "x", replacement: "y" } }),
      "guide",
    ),
  );
  assert.throws(() =>
    validateSuggestion(response({ mode: "structure" }), "guide"),
  );
  assert.equal(
    validateSuggestion(
      response({ mode: "write", insert_text: "under stronger constraints." }),
      "write",
    ).insert_text,
    "under stronger constraints.",
  );
});
test("quotation comes from local artifact; fabricated IDs and citations are never trusted", () => {
  const pdf = artifact({
    id: "pdf:ref.pdf#page-7-block-1",
    kind: "pdf",
    text: "Exact source, not invented.",
    locator: { page: 7, bbox: [1, 2, 3, 4] },
  });
  const resolved = resolveSuggestion(
    response({
      mode: "evidence",
      evidence_ids: [pdf.id, "pdf:imaginary"],
      citation_keys: ["unknown"],
    }),
    [pdf],
  );
  assert.equal(resolved.evidence[0].text, "Exact source, not invented.");
  assert.equal(resolved.evidence.length, 1);
  assert.ok(resolved.warnings.some((w) => /unknown/i.test(w)));
});
test("WRITE requires an exact, current result cell for every number; stale hashes and forged computed status fail closed", () => {
  const result = artifact({});
  const base = response({
    mode: "write",
    insert_text: "with ESS reaching 42.",
    evidence_ids: [result.id],
    claims: [
      {
        value: "42",
        artifact_id: result.id,
        source_hash: result.hash,
        row: 1,
        column: "ess",
      },
    ],
  });
  assert.equal(resolveSuggestion(base, [result]).insertable, true);
  assert.equal(
    resolveSuggestion({ ...base, claims: [] }, [result]).insertable,
    false,
  );
  assert.equal(
    resolveSuggestion(
      { ...base, claims: [{ ...base.claims[0], source_hash: "stale" }] },
      [result],
    ).insertable,
    false,
  );
  assert.equal(
    resolveSuggestion({ ...base, claims: [{ ...base.claims[0], row: 2 }] }, [
      result,
    ]).insertable,
    false,
  );
  assert.equal(
    resolveSuggestion(
      { ...base, insert_text: "with ESS reaching 42 and error 9." },
      [result],
    ).insertable,
    false,
  );
});
test("unknown inline citation is blocked even when omitted from citation_keys", () => {
  assert.equal(
    resolveSuggestion(
      response({
        mode: "write",
        insert_text: "as shown by \\cite{invented2027}.",
      }),
      [],
    ).insertable,
    false,
  );
  const bib = artifact({
    id: "bib:smith2024",
    kind: "bib",
    metadata: { key: "smith2024" },
  });
  const r = resolveSuggestion(
    response({ mode: "write", insert_text: "as shown by \\cite{smith2024}." }),
    [bib],
  );
  assert.equal(r.insertable, true);
  assert.ok(r.warnings.some((w) => /full.text evidence not verified/i.test(w)));
});
test("numeric checks preserve decimal fractions and Unicode negative signs", () => {
  const result = artifact({});
  const claim = {
    value: "42",
    artifact_id: result.id,
    source_hash: result.hash,
    row: 1,
    column: "ess",
  };
  assert.equal(
    resolveSuggestion(
      response({
        mode: "write",
        insert_text: "with a value of −42.",
        claims: [claim],
      }),
      [result],
    ).insertable,
    false,
  );
  const five = artifact({ metadata: { rows: [{ ess: 5 }, { ess: 7 }] } });
  assert.equal(
    resolveSuggestion(
      response({
        mode: "write",
        insert_text: "with a value of .5.",
        claims: [{ ...claim, value: "5" }],
      }),
      [five],
    ).insertable,
    false,
  );
});
test("prose continuation rejects TeX execution directives and comment injection", () => {
  for (const insert_text of [
    "\\input{secrets}",
    "\\write18{command}",
    "with 42% improvement.",
  ])
    assert.throws(() =>
      validateSuggestion(response({ mode: "write", insert_text }), "write"),
    );
  assert.doesNotThrow(() =>
    validateSuggestion(
      response({ mode: "write", insert_text: "with a 42\\% improvement." }),
      "write",
    ),
  );
});
test("context is bounded, pinned first, exclusions honored, mode-specific, and current text wins", () => {
  const records = Array.from({ length: 20 }, (_, i) =>
    artifact({ id: `note:${i}`, kind: "note", text: "x".repeat(1500) }),
  );
  const pinned = artifact({
    id: "result:pinned",
    text: "Pinned relevant result",
  });
  const context = assembleContext({
    mode: "evidence",
    path: "paper/a.tex",
    text: "\\section{Results}\nNew result.",
    offset: 29,
    artifacts: [...records, pinned],
    pins: [pinned.id],
    excluded: ["note:0"],
    budget: 4000,
  });
  assert.ok(JSON.stringify(context).length <= 4000);
  assert.equal(context.artifacts[0].id, pinned.id);
  assert.ok(!context.artifacts.some((a) => a.id === "note:0"));
  assert.match(context.current.paragraph, /New result/);
  assert.ok(context.warnings.some((w) => /budget/i.test(w)));
});
test("edit preview refuses ambiguous replacement, stale source, non-manuscript files, and traversal", () => {
  assert.equal(
    prepareEdit(
      { path: "paper/results.tex", original: "old", replacement: "new" },
      "old sentence.",
    ).updated,
    "new sentence.",
  );
  assert.throws(() =>
    prepareEdit(
      { path: "results/raw.csv", original: "1", replacement: "2" },
      "1",
    ),
  );
  assert.throws(() =>
    prepareEdit({ path: "../x.tex", original: "a", replacement: "b" }, "a"),
  );
  assert.throws(() =>
    prepareEdit({ path: "x.tex", original: "a", replacement: "b" }, "a a"),
  );
  assert.throws(() =>
    prepareEdit(
      { path: "x.tex", original: "old", replacement: "new" },
      "changed",
    ),
  );
});
