import { test } from "node:test";
import assert from "node:assert/strict";
import { hashText } from "../src/core/edits";
import { refreshManuscriptArtifact } from "../src/core/live";
import type { Artifact } from "../src/core/types";

test("unsaved manuscript sections use fresh offsets and renamed/derived stale artifacts are withheld", () => {
  const saved = "\\section{A}\nOld.\n\\section{B}\nTarget.";
  const artifact: Artifact = {
    id: "tex:paper.tex#b",
    kind: "tex",
    path: "paper.tex",
    title: "B",
    text: "Target.",
    hash: hashText(saved),
    locator: { start: saved.indexOf("\\section{B}"), end: saved.length },
    metadata: {},
  };
  const live = saved.replace("Old.", "A much longer unsaved introduction.");
  const refreshed = refreshManuscriptArtifact(artifact, live)!;
  assert.equal(refreshed.text, "\\section{B}\nTarget.");
  assert.equal(refreshed.locator.start, live.indexOf("\\section{B}"));
  assert.equal(refreshed.hash, hashText(live));
  assert.equal(refreshManuscriptArtifact(artifact, saved), artifact);
  assert.equal(
    refreshManuscriptArtifact(artifact, live.replace("{B}", "{New heading}")),
    undefined,
  );
  assert.equal(
    refreshManuscriptArtifact({ ...artifact, kind: "figure" }, live),
    undefined,
  );
});

test("unsaved plain-text manuscript sections retain current headings and offsets", () => {
  const saved = "# Results\nOld.\n\n# Discussion\nTarget.";
  const artifact: Artifact = {
    id: "tex:paper/draft.txt#discussion",
    kind: "tex",
    path: "paper/draft.txt",
    title: "Discussion",
    text: "# Discussion\nTarget.",
    hash: hashText(saved),
    locator: { start: saved.indexOf("# Discussion"), end: saved.length },
    metadata: { format: "plaintext" },
  };
  const live = saved.replace("Old.", "A longer unsaved opening paragraph.");
  const refreshed = refreshManuscriptArtifact(artifact, live)!;
  assert.equal(refreshed.text, "# Discussion\nTarget.");
  assert.equal(refreshed.locator.start, live.indexOf("# Discussion"));
  assert.equal(refreshed.hash, hashText(live));
});
