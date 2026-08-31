# Validation record

Validated on 31 August 2026. These are implementation checks, not evidence that a model's scientific interpretation is correct.

## Automated checks

- `npm run verify`: strict TypeScript, 22 TypeScript tests, 14 Python tests (including PDFium/Pillow and YAML), and the production bundle pass locally.
- `npm run test:extension`: passes in a real VS Code 1.127 extension host with a disposable workspace, a deterministic loopback HTTP fixture, and the real Python helper. No cloud model is called by these tests.
- Host coverage includes activation without inference, all six modes, read-only suggestions, grounded WRITE, invented-citation rejection, OFF with explicit Chat, diff review and explicit apply, stale-review rejection, unsaved-source omission, cancellation, evidence watchers, request inspection, sidebar activation, automatic debounce, and OFF suppression.
- The Linux CI run exercised native inline acceptance and Undo in a focused Xvfb host. Native inline rendering/acceptance and Undo depend on OS window focus. The host suite checks them when focused; when a macOS background host cannot execute native editor commands, it reports that limitation and restores only its disposable fixtures. Manual checks cover native acceptance and Undo separately.
- `npm run setup` prepares the repository's Python environment without modifying system Python. `vsce package --no-dependencies` produces a roughly 115 KB VSIX including the user guides, with no node_modules, models, Python wheels, tests, or development dependencies.
- `npm audit --omit=dev`: no production dependency vulnerabilities reported (there are no production npm dependencies).

The tests were developed alongside the implementation. New failing regressions led to fixes for stale or fabricated evidence, numeric-sign parsing, unsafe TeX directives, changed configuration, late CSV slices, outdated relationship confirmation, PDF highlight compositing, stale sidebar snapshots, cancellation before a Codex turn ID arrives, macOS path aliases creating duplicate editor buffers, and unsaved changes shifting section offsets.

## Documentation and packaging audit

- Audited usage/configuration instructions against the sidebar, command manifest, parsers, provider adapters, and local storage behavior. All 15 commands and all 13 setting defaults are documented.
- Checked local Markdown links and anchors, parsed JSON/YAML examples, and syntax-checked shell examples. Exercised the documented project configuration, Markdown/YAML outlines, and BibTeX-to-PDF matching against the real indexer in a disposable copy of the synthetic study.
- Re-ran `npm run package` (including all 36 core/indexer tests) and `npm run test:extension`. The macOS host passed, with its documented background-window limitation for native inline acceptance/Undo.
- Inspected the resulting ZIP: all four user-guide files are included and match their repository sources; relative guide links resolve within the installed package. A dedicated guide index avoids relying on the root README filename, which the packager lowercases. Developer docs/screenshots remain in the repository rather than increasing the installed package.
- Clarified subscription versus API setup, artifact versus file exclusions, Git discovery behavior, retrospective request inspection, manual outline/status management, and currently unimplemented features. No new live model inference was needed for this documentation audit.

## Live backend check

`scripts/smoke-codex.ts --generate` successfully authenticated through existing Codex ChatGPT credentials, listed seven models, and produced a schema-constrained GUIDE response for synthetic text. It did not send a research repository or any user source material. CLI 0.151.0 passed; the machine's older 0.133.0 CLI advertised a configured model that required a newer client. The development dependency supplies the tested version without replacing system Codex.

The Responses API and local adapter are covered by protocol/HTTP tests. Paid OpenAI API inference and arbitrary third-party local models have not been live-tested. Servers must support the documented structured-output request format.

## Visual checks

The running extension was inspected in VS Code on macOS. Checks included mode selection, GUIDE cards, native WRITE ghost text followed by Tab and Undo, exact local quotations, PDF page navigation, return to the evidence page, zoom, and explicit Chat diff approval followed by native Undo. The highlight preserves the original glyphs. Screenshots use deterministic synthetic responses and a synthetic PDF; they are not live-model or real research examples.

![GUIDE with synthetic project context](screenshots/guide.jpg)

![Local exact quotation and highlighted source PDF](screenshots/evidence.jpg)

## Lightweight index check

Run `.venv/bin/python scripts/benchmark.py` to reproduce the generated dataset. One local macOS arm64 run indexed 101 files, including a 100,000-row CSV, into 4,301 artifacts:

| Operation | Observed time |
| --- | ---: |
| First scan | 555 ms |
| Unchanged scan | 23 ms |
| Ranked search finding the final CSV row | 52 ms |

The resulting SQLite file was 17,068,032 bytes. These are one-machine smoke measurements, not performance guarantees or a comparison with another product. No embedding service or model call is involved.

## Scope and remaining limitations

- The delivered scope is the local VS Code MVP, Stages A–C. Standalone packaging, collaboration, OCR, Zotero, Parquet, automatic figure creation and experiment execution remain deferred.
- The model receives bounded, mode-specific context assembled through scoped read-only retrieval operations. Those operations are available to the local core; this version does not let the model invoke an open-ended tool loop. Codex shell, connectors, filesystem writes and approval requests are disabled/denied.
- External resource directories must be placed under a common opened workspace folder. Escaping symlinks and external paths are rejected. Multi-root workspaces use the active manuscript's root.
- Retrieval uses local lexical relevance, mode priorities, pins and confirmed relationships. It is not a semantic search benchmark. Confirmations expire when either source hash changes.
- TeX structure parsing handles the supported commands and nested braces, not arbitrary macro expansion. PDF text order depends on the PDF's text layer; scanned or unreadable sources remain unverified.
- Numeric validation verifies an exact current cell locator. It does not establish scientific validity, correct units, causal support, or a statistically sound interpretation. Automatic computation is intentionally absent.
- macOS has been exercised locally. GitHub CI runs Linux with a real extension host under Xvfb. Windows remains unverified; use F5 if the `code` launcher is unavailable.

The [initial complete Linux CI run](https://github.com/vik1000-coder/writingTool/actions/runs/33364355998) passed verification, native editor integration, and packaging. GitHub workflow results provide the authoritative CI status for each commit. The repository remains private; no Marketplace or public release has been published.
