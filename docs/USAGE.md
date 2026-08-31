# Using Research Copilot

[Guide index](README.md) · [Configuration](CONFIGURATION.md) · [Troubleshooting](TROUBLESHOOTING.md)

Research Copilot works inside VS Code alongside your normal LaTeX editor and compiler. It reads local project files, offers suggestions, and leaves authorship and scientific judgment to you. You can browse and search the local index without making a model request.

## First session

1. Follow [local setup](CONFIGURATION.md#development-window-or-installed-extension) to launch the example development window, or [install the VSIX](CONFIGURATION.md#install-the-vsix) and open your own research folder.
2. Open **Research Copilot** in the activity bar. Run **Research Copilot: Check Local Setup** from the command palette to check Python, PDF support, and the artifact count.
3. For the default subscription backend, run **Research Copilot: Sign in with ChatGPT** and finish authentication in your browser. Existing Codex authentication can also be used. See [subscription setup](CONFIGURATION.md#chatgpt-subscription-through-codex).
4. Open `paper/results.tex` in the example. Put the cursor at the end of a sentence in the Results section.
5. Select **GUIDE** and click **Suggest next step**. With the editor focused, the equivalent shortcut is **Cmd+Option+Space** on macOS or **Ctrl+Alt+Space** on Linux/Windows.
6. The first explicit cloud request asks permission to send selected manuscript excerpts and retrieved evidence. Declining leaves the manuscript unchanged. No inference runs just because the extension activates.
7. Read the suggestion, then open **Evidence** to check support and **Context** to inspect the selected artifacts. **Research Copilot: Inspect Last Request** opens the full prompt, context, response, and validation details.

Request inspection is available **after a request is assembled**, not as a preflight source-by-source approval screen. Set file exclusions before making a cloud request. Canceling a request cannot retract context already sent.

All files in `examples/bridge-study` are synthetic demonstrations, including the reference PDF and numerical results. Do not cite them as scientific evidence.

## Choose how much help you want

Use the mode selector in the sidebar or **Research Copilot: Select Assistance Mode**.

| Mode | When to use it | What happens |
| --- | --- | --- |
| OFF | You want to write without proactive assistance | Suggestions are suppressed; explicit Chat questions still work. |
| GUIDE | You know the topic but want help deciding the next move | Suggests the purpose of the next sentence, without inserting prose. |
| WRITE | You want a short continuation at the cursor | Offers native ghost text, at most two sentences / 600 characters, subject to evidence checks. |
| EVIDENCE | You want to check a claim against your sources | Shows locally resolved passages, results, and missing-support warnings. |
| FIGURE / TABLE | You are deciding how to present a result | Proposes a figure, table, or no visualization using indexed project artifacts. It does not generate a plot. |
| STRUCTURE | You want help with the argument or section plan | Uses relevant outline and manuscript context to identify missing components. |

For WRITE, keep the manuscript editor focused and request a continuation. **Tab** accepts the native inline suggestion; **Esc** dismisses it. Accepting is an ordinary editor change: **Undo** reverses it. A suggestion card with an evidence warning may appear without insertable ghost text. Check the warning rather than assuming it was accepted.

Use **Research Copilot: Cancel Suggestion** or the sidebar's Cancel button to stop a pending request. Moving the cursor, editing the document, or changing modes invalidates outdated suggestions.

Automatic requests are optional. Enable `researchCopilot.automaticSuggestions` only if desired: GUIDE triggers after a sentence ending, WRITE after a pause with text before the cursor, and EVIDENCE after a paragraph break. The default delay is 1,800 ms. FIGURE / TABLE and STRUCTURE stay explicit. OFF suppresses all automatic requests. A cloud backend still requires an initial explicit request and consent.

## Manage the outline and section goals

The outline is an ordinary editable project file. The sidebar provides search, source navigation, and pinning; it is not a separate drag-and-drop outline editor.

### Markdown outline

1. Create `outline/outline.md` in your research folder, or edit the sample file.
2. Write headings and checklist items, for example:

```markdown
# Results

- [x] Introduce the synthetic comparison.
- [ ] Explain how ESS changes with constraint strength.
  Evidence: results/beta_sweep.csv; fixture2026, page 2.
- [ ] Discuss runtime before making an efficiency claim.
- [ ] State that these values are demonstration data.
```

3. Save the file. Names containing `outline` are discovered automatically; otherwise set `outline.path` in [project configuration](CONFIGURATION.md#project-files-and-discovery).
4. Open **Outline**, search for a goal, and use **Open source** to edit it or **Pin context** to prioritize it for requests.
5. Select GUIDE or STRUCTURE in the manuscript and ask for a suggestion.

Checkmarks are your own progress notes. The extension does not decide that a task is complete or update the outline on your behalf.

### YAML outline

Use YAML when you want explicit metadata. Save this as `outline/outline.yaml` and set `outline.path` to that file:

```yaml
nodes:
  - title: Results
    goal: Explain the synthetic accuracy and runtime tradeoff.
    claims:
      - Compare ESS across constraint strengths before discussing efficiency.
    evidence:
      - results/beta_sweep.csv
      - references/pdfs/fixture2026.pdf
    figures:
      - figures/beta_sweep.svg
    status: drafting
  - title: Limitations
    goal: Explain why demonstration data cannot support scientific conclusions.
    status: planned
```

A top-level list of node mappings also works. Metadata is supplied as outline context. Paths in `evidence` and `figures` are descriptive text; they do **not** automatically pin sources, create confirmed relationships, or verify claims. Pin the actual artifacts when they matter. There is no required workflow-status vocabulary or automatic status transition.

If there is no saved outline, headings in the manuscript supply a temporary outline. The extension never creates or overwrites a persistent outline automatically. Save structural manuscript changes to refresh all derived outline and figure entries.

### Remember the goal of the current section

1. Put the cursor in the relevant `.tex` section.
2. Pin any evidence you want associated with that section.
3. Run **Research Copilot: Set Current Section Goal** or click **Set section goal** in Context.
4. Enter a short statement such as “Explain the runtime tradeoff without claiming a causal mechanism.”

The goal and the current pin IDs are saved in `.research-copilot/state.json` and included when you return to that section. Run the same command to revise the goal. Goals are limited to 2,000 characters. They follow the manuscript path and heading identity; after renaming a heading or moving the file, set the goal again. Updating an outline entry does not automatically update this separate section goal.

## Follow your place in the document

Requests use the active LaTeX file, cursor position, enclosing headings, current paragraph, nearby text, and relevant indexed artifacts. Unsaved manuscript text takes precedence over the saved version. This gives the assistant context about where you are writing, including when you move between included `.tex` files.

When you open a reference or use the sidebar, the extension retains the last manuscript editor. Click the intended `.tex` file and position the cursor before requesting help if you have several manuscripts open. In a multi-root workspace, the active manuscript selects the project root; evidence is not silently combined across roots.

This tracks document position, not your mental writing stage. Record “planning,” “drafting,” or “revising” in your outline or section goal if useful. There is no automatic inference that a section is finished. For bibliography, outline, code, or data files, **save changes before using them as evidence**; dirty non-LaTeX sources are withheld from requests.

## Manage references and local PDFs

1. Add or edit entries in a `.bib` file using VS Code or your existing bibliography manager. Save the file.
2. Put PDFs under the opened research folder, for example `references/pdfs/`.
3. Match a PDF unambiguously using its citation-key filename (`fixture2026.pdf` for `fixture2026`) or a simple BibTeX `file` field. A `file` value can be relative to the bibliography's directory or to the workspace root.

For example, in `references/references.bib`:

```bibtex
@misc{fixture2026,
  title = {Synthetic Evidence Fixture for Research Copilot},
  author = {{Research Copilot Example}},
  year = {2026},
  note = {Fictional demonstration source, not a scientific publication},
  file = {pdfs/fixture2026.pdf}
}
```

4. Open **References** and search by title, author, citation key, or passage text. BibTeX metadata and PDF passages appear as separate cards.
5. With the manuscript cursor positioned, click **Insert citation** on a bibliography card. This inserts `\cite{fixture2026}` and remains undoable. Keep using your normal bibliography package and LaTeX build; the extension does not configure them.
6. Use **Open highlighted passage** on a PDF card to inspect the exact extracted text and its page region. Navigate pages and zoom locally; returning to the evidence page restores its highlight.
7. Pin the bibliography entry and the relevant PDF passage when both should be available for a request.

A bibliography entry alone is a citation candidate, not verified full-text support. Even a matched PDF does not prove it supports a particular claim: inspect the actual passage. The extension resolves displayed quotations from local extraction, rather than accepting quotation text generated by a model. Scanned PDFs without a usable text layer need an external OCR workflow; OCR is not included.

There is no Zotero sync, DOI lookup, paper download service, or dedicated bibliographic metadata editor. Edit or import `.bib` and PDF files through your existing tools, then save and refresh.

## Manage code and empirical results

### Results

1. Export relevant results to CSV with a unique header, or JSON, inside the project. Leave experiment execution in your existing workflow.
2. Save the files and open **Results**. Search for a filename, variable, method, or distinctive value.
3. Inspect dimensions, previews, and **Schema and descriptive statistics** where available. Numeric-column summaries include count, missing values, minimum, maximum, mean, and median; these are descriptive summaries, not inferential tests.
4. Pin a relevant row block rather than relying only on the dataset summary. Indexed blocks contain at most 25 rows; a sidebar table displays at most 12 preview rows. **Inspect Last Request** shows the full block if it was included in that request.
5. Return to the manuscript and use EVIDENCE, WRITE, or Chat. For example: “Which indexed results support the comparison in this paragraph? Identify missing evidence.”

Rows are numbered from 1, excluding the CSV header, and count parsed data records rather than physical text lines. A numerical WRITE claim must match a current source hash, row, column, and cell value. Stale or invented provenance blocks insertion. This checks data presence, **not** units, statistical validity, causality, or the soundness of an interpretation. Do not treat a model's arithmetic as a verified analysis.

JSON arrays of records become tables; nested metric objects become `metric` / `value` rows. See [supported files and limits](CONFIGURATION.md#supported-files-and-limits). There is no spreadsheet editor or interactive row-query builder in this release.

### Code and figures

Python files and notebook code cells are indexed without execution. Notebook outputs are not ingested as empirical result tables: export the values to CSV/JSON. There is no dedicated Code tab; use **Research Copilot: Pin Project Artifact**, enter a function name or filename, and choose a code artifact. Selected code is inspectable in Context, with **Open source** for normal editing.

The **Figures** tab lists existing image files and recognized LaTeX figures/tables. Cards can show captions, labels, first manuscript references, and links to discoverable source code and data. These relationships are inferred from file references, not verified by running the analysis. FIGURE / TABLE mode can recommend a presentation but does not create image files or execute plotting code.

To record a known relationship, run **Research Copilot: Confirm Evidence Relationship**. Choose a source, target, and one of `supports`, `generates`, `reads`, `illustrates`, or `cites`. For example, choose plotting code as the source and an image as the target for `generates`. Context distinguishes confirmed and inferred relationships. Confirmation stops being current when either file hash changes; reconfirm after checking updated sources. The current picker is limited to its first 100 artifacts, so large projects may need narrower discovery scope.

## Choose request context

- **Pin context** prioritizes an artifact; **Unpin** removes that priority. The command-palette pin search can find code and other artifacts not visible in a dedicated panel.
- **Exclude** in Context removes that artifact from subsequent retrieval. **Include** restores it. An artifact is a passage, row block, or other indexed unit, not necessarily the whole file.
- To exclude an entire sensitive file or folder, use `exclude` in `project.yaml` before making requests. Excluding one row block does not exclude the dataset summary or other blocks.
- Pins cannot override exclusions, missing/stale sources, unsaved-source withholding, or the context budget. Omission warnings explain budget pressure. Exclude unwanted material or select smaller blocks before increasing the budget.
- The manuscript excerpt at the cursor remains part of every request, even when other artifacts are excluded. Chat also includes a bounded amount of prior conversation from the current session.

Context changes cannot remove material already sent to a provider or mentioned in prior Chat history. Reopen/reload the project window to start a fresh in-memory conversation. Request inspection and opt-in logs may contain unpublished work; do not paste them into a public bug report without redacting them.

## Ask questions and review edits

Use **Chat** for explicit questions in any mode, including OFF. Example: “What support is missing for the current paragraph?” Chat receives current manuscript context and recent conversation; it cannot run your experiments or browse for new papers.

For an edit:

1. Ask specifically, for example: “Propose a clearer version of the current paragraph without adding claims or changing its citations.”
2. If the response contains an edit proposal, click **Review proposed diff** or run **Research Copilot: Review Proposed Edit**.
3. Review the original and proposed manuscript side by side, including any evidence warnings.
4. Choose **Apply reviewed edit**, or reject/close the review. Merely requesting an edit or opening its diff does not change the file. The command **Research Copilot: Apply Reviewed Edit** also applies a previously reviewed proposal.
5. Use normal VS Code Undo if needed, and save when satisfied. The extension does not automatically save the edit; your own VS Code Auto Save setting still applies.

Only a bounded replacement in an existing `.tex` file is supported. Changed text after review invalidates the proposal and requires regeneration/review. Raw results, code, outlines, and bibliography files cannot be changed by model edit actions. Review remains necessary: provenance checks do not certify that the prose is scientifically correct.

## Command reference

Open the command palette with **Cmd+Shift+P** / **Ctrl+Shift+P**. All commands below have the prefix **Research Copilot:**.

| Command title | Purpose |
| --- | --- |
| Select Assistance Mode | Choose OFF, GUIDE, WRITE, EVIDENCE, FIGURE / TABLE, or STRUCTURE. |
| Suggest / Regenerate | Request help at the manuscript cursor. |
| Cancel Suggestion | Cancel the current request and invalidate its suggestion. |
| Sign in with ChatGPT | Start Codex's browser sign-in flow. |
| Select Codex Model | List Codex models and save your choice in user settings. |
| Refresh Project Index | Rescan local files and report indexing notices. |
| Configure Project | Open or create the optional project configuration template. |
| Set OpenAI API Key | Store an API key in VS Code SecretStorage; submit an empty value to remove it. |
| Inspect Last Request | Open the exact last request and available response/validation details. |
| Review Proposed Edit | Open a proposed manuscript edit as a diff. |
| Apply Reviewed Edit | Apply a reviewed proposal if its target text is unchanged. |
| Pin Project Artifact | Search all artifact kinds and toggle a pin. |
| Confirm Evidence Relationship | Record a relationship between two current artifacts. |
| Set Current Section Goal | Save the current section goal and associated pin IDs. |
| Check Local Setup | Show helper/PDF readiness and setup actions. |

For failures, start with [Troubleshooting](TROUBLESHOOTING.md). For defaults, discovery rules, and local storage, see [Configuration](CONFIGURATION.md).
