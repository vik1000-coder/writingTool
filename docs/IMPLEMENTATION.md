# Implementation and acceptance ledger

The supplied v0.1 specification is authoritative. Deliver Stages A–C as a local VS Code extension. Stage D, collaboration, experiment execution, automatic figures, and cloud services are explicitly deferred.

## Stage A — interaction and local foundations

- [ ] Six presets backed by independent lens/intervention axes; GUIDE default; OFF permits explicit Chat only.
- [ ] LaTeX structure and cursor context, including multi-file projects, comments and nested braces.
- [ ] Real Codex JSONL handshake, authentication, model selection, cancellation, structured output; read-only sandbox.
- [ ] Sidebar, native WRITE ghost text, explicit triggers and opt-in debounce.
- [ ] Request inspection and stale response rejection.

## Stage B — scientific grounding

- [ ] Incremental SQLite artifact index with content hashes, Git ignores, deletion/error invalidation, bounded files/context.
- [ ] BibTeX metadata; existing citation keys only; unverified full text labeled clearly.
- [ ] Exact local PDF passages with page/character/bounding-box locators and highlighted page viewer.
- [ ] CSV/JSON schema, dimensions, descriptive statistics, row previews and small retrieved slices.
- [ ] Fabricated evidence IDs, quotations, citations, numerical values and stale locators tested adversarially.

## Stage C — project intelligence

- [ ] Python AST and notebook indexing without execution; existing figure/table registry and inferred relationships.
- [ ] Optional Markdown/YAML outlines, ephemeral fallback, persistent section goals.
- [ ] Pinning, exclusions, confirmed evidence relationships, mode-specific bounded retrieval.
- [ ] Optional Responses API and loopback OpenAI-compatible providers, including separate WRITE provider.
- [ ] Chat edit proposals reviewed as a diff and applied only after approval against unchanged manuscript text.
- [ ] Scoped read-only retrieval operations available through the local core.

## Release checks

- [ ] Regression tests, strict TypeScript, Python tests, real extension-host tests, UI inspection, packaged VSIX.
- [ ] Sample research project, setup/run instructions, privacy notes, limitations, CI, contribution instructions.
- [ ] Real local indexer/PDF and Codex protocol smoke tests; distinguish mocked tests from live generation.

## Design decisions

- No frontend framework or database daemon. Python's standard-library SQLite/AST/CSV handle core indexing.
- Use optional PDFium (pypdfium2 + Pillow) for local extraction/rendering, avoiding an AGPL PDF dependency. No cloud OCR. Missing dependencies and scanned PDFs are reported explicitly.
- Safe default: explicit model calls; no remote transmission on activation. No telemetry in this extension.
- Index metadata is disposable; confirmed relationships/pins/goals are persisted separately. Raw results are never writable through model actions.
- Numerical provenance checks establish a matching source locator, not scientific truth or causal correctness. Computed claims require recorded analysis, which automatic execution deliberately does not provide in this MVP.

## Protocol references

Implementation checked against installed `codex-cli 0.133.0` generated schemas and [official App Server documentation](https://learn.chatgpt.com/docs/app-server). The integration sends `initialize`/`initialized`, starts an ephemeral read-only thread, constrains `turn/start` with an output schema, and handles completion, cancellation, and denied approval requests.

PDF extraction/rendering uses the [PDFium Python API](https://pypdfium2.readthedocs.io/en/stable/python_api.html); inline suggestions use the [VS Code language API](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).
