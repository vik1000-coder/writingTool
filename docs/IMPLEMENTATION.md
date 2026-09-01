# Implementation and acceptance ledger

The supplied v0.1 specification is authoritative. Deliver Stages A–C as a local VS Code extension. Stage D, collaboration, experiment execution, automatic figures, and cloud services are explicitly deferred.

## Stage A — interaction and local foundations

- [x] Six presets backed by independent lens/intervention axes; GUIDE default; OFF permits explicit Chat only.
- [x] LaTeX structure and cursor context, including multi-file projects, comments and nested braces.
- [x] Real Codex JSONL handshake, authentication, model selection, cancellation, structured output; read-only sandbox.
- [x] Sidebar, native WRITE ghost text, explicit triggers and opt-in debounce.
- [x] Request inspection and stale response rejection.

## Stage B — scientific grounding

- [x] Incremental SQLite artifact index with content hashes, Git ignores, deletion/error invalidation, bounded files/context.
- [x] BibTeX metadata; existing citation keys only; unverified full text labeled clearly.
- [x] Exact local PDF passages with page/character/bounding-box locators and highlighted page viewer.
- [x] CSV/JSON schema, dimensions, descriptive statistics, row previews and small retrieved slices.
- [x] Fabricated evidence IDs, quotations, citations, numerical values and stale locators tested adversarially.

## Stage C — project intelligence

- [x] Python AST and notebook indexing without execution; existing figure/table registry and inferred relationships.
- [x] Optional Markdown/YAML outlines, ephemeral fallback, persistent section goals.
- [x] Pinning, exclusions, confirmed evidence relationships, mode-specific bounded retrieval.
- [x] Optional Responses API and loopback OpenAI-compatible providers, including separate WRITE provider.
- [x] Chat edit proposals reviewed as a diff and applied only after approval against unchanged manuscript text.
- [x] Scoped read-only retrieval operations available through the local core.

## Release checks

- [x] Regression tests, strict TypeScript, Python tests, real extension-host tests, UI inspection, packaged VSIX.
- [x] Sample research project, setup/run instructions, privacy notes, limitations, CI, contribution instructions.
- [x] Real local indexer/PDF and Codex protocol smoke tests; distinguish mocked tests from live generation.

## Design decisions

- No frontend framework or database daemon. Python's standard-library SQLite/AST/CSV handle core indexing.
- Use optional PDFium (pypdfium2 + Pillow) for local extraction/rendering, avoiding an AGPL PDF dependency. No cloud OCR. Missing dependencies and scanned PDFs are reported explicitly.
- Safe default: explicit model calls; no remote transmission on activation. No telemetry in this extension.
- Index metadata is disposable; confirmed relationships/pins/goals are persisted separately. Raw results are never writable through model actions.
- Numerical provenance checks establish a matching source locator, not scientific truth or causal correctness. Computed claims require recorded analysis, which automatic execution deliberately does not provide in this MVP.

## Protocol references

Implementation checked against `codex-cli 0.133.0` generated schemas and live-tested CLI 0.151.0 and [official App Server documentation](https://learn.chatgpt.com/docs/app-server). The integration sends `initialize`/`initialized`, starts an ephemeral read-only thread, constrains `turn/start` with an output schema, and handles completion, cancellation, and denied approval requests.

PDF extraction/rendering uses the [PDFium Python API](https://pypdfium2.readthedocs.io/en/stable/python_api.html); inline suggestions use the [VS Code language API](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).

## Validation and deliberate boundaries

See [VALIDATION.md](VALIDATION.md) for test coverage, live versus fixture checks, performance measurements, and platform limits. The model receives preassembled context through the local scoped retrieval core; model-initiated tool loops are not enabled. External research directories are supported by opening their common parent as the workspace.

## v0.2 follow-up: Grok and writing cards

- [x] xAI API backend with fixed endpoint, strict schema, secure key storage, per-provider consent, and separate WRITE routing.
- [x] Native GUIDE hover with topic, local source title, AI summary/relevance, and source/lock actions.
- [x] Exact local quote highlighted in the left panel; session lock survives writing navigation and clears when the source changes.
- [x] Preserve native WRITE completion and explicit reviewed manuscript edits.
- [x] TDD coverage for provider protocol, source projections, unsafe display text, native hover, and lock lifecycle.

## v0.2.1 follow-up: low-latency WRITE

- [x] Dedicated Grok 4.3 WRITE profile with reasoning disabled and compact structured output.
- [x] Exact session-memory continuation cache with typed-prefix reuse, TTL/LRU/byte limits, and explicit regeneration/clear behavior.
- [x] Source-hash revalidation, dirty-buffer invalidation, and cached file-digest freshness checks.
- [x] Stable xAI prompt prefix/conversation ID plus cached-token observability.
- [x] Unit, protocol, Python, and real VS Code host regressions written before implementation.

## v0.2.2 follow-up: GUIDE reference shortlist

- [x] Up to three grounded reference suggestions displayed alongside the next-topic guidance.
- [x] Reference titles visible in the native cursor marker and compact sidebar strip.
- [x] Safe hover/focus details for AI summary, writing-position relevance, and local locator.
- [x] PDF-first citation deduplication with no weak-match padding or model-generated quotations.
- [x] Current-token source viewing/locking and existing source freshness invalidation preserved.

## v0.3.0 follow-up: all-Grok routing, plain text, and panel organization

- [x] Grok default for every mode, with visible effective routing and Settings-based provider/WRITE overrides.
- [x] Plain `.txt` manuscript activation, indexing, heading context, GUIDE/WRITE, section goals, citations, and reviewed edits.
- [x] Writing, Research, and Workspace navigation groups in the left panel with the same complete panel set.
- [x] Deterministic Grok contract/default tests without paid CI calls and real-host `.txt` acceptance coverage.

## v0.3.1 follow-up: live reliability and usage visibility

- [x] Safe recovery of a complete leading structured object when provider commentary trails it.
- [x] Provider-specific, credential-safe diagnostics for DNS, timeout, refusal, TLS, and general connection failures.
- [x] Sticky last-request/session token footer with cached-token detail, xAI exact billed cost, and known-model fallback estimates.
- [x] Paid synthetic Grok smoke validation plus deterministic HTTP, pricing, DOM, and real-host regressions.
