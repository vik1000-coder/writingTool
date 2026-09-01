import * as vscode from "vscode";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, message: string) {
  const end = Date.now() + 5000;
  while (!check() && Date.now() < end) await delay(25);
  assert.ok(check(), message);
}
async function undoFixture(document: vscode.TextDocument, expected: string) {
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand(
    "workbench.action.focusActiveEditorGroup",
  );
  await vscode.commands.executeCommand("undo", document.uri);
  await delay(100);
  if (vscode.window.state.focused) {
    assert.equal(
      document.getText(),
      expected,
      "Native undo must restore the focused editor",
    );
  } else if (document.getText() !== expected) {
    // OS-background windows do not run native editor commands. Restore this
    // disposable fixture explicitly; do not count that as native undo coverage.
    const restore = new vscode.WorkspaceEdit();
    restore.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      ),
      expected,
    );
    await vscode.workspace.applyEdit(restore);
    await until(
      () => document.getText() === expected,
      "Restore background test fixture",
    );
  }
}

export async function run() {
  const root = process.env.RESEARCH_TEST_ROOT!;
  let callCount = 0,
    hold = 0,
    invented = false;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body),
      prompt = payload.messages[0].content as string;
    const packet = JSON.parse(
      prompt
        .split("CURRENT RESEARCH CONTEXT (JSON):\n")[1]
        .split("\nPRIOR CONVERSATION")[0],
    );
    callCount++;
    const pdfs = packet.artifacts.filter(
      (artifact: any, index: number, all: any[]) =>
        artifact.kind === "pdf" &&
        all.findIndex(
          (candidate) =>
            candidate.kind === "pdf" && candidate.path === artifact.path,
        ) === index,
    );
    const result = packet.artifacts.find(
      (a: any) =>
        a.kind === "result" &&
        a.locator.rows?.includes(6) &&
        a.path.endsWith("beta_sweep.csv"),
    );
    const suggestion = {
      mode: packet.mode,
      title: "Next argumentative step",
      text: "Explain how constraint strength changes the comparison.",
      insert_text:
        packet.mode === "write"
          ? invented
            ? "as established by \\cite{unknown2027}."
            : "with progressive ESS reaching 42."
          : "",
      evidence_ids: [
        ...pdfs.slice(0, 2).map((pdf: any) => pdf.id),
        result?.id,
      ].filter(Boolean),
      source_notes: pdfs.slice(0, 2).map((pdf: any, index: number) => ({
        artifact_id: pdf.id,
        summary:
          index === 0
            ? "A synthetic comparison of sampling approaches."
            : "A synthetic discussion of runtime and robustness tradeoffs.",
        relevance:
          index === 0
            ? "Context for the comparison at the cursor."
            : "Adds a limitation to address before interpreting efficiency.",
      })),
      outline_ids: [],
      citation_keys: [],
      claims:
        packet.mode === "write" && result && !invented
          ? [
              {
                value: "42",
                artifact_id: result.id,
                source_hash: result.hash,
                row: 6,
                column: "ess",
              },
            ]
          : [],
      proposal:
        packet.mode === "visual"
          ? {
              type: "figure",
              purpose: "Compare both methods across constraint strengths.",
              placement: "After the comparison paragraph",
              data_ids: result ? [result.id] : [],
              existing_artifact_ids: [],
              panels: ["ESS", "Runtime"],
            }
          : null,
      edit:
        packet.mode === "chat"
          ? {
              path: "paper/results.tex",
              original:
                "The synthetic results suggest a difference in effective sample size.",
              replacement:
                "The synthetic comparison motivates a closer look at effective sample size.",
            }
          : null,
    };
    if (hold) await delay(hold);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(suggestion) } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  try {
    const plainPath = path.join(root, "paper/plain-draft.txt");
    const plainOriginal =
      "# Results note\n\nThe synthetic comparison changes under stronger constraints.";
    await fs.writeFile(plainPath, plainOriginal);
    await vscode.workspace
      .getConfiguration("researchCopilot")
      .update(
        "localEndpoint",
        `http://127.0.0.1:${address.port}/v1`,
        vscode.ConfigurationTarget.Global,
      );
    const uri = vscode.Uri.file(path.join(root, "paper/results.tex"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, "latex");
    let editor = await vscode.window.showTextDocument(doc);
    const at =
      doc.getText().indexOf("We next compare") +
      "We next compare progressive bridging with direct sampling under stronger constraints."
        .length;
    editor.selection = new vscode.Selection(
      doc.positionAt(at),
      doc.positionAt(at),
    );
    const ext = vscode.extensions.getExtension(
      "research-copilot.research-copilot",
    );
    assert.ok(ext, "Extension must be discoverable");
    const api = await ext.activate();
    await api.ready();
    await delay(150);
    assert.equal(api.getState().mode, "guide");
    assert.ok(
      api.getState().report.count >= 15,
      "Real Python index must contain sample project artifacts",
    );
    assert.equal(callCount, 0, "Activation must not invoke a model");
    console.log("PASS activation, local index, no model call on activation");
    const original = doc.getText();
    for (const mode of ["guide", "evidence", "visual", "structure"]) {
      await api.setMode(mode);
      await api.suggest();
      assert.equal(
        api.getState().result?.suggestion.mode,
        mode,
        `Result for ${mode}`,
      );
      assert.equal(
        doc.getText(),
        original,
        `${mode} must leave manuscript untouched`,
      );
    }
    console.log(
      "PASS GUIDE, EVIDENCE, FIGURE/TABLE, STRUCTURE and read-only manuscript",
    );
    await api.setMode("guide");
    await api.suggest();
    const cardState = api.getState();
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      "vscode.executeHoverProvider",
      uri,
      editor.selection.active,
    );
    assert.ok(
      hovers?.some((h) =>
        h.contents.some(
          (c) =>
            typeof c !== "string" &&
            "value" in c &&
            c.value.includes("Next argumentative step"),
        ),
      ),
      "Native GUIDE hover must contain the escaped suggestion text",
    );
    const hoverMarkdown = hovers
      ?.flatMap((hover) => hover.contents)
      .filter((content): content is vscode.MarkdownString =>
        Boolean(content && typeof content !== "string" && "value" in content),
      )
      .map((content) => content.value)
      .join("\n");
    assert.match(hoverMarkdown || "", /Suggested references/);
    assert.match(hoverMarkdown || "", /ⓘ details/);
    assert.match(hoverMarkdown || "", /Summary · AI interpretation/);
    assert.match(hoverMarkdown || "", /Why suggested here/);
    assert.ok(
      cardState.guideReferences?.length >= 2,
      "GUIDE state must expose multiple grounded references when the project has them",
    );
    const sourceCard = cardState.sources.find(
      (s: any) => s.artifact.kind === "pdf",
    );
    assert.ok(sourceCard, "Fixture must have a PDF source card");
    await vscode.commands.executeCommand(
      "researchCopilot.referenceAction",
      cardState.cardToken,
      sourceCard.artifact.id,
      true,
    );
    assert.equal(
      api.getState().selectedSource?.artifact.text,
      sourceCard.artifact.text,
    );
    assert.equal(api.getState().selectedSource?.locked, true);
    editor.selection = new vscode.Selection(
      doc.positionAt(0),
      doc.positionAt(0),
    );
    await delay(100);
    assert.equal(
      api.getState().cardToken,
      undefined,
      "Cursor movement removes stale card",
    );
    assert.equal(
      api.getState().selectedSource?.locked,
      true,
      "Locked quote survives manuscript navigation",
    );
    await vscode.commands.executeCommand(
      "researchCopilot.referenceAction",
      cardState.cardToken,
      sourceCard.artifact.id,
      false,
    );
    assert.equal(
      api.getState().selectedSource?.locked,
      true,
      "Stale hover action cannot replace lock",
    );
    await api.ready();
    const pdfPath = path.join(root, sourceCard.artifact.path);
    const pdfBytes = await fs.readFile(pdfPath);
    await fs.writeFile(pdfPath, pdfBytes);
    await until(
      () => !api.getState().selectedSource,
      "Source file change must invalidate locked quotation",
    );
    await delay(650);
    editor.selection = new vscode.Selection(
      doc.positionAt(at),
      doc.positionAt(at),
    );
    await delay(100);
    console.log(
      "PASS native GUIDE card, exact locked quote, navigation and stale source/action invalidation",
    );
    const plainUri = vscode.Uri.file(plainPath);
    const plainDoc = await vscode.workspace.openTextDocument(plainUri);
    await vscode.languages.setTextDocumentLanguage(plainDoc, "plaintext");
    editor = await vscode.window.showTextDocument(plainDoc);
    editor.selection = new vscode.Selection(
      plainDoc.positionAt(plainDoc.getText().length),
      plainDoc.positionAt(plainDoc.getText().length),
    );
    await api.setMode("guide");
    await api.suggest();
    assert.equal(api.getState().context.current.path, "paper/plain-draft.txt");
    assert.equal(api.getState().result?.suggestion.mode, "guide");
    await api.setMode("write");
    await api.suggest();
    assert.equal(api.getState().ghost?.uri, plainUri.toString());
    assert.equal(plainDoc.getText(), plainOriginal);
    console.log("PASS GUIDE and WRITE operate on a plain-text manuscript");
    editor = await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(
      "workbench.action.focusActiveEditorGroup",
    );
    await api.setMode("write");
    await api.suggest();
    assert.equal(
      api.getState().cardToken,
      undefined,
      "WRITE must use ghost text, not a GUIDE card",
    );
    assert.equal(
      api.getState().result?.insertable,
      true,
      JSON.stringify(api.getState().result?.warnings),
    );
    assert.equal(
      doc.getText(),
      original,
      "WRITE must not insert before acceptance",
    );
    const generatedCalls = callCount;
    await api.setMode("write");
    await Promise.all([api.complete(), api.complete()]);
    assert.equal(
      callCount,
      generatedCalls,
      "Exact cached completion must avoid model inference",
    );
    assert.equal(api.getState().timing.source, "cache");
    const partial = "with progressive ESS reaching 4";
    await editor.edit((edit) => edit.insert(doc.positionAt(at), partial));
    editor.selection = new vscode.Selection(
      doc.positionAt(at + partial.length),
      doc.positionAt(at + partial.length),
    );
    await delay(50);
    await api.complete();
    assert.equal(
      api.getState().ghost?.text,
      "2.",
      "Only the untyped suffix should ghost, including a partially typed grounded number",
    );
    assert.equal(
      callCount,
      generatedCalls,
      "Typing a matching prefix must not call the model",
    );
    console.log(
      `PASS cached WRITE and typed suffix: ${JSON.stringify(api.getState().timing)}`,
    );
    await undoFixture(doc, original);
    editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(
      doc.positionAt(at),
      doc.positionAt(at),
    );
    await delay(50);
    await vscode.commands.executeCommand("researchCopilot.clearCache");
    hold = 100;
    await Promise.all([api.complete(), api.complete()]);
    hold = 0;
    assert.equal(
      callCount,
      generatedCalls + 1,
      "Concurrent identical misses must share one model call",
    );
    await api.suggest();
    assert.equal(
      callCount,
      generatedCalls + 2,
      "Explicit regeneration bypasses the cache",
    );
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
    await delay(400);
    assert.equal(
      api.getState().ghost?.text,
      "with progressive ESS reaching 42.",
    );
    if (vscode.window.state.focused) {
      assert.equal(
        api.getState().lastInlineRequest?.available,
        true,
        "VS Code must receive the validated native completion",
      );
      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.commit",
      );
      await delay(100);
      assert.ok(
        doc.getText().includes("with progressive ESS reaching 42."),
        "Native inline acceptance must work in a focused host",
      );
      await vscode.commands.executeCommand("undo", uri);
      await delay(100);
      console.log("PASS native acceptance and undo in a focused host");
    } else {
      console.log(
        "NOTE native rendering/commit skipped in unfocused OS window; validated completion state verified. See manual UI acceptance check.",
      );
    }
    assert.equal(doc.getText(), original);
    console.log("PASS grounded WRITE and native completion provider");
    invented = true;
    await api.suggest();
    assert.equal(
      api.getState().result?.insertable,
      false,
      "Invented citation blocks insertion",
    );
    invented = false;
    console.log("PASS fabricated citation blocks ghost text");
    await api.setMode("off");
    const calls = callCount;
    await api.suggest();
    assert.equal(callCount, calls);
    await api.suggest(
      "Please propose an edit to the synthetic-results sentence.",
    );
    assert.equal(api.getState().result?.suggestion.mode, "chat");
    assert.ok(api.getState().result?.suggestion.edit);
    assert.equal(
      doc.getText(),
      original,
      "Chat proposal must not mutate the file",
    );
    console.log(
      "PASS OFF suppresses suggestions, explicit Chat proposes without modifying",
    );
    void vscode.commands.executeCommand("researchCopilot.reviewEdit");
    await delay(400);
    assert.ok(
      vscode.workspace.textDocuments.some((d) =>
        d.uri.path.includes("proposed-"),
      ),
      "Review must open a real diff",
    );
    assert.equal(doc.getText(), original, "Opening the diff must not apply it");
    await vscode.commands.executeCommand("researchCopilot.applyEdit");
    await until(
      () =>
        doc
          .getText()
          .includes("The synthetic comparison motivates a closer look"),
      "Explicit approval applies the reviewed edit even after editor focus changes",
    );
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    editor = await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand(
      "workbench.action.focusActiveEditorGroup",
    );
    await delay(100);
    await undoFixture(doc, original);
    assert.equal(doc.getText(), original, "Reviewed edits remain undoable");
    console.log(
      "PASS reviewed diff and explicit apply; native undo checked only when OS-focused",
    );

    await api.suggest("Please propose the same edit again.");
    void vscode.commands.executeCommand("researchCopilot.reviewEdit");
    await delay(250);
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    editor = await vscode.window.showTextDocument(doc);
    await editor.edit((edit) =>
      edit.insert(doc.positionAt(at), " Changed after review."),
    );
    const changedAfterReview = doc.getText();
    await vscode.commands.executeCommand("researchCopilot.applyEdit");
    assert.equal(
      doc.getText(),
      changedAfterReview,
      "An obsolete reviewed edit must never apply",
    );
    await undoFixture(doc, original);
    assert.equal(doc.getText(), original);
    console.log("PASS stale reviewed edit rejection");

    await api.setMode("evidence");
    await api.suggest();
    const dataState = api.getState();
    const dataCard = dataState.sources.find((s: any) =>
      s.artifact.path.endsWith("beta_sweep.csv"),
    );
    assert.ok(dataCard);
    await vscode.commands.executeCommand(
      "researchCopilot.referenceAction",
      dataState.cardToken,
      dataCard.artifact.id,
      true,
    );
    assert.equal(api.getState().selectedSource?.locked, true);
    const sourceDoc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(root, "results/beta_sweep.csv")),
    );
    const sourceOriginal = sourceDoc.getText();
    const dirtyEdit = new vscode.WorkspaceEdit();
    dirtyEdit.insert(sourceDoc.uri, new vscode.Position(0, 0), "UNSAVED,");
    await vscode.workspace.applyEdit(dirtyEdit);
    await until(() => sourceDoc.isDirty, "Source document must be dirty");
    assert.equal(
      api.getState().cachedCompletions,
      0,
      "Editing any non-manuscript source must invalidate WRITE completions",
    );
    assert.equal(
      api.getState().selectedSource,
      undefined,
      "Dirty source buffer clears its locked quotation",
    );
    await api.setMode("evidence");
    await api.suggest();
    assert.ok(
      !api
        .getState()
        .context.artifacts.some((a: any) => a.path.endsWith("beta_sweep.csv")),
      "Unsaved source data must not be represented as fresh evidence",
    );
    assert.ok(
      api
        .getState()
        .context.warnings.some((w: string) => w.includes("unsaved")),
    );
    await vscode.window.showTextDocument(sourceDoc);
    await undoFixture(sourceDoc, sourceOriginal);
    await sourceDoc.save();
    editor = await vscode.window.showTextDocument(doc);
    await delay(100);
    console.log("PASS unsaved result source is withheld from context");
    await api.setMode("guide");
    hold = 500;
    const pending = api.suggest();
    await delay(200);
    await editor.edit((edit) => edit.insert(doc.positionAt(at), " Changed."));
    await pending.catch((e: Error) => assert.match(e.message, /abort|cancel/i));
    assert.equal(
      api.getState().result,
      undefined,
      "Late model response must not overwrite new manuscript state",
    );
    hold = 0;
    await undoFixture(doc, original);
    console.log("PASS cancellation and unsaved-edit stale-response rejection");
    const dataFile = path.join(root, "results/beta_sweep.csv");
    await fs.writeFile(
      dataFile,
      (await fs.readFile(dataFile, "utf8")).replace(
        "progressive,42",
        "progressive,41",
      ),
    );
    await delay(700);
    assert.equal(
      api.getState().result,
      undefined,
      "Changed evidence invalidates a suggestion",
    );
    await vscode.commands.executeCommand("researchCopilot.inspectContext");
    assert.ok(
      vscode.workspace.textDocuments.some(
        (d) => d.uri.scheme === "research-copilot-preview",
      ),
    );
    console.log("PASS evidence file watcher and inspectable request");
    await vscode.commands.executeCommand(
      "workbench.view.extension.researchCopilot",
    );
    await delay(300);
    console.log(
      "PASS Research Copilot sidebar opens in the real extension host",
    );
    await vscode.workspace
      .getConfiguration("researchCopilot")
      .update("automaticSuggestions", true, vscode.ConfigurationTarget.Global);
    await vscode.workspace
      .getConfiguration("researchCopilot")
      .update("debounceMs", 800, vscode.ConfigurationTarget.Global);
    editor = await vscode.window.showTextDocument(doc);
    await api.ready();
    await api.setMode("write");
    editor.selection = new vscode.Selection(
      doc.positionAt(doc.getText().length),
      doc.positionAt(doc.getText().length),
    );
    await delay(100);
    const beforeAuto = callCount;
    await editor.edit((edit) =>
      edit.insert(doc.positionAt(doc.getText().length), "A"),
    );
    await delay(300);
    assert.equal(
      callCount,
      beforeAuto,
      "Native automatic provider must not bypass debounce",
    );
    await editor.edit((edit) =>
      edit.insert(doc.positionAt(doc.getText().length), "B"),
    );
    await delay(300);
    assert.equal(
      callCount,
      beforeAuto,
      "Typing must restart the debounce timer",
    );
    await until(
      () => callCount === beforeAuto + 1,
      "One debounced model call should run after typing pauses: " +
        JSON.stringify({
          status: api.getState().status,
          mode: api.getState().mode,
          automatic: vscode.workspace
            .getConfiguration("researchCopilot")
            .get("automaticSuggestions"),
          beforeAuto,
          callCount,
        }),
    );
    await until(() => !api.getState().busy, "Automatic request must complete");
    await api.setMode("off");
    await editor.edit((edit) =>
      edit.insert(doc.positionAt(doc.getText().length), "C"),
    );
    await delay(1100);
    assert.equal(
      callCount,
      beforeAuto + 1,
      "OFF must suppress automatic calls even when enabled in settings",
    );
    console.log(
      "PASS automatic debounce, coalesced typing, and OFF suppression",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
