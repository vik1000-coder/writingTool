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
