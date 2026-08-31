# Architecture and extension points

[README](../README.md) · [Contributing](../CONTRIBUTING.md) · [Acceptance ledger](IMPLEMENTATION.md) · [Validation](VALIDATION.md)

This is a VS Code extension, not a standalone editor or hosted service. The runtime has no production npm dependencies. TypeScript is bundled with esbuild; Python's standard library supplies SQLite, CSV, JSON, and AST parsing. PDFium/Pillow add local PDF extraction/rendering, and PyYAML handles optional YAML inputs.

## Request flow

1. The controller captures the active manuscript, cursor, mode, and optional explicit question. Model calls are explicit unless automatic suggestions are enabled. Cloud calls require consent.
2. The local indexer retrieves bounded artifacts by lexical relevance, resource kind, pins, and current confirmed relationships.
3. The core assembles a context packet. Unsaved manuscript text replaces saved excerpts; dirty non-manuscript sources are withheld. Exclusions and the character budget apply before inference.
4. The selected backend returns a schema-constrained suggestion. The model receives preassembled context; it cannot invoke the indexer's retrieval operations itself in v0.1.
5. Locally resolved current artifacts validate evidence IDs, citation keys, numerical locators, hashes, and insertion constraints. Cancellation and document versions prevent stale results from becoming current suggestions.
6. The sidebar displays text/evidence. WRITE can expose a native inline completion. Chat can propose a bounded manuscript diff, which needs separate review and explicit application against unchanged text.

## Code map

| Area | Responsibility |
| --- | --- |
| `src/extension.ts` | VS Code lifecycle, workspace selection, editor events, commands, sidebar state, consent, request orchestration, diff approval. |
| `src/core/types.ts` | Shared artifact, context, suggestion, provenance, and backend interfaces. |
| `src/core/modes.ts` | Lens/intervention presets and trigger policy. |
| `src/core/latex.ts`, `live.ts` | LaTeX structure, includes, cursor context, and safe refresh of unsaved manuscript artifacts. |
| `src/core/context.ts` | Context ranking/budget and model prompt construction. |
| `src/core/integrity.ts`, `edits.ts` | Output schema, evidence resolution, numerical/citation checks, and bounded edit validation. |
| `src/indexer.ts` | Client for the single Python JSONL helper. |
| `python/research_indexer.py` | Workspace discovery, incremental SQLite index, retrieval, relationships, and persistent controls. |
| `python/parsers.py`, `pdf_engine.py` | Static source/data parsing and local PDF extraction/rendering. |
| `src/backends/rpc.ts`, `codex.ts` | JSONL process transport and Codex app-server authentication, model selection, inference, and cancellation. |
| `src/backends/http.ts` | Optional Responses API and loopback Chat Completions adapters. |
| `src/ui/`, `media/` | Restrictive webview shell, plain JavaScript/CSS sidebar, and PDF viewer. Untrusted text is rendered as text nodes. |
| `tests/`, `scripts/` | Behavioral tests, real host acceptance suite, setup/build/packaging, synthetic live smoke check, and index benchmark. |

## Index and provenance

An artifact has an ID, kind, workspace-relative path, title, text, source hash, locator, and metadata. Locators vary by source: PDF page/character/rectangle, result row/column, code line, or manuscript span. IDs identify indexed units; the hash establishes which file version they came from. IDs alone do not prove freshness.

SQLite stores files, artifacts, inferred edges, and index metadata. Changes invalidate previous artifacts; retrieval also checks freshness against source files. The separate `state.json` stores user controls and confirmed relationship hashes. A confirmation stops being current after a source change. Deleting the cache should never delete section goals or other user state.

The helper uses JSONL over standard I/O: requests have `id`, `method`, and optional `params`; replies contain the same `id` with either `result` or `error`. Its dispatch table exposes bounded search, source lookup, result slices, structure, PDF rendering, state updates, and graph operations. This is an internal interface, not a stable public API or network service. `update_state` changes only Research Copilot metadata; the helper does not execute project code or rewrite raw research files.

## Provider boundary

Backends implement `ResearchModelBackend` and yield status/result events. The core owns request context and validates output independently of the provider. Codex uses a dedicated app-server child, an ephemeral thread, read-only sandbox settings, disabled tools/connectors, and denied approval requests. HTTP adapters have cancellation/timeouts, response-size bounds, strict schema requests, and no redirects. Local endpoints must be loopback.

Prompt instructions treat project material as untrusted, but instructions alone are not an isolation boundary. Preserve host-side capability restrictions and checks when extending the integration. The provider still receives any context sent to it; see [security and privacy](../SECURITY.md).

## Extending the MVP

For a new artifact type, start with a synthetic parser/indexer regression that covers malformed data, bounded size, stable locators, deletion, and stale hashes. Add rendering/context selection only after the artifact contract is sound. For a backend, test authentication failure, malformed/refused output, cancellation, and the exact request/response format without making ordinary tests depend on a live account.

New editor writes require tests for review, explicit approval, changed targets, and native Undo. Keep experiment execution and figure generation out of ordinary suggestion paths. Do not add a model-driven retrieval loop by enabling general shell or filesystem tools; that follow-up needs bounded read-only operations and its own design/testing.

Use the [acceptance ledger](IMPLEMENTATION.md) to distinguish implemented behavior from deferred scope, and [validation record](VALIDATION.md) to distinguish mocks, real host checks, and live provider checks.
